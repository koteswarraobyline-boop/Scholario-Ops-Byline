import crypto from 'crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { CommunicationChannel, Incident, EscalationPolicy } from '../src/types/index.ts';
import { config, isSmtpConfigured } from './config.ts';
import { db, persist } from './store.ts';
import { broadcast, audit } from './events.ts';
import { log } from './logger.ts';

export interface NotificationMessage {
  title: string;
  text: string;
  severity: string;
  status: 'FIRING' | 'RESOLVED' | 'ESCALATED' | 'INFO' | 'TEST';
  incidentId?: string;
  link?: string;
}

let transporter: Transporter | null = null;
function mailer() {
  if (!isSmtpConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

/** A failure that retrying cannot fix (bad URL, rejected payload, missing configuration) */
class PermanentDeliveryError extends Error {}

/**
 * Outgoing webhooks are signed when NOTIFY_WEBHOOK_SECRET is set, so the receiver can verify the
 * sender: X-Scholario-Signature = "sha256=" + HMAC-SHA256(secret, `${X-Scholario-Timestamp}.${body}`).
 */
async function postJson(url: string, body: unknown, sign = false) {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sign && config.notifyWebhookSecret) {
    const ts = String(Math.floor(Date.now() / 1000));
    headers['X-Scholario-Timestamp'] = ts;
    headers['X-Scholario-Signature'] = `sha256=${crypto.createHmac('sha256', config.notifyWebhookSecret).update(`${ts}.${payload}`).digest('hex')}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(url, { method: 'POST', headers, body: payload, signal: controller.signal });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const msg = `HTTP ${resp.status}: ${text.slice(0, 200)}`;
      // 4xx (except 408 / 429) means the request itself is wrong: retrying sends the same wrong request
      throw resp.status >= 400 && resp.status < 500 && resp.status !== 408 && resp.status !== 429 ? new PermanentDeliveryError(msg) : new Error(msg);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Delays before the 2nd and 3rd attempt (tests shorten them) */
export const RETRY_DELAYS_MS = [2_000, 8_000];

/** deliver() with retries for temporary failures (network errors, timeouts, 5xx, 408, 429) */
async function deliverWithRetry(channel: CommunicationChannel, msg: NotificationMessage): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try {
      await deliver(channel, msg);
      return attempt;
    } catch (err) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      if (err instanceof PermanentDeliveryError || delay === undefined) throw err;
      log.warn('notify', `${channel.type} channel "${channel.name}" attempt ${attempt} failed (${(err as Error).message}) — retrying in ${delay / 1000}s`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

const COLORS: Record<NotificationMessage['status'], string> = { FIRING: 'D13438', RESOLVED: '2EB886', ESCALATED: 'FF8C00', INFO: '0078D7', TEST: '0078D7' };

async function deliver(channel: CommunicationChannel, msg: NotificationMessage) {
  const target = channel.targetEndpoint.trim();
  if (!target) throw new PermanentDeliveryError('Channel has no target configured');
  switch (channel.type) {
    case 'TEAMS':
      await postJson(target, {
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        themeColor: COLORS[msg.status],
        summary: msg.title,
        title: `[${msg.status}] ${msg.title}`,
        text: msg.text.replace(/\n/g, '<br>'),
        potentialAction: msg.link ? [{ '@type': 'OpenUri', name: 'Open in Scholario Ops', targets: [{ os: 'default', uri: msg.link }] }] : undefined,
      });
      return;
    case 'WEBHOOK':
      // `text` makes this compatible with Slack / Google Chat / Mattermost incoming webhooks
      await postJson(target, { ...msg, details: msg.text, text: `*[${msg.status}] ${msg.title}*\n${msg.text}${msg.link ? `\n${msg.link}` : ''}` }, true);
      return;
    case 'PAGERDUTY':
      await postJson('https://events.pagerduty.com/v2/enqueue', {
        routing_key: target,
        event_action: msg.status === 'RESOLVED' ? 'resolve' : 'trigger',
        dedup_key: msg.incidentId,
        payload: {
          summary: msg.title,
          source: 'scholario-ops',
          severity: ['CRITICAL', 'EMERGENCY'].includes(msg.severity) ? 'critical' : msg.severity === 'HIGH' ? 'error' : msg.severity === 'WARNING' ? 'warning' : 'info',
          custom_details: { text: msg.text },
        },
        links: msg.link ? [{ href: msg.link, text: 'Scholario Ops' }] : undefined,
      });
      return;
    case 'EMAIL': {
      const t = mailer();
      if (!t) throw new PermanentDeliveryError('SMTP is not configured (SMTP_HOST / SMTP_FROM)');
      await t.sendMail({
        from: config.smtp.from,
        to: target,
        subject: `[${msg.status}] ${msg.title}`,
        text: `${msg.text}${msg.link ? `\n\n${msg.link}` : ''}`,
      });
      return;
    }
    default:
      throw new PermanentDeliveryError(`Unsupported channel type ${channel.type}`);
  }
}

/** Sends to one channel and records the delivery result on the channel. */
export async function sendToChannel(channel: CommunicationChannel, msg: NotificationMessage): Promise<{ ok: boolean; error?: string }> {
  try {
    const attempts = await deliverWithRetry(channel, msg);
    if (attempts > 1) log.info('notify', `${channel.type} channel "${channel.name}" delivered on attempt ${attempts}`);
    channel.lastDeliveryAt = new Date().toISOString();
    channel.lastDeliveryStatus = 'DELIVERED';
    channel.failureCount = 0;
    return { ok: true };
  } catch (err) {
    channel.lastDeliveryAt = new Date().toISOString();
    channel.lastDeliveryStatus = 'FAILED';
    channel.failureCount += 1;
    log.error('notify', `${channel.type} channel "${channel.name}" failed: ${(err as Error).message}`);
    return { ok: false, error: (err as Error).message };
  } finally {
    persist();
    broadcast('channel_update', channel);
  }
}

function channelsForSeverity(severity: string): CommunicationChannel[] {
  const policy = db.escalationPolicies.find(p => p.severity === severity);
  const enabled = db.channels.filter(c => c.enabled);
  if (!policy || policy.channels.length === 0) return enabled;
  return enabled.filter(c => policy.channels.includes(c.id));
}

export function incidentLink(incidentId: string) {
  return config.publicUrl ? `${config.publicUrl}/incidents?id=${encodeURIComponent(incidentId)}` : undefined;
}

/** Last notification per fingerprint+status+severity — a flapping check notifies at most once per cooldown */
const lastSent = new Map<string, number>();
/** Incidents whose FIRING notification was actually sent: their RESOLVED is never suppressed (paging tools stay in sync) */
const firingSent = new Set<string>();

const timelineNote = (incident: Incident, level: Incident['timeline'][number]['level'], message: string) =>
  incident.timeline.push({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), source: 'Escalation Policy', level, message });

/**
 * opts.afterDelay: the engine sends a FIRING that was held back by the policy's initial delay.
 * Returns true when a notification was handed to at least one channel.
 */
export function notifyIncident(incident: Incident, status: 'FIRING' | 'RESOLVED', extra?: string, opts: { afterDelay?: boolean } = {}): boolean {
  const policy = db.escalationPolicies.find(p => p.severity === incident.severity);
  const isReminderMsg = Boolean(extra?.startsWith('Reminder'));
  // Initial delay: hold the first page. The engine sends it once the delay has passed (restart-safe:
  // the flag is stored on the incident). Resolved or acknowledged within the delay → nobody is paged.
  if (status === 'FIRING' && !opts.afterDelay && !isReminderMsg && !firingSent.has(incident.id) && policy && policy.initialDelayMin > 0
    && Date.now() - Date.parse(incident.startedAt) < policy.initialDelayMin * 60_000) {
    if (!incident.notificationDeferred) {
      incident.notificationDeferred = true;
      timelineNote(incident, 'INFO', `Notification held for the ${policy.initialDelayMin}-min initial delay (${incident.severity} policy)`);
      persist();
      log.info('notify', `${incident.id}: first notification deferred ${policy.initialDelayMin} min`);
    }
    return false;
  }
  if (incident.notificationDeferred) {
    incident.notificationDeferred = false;
    persist();
    if (status === 'RESOLVED') {
      timelineNote(incident, 'INFO', 'Resolved within the notification delay — nobody was paged');
      log.info('notify', `${incident.id} resolved within the initial delay — no notification sent`);
      return false;
    }
  }
  const channels = channelsForSeverity(incident.severity);
  if (channels.length === 0) return false; // NOT_CONFIGURED: nothing is sent anywhere
  // Severity is part of the key: an escalation (e.g. WARNING → HIGH) is always delivered
  const key = `${incident.fingerprint}|${status}|${incident.severity}`;
  const now = Date.now();
  const pairedResolve = status === 'RESOLVED' && firingSent.has(incident.id);
  if (!isReminderMsg && !pairedResolve && now - (lastSent.get(key) ?? 0) < config.alertCooldownMin * 60_000) {
    log.info('notify', `suppressed ${status} for ${incident.id} (cooldown ${config.alertCooldownMin} min)`);
    return false;
  }
  lastSent.set(key, now);
  if (status === 'FIRING') firingSent.add(incident.id);
  else firingSent.delete(incident.id);
  // Bounded: forget cooldown keys older than a day
  if (lastSent.size > 5000) for (const [k, t] of lastSent) if (now - t > 86_400_000) lastSent.delete(k);
  const msg: NotificationMessage = {
    title: `${incident.id} ${incident.title}`,
    text: [
      `Severity: ${incident.severity} | Environment: ${incident.environment} | Status: ${incident.status}`,
      incident.rootCause ? `Detail: ${incident.rootCause}` : '',
      extra ?? '',
    ].filter(Boolean).join('\n'),
    severity: incident.severity,
    status,
    incidentId: incident.id,
    link: incidentLink(incident.id),
  };
  for (const ch of channels) void sendToChannel(ch, msg);
  return true;
}

/**
 * Escalation for an incident still unacknowledged after policy.autoEscalateAfterMin: one [ESCALATED]
 * message to the policy's escalation channels (all enabled channels when none are chosen) and an
 * email to every active user marked On-Call (when SMTP is configured). Happens once per incident.
 */
export function escalateIncident(incident: Incident, policy: EscalationPolicy): { channels: number; onCall: number } {
  incident.escalatedAt = new Date().toISOString();
  const enabled = db.channels.filter(c => c.enabled);
  const chosen = policy.escalationChannels?.length ? enabled.filter(c => policy.escalationChannels!.includes(c.id)) : enabled;
  const onCall = db.users.filter(u => u.isActive && u.isOnCall && u.email);
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(incident.startedAt)) / 60000));
  const team = policy.escalateToTeam.trim();
  const msg: NotificationMessage = {
    title: `${incident.id} ${incident.title}`,
    text: [
      `Not acknowledged after ${minutes} min — escalated${team ? ` to ${team}` : ''}.`,
      `Severity: ${incident.severity} | Environment: ${incident.environment} | Owner: ${incident.owner || 'Unassigned'}`,
      incident.rootCause ? `Detail: ${incident.rootCause}` : '',
    ].filter(Boolean).join('\n'),
    severity: incident.severity,
    status: 'ESCALATED',
    incidentId: incident.id,
    link: incidentLink(incident.id),
  };
  for (const ch of chosen) void sendToChannel(ch, msg);
  const emailOnCall = onCall.length > 0 && isSmtpConfigured();
  if (emailOnCall) {
    const direct = { id: 'on-call', name: 'On-call users', type: 'EMAIL', targetEndpoint: onCall.map(u => u.email).join(', '), enabled: true } as CommunicationChannel;
    void deliverWithRetry(direct, msg).catch(err => log.error('notify', `escalation email to on-call users failed: ${(err as Error).message}`));
  }
  const who = [
    chosen.length ? `${chosen.length} channel(s)` : '',
    emailOnCall ? `${onCall.length} on-call user(s) by email` : onCall.length ? `${onCall.length} on-call user(s) not emailed (SMTP not configured)` : '',
  ].filter(Boolean).join(' + ') || 'nobody (no enabled channel, no on-call user)';
  timelineNote(incident, 'CRITICAL', `Escalated${team ? ` to ${team}` : ''}: unacknowledged after ${minutes} min → ${who}`);
  persist();
  broadcast('incident_update', incident);
  audit('Escalation Policy', 'INCIDENT_ESCALATED', 'INCIDENT', incident.id, `${incident.title}: unacknowledged after ${minutes} min → ${who}`);
  return { channels: chosen.length, onCall: emailOnCall ? onCall.length : 0 };
}

export function notifyAll(title: string, text: string, severity = 'INFO') {
  for (const ch of channelsForSeverity(severity)) void sendToChannel(ch, { title, text, severity, status: 'INFO' });
}

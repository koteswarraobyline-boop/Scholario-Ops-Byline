import crypto from 'crypto';
import http from 'http';
import https from 'https';
import net from 'net';
import nodemailer, { type Transporter } from 'nodemailer';
import { CommunicationChannel, Incident, EscalationPolicy, EscalationStep } from '../src/types/index.ts';
import { config, isSmtpConfigured } from './config.ts';
import { db, persist } from './store.ts';
import { broadcast, audit } from './events.ts';
import { log } from './logger.ts';
import { guardedLookup, addressRefusal, UnsafeTargetError, policyFromEnv, type TargetPolicy } from './netguard.ts';
import { recordDelivery, recentIncidentSends } from './deliveries.ts';
import { isSealed } from './secrets.ts';
import { isQuietTime, quietUntil } from '../src/lib/quietHours.ts';

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

/** Destinations allowed to resolve to private / loopback addresses (NOTIFY_ALLOWED_PRIVATE_TARGETS) */
export const notifyTargetPolicy = (): TargetPolicy => policyFromEnv(config.notifyAllowedPrivateTargets);

/** Plain-language reasons for the destination's answer (shown in the UI and the delivery log) */
const HTTP_HINTS: Record<number, string> = {
  400: 'the destination rejected the message format',
  401: 'the destination needs credentials — the webhook URL or key may be wrong or revoked',
  403: 'the destination refused access — the webhook may be disabled or the key revoked',
  404: 'nothing at this URL — the webhook was deleted or the URL is mistyped',
  405: 'this URL does not accept POST requests — it is probably a web page or channel link, not a webhook URL',
  410: 'the webhook no longer exists',
  413: 'the message is too large for the destination',
  429: 'the destination is rate-limiting — retried later',
};

/** A failure that retrying cannot fix (bad URL, rejected payload, missing configuration) */
class PermanentDeliveryError extends Error {}

/**
 * Outgoing webhooks are signed when NOTIFY_WEBHOOK_SECRET is set, so the receiver can verify the
 * sender: X-Scholario-Signature = "sha256=" + HMAC-SHA256(secret, `${X-Scholario-Timestamp}.${body}`).
 */
/** Answer bodies larger than this are cut (enough for error messages; protects memory) */
const MAX_RESPONSE_BYTES = 64 * 1024;
const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * POSTs JSON to a notification destination through the SSRF guard (server/netguard.ts):
 * only https (plain http only for explicitly allowed private targets), the connection goes to the
 * address that was checked (no DNS rebinding), redirects are never followed, the answer is capped.
 */
async function postJson(url: string, body: unknown, sign = false) {
  const payload = JSON.stringify(body);
  let target: URL;
  try { target = new URL(url); } catch { throw new PermanentDeliveryError('The destination is not a valid URL'); }
  const policy = notifyTargetPolicy();
  const host = target.hostname.replace(/^\[|\]$/g, '');
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && policy.allowPrivate.some(e => e.trim().toLowerCase() === host.toLowerCase()))) {
    throw new PermanentDeliveryError('Only https:// destinations are allowed');
  }
  if (target.username || target.password) throw new PermanentDeliveryError('Credentials in the URL are not allowed');
  // An IP-address host skips DNS (and so the guarded lookup): check it here, before any connection
  if (net.isIP(host)) {
    const why = addressRefusal(host, host, policy);
    if (why) throw new PermanentDeliveryError(`Refused: ${host} → ${why}`);
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)), 'User-Agent': 'Scholario-Ops-Notifier' };
  if (sign && config.notifyWebhookSecret) {
    const ts = String(Math.floor(Date.now() / 1000));
    headers['X-Scholario-Timestamp'] = ts;
    headers['X-Scholario-Signature'] = `sha256=${crypto.createHmac('sha256', config.notifyWebhookSecret).update(`${ts}.${payload}`).digest('hex')}`;
  }
  const { status, text, retryAfter } = await new Promise<{ status: number; text: string; retryAfter?: string }>((resolve, reject) => {
    const mod = target.protocol === 'https:' ? https : http;
    const req = mod.request(target, { method: 'POST', headers, lookup: guardedLookup(policy) }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size <= MAX_RESPONSE_BYTES) chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), retryAfter: String(res.headers['retry-after'] ?? '') || undefined }));
      res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error(`timed out after ${DELIVERY_TIMEOUT_MS / 1000} s`)), DELIVERY_TIMEOUT_MS);
    req.on('close', () => clearTimeout(timer));
    req.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      // A refused destination is not a temporary failure: never retried
      reject(err.code === 'EUNSAFETARGET' || err instanceof UnsafeTargetError ? new PermanentDeliveryError(err.message) : err);
    });
    req.end(payload);
  });
  if (status >= 300 && status < 400) {
    throw new PermanentDeliveryError(`HTTP ${status} — the destination redirects; redirects are not followed (update the URL to the final address)`);
  }
  if (status < 200 || status >= 300) {
    const msg = `HTTP ${status}${HTTP_HINTS[status] ? ` — ${HTTP_HINTS[status]}` : ''}${text.trim() ? `: ${text.trim().slice(0, 200)}` : ''}`;
    // 4xx (except 408 / 429) means the request itself is wrong: retrying sends the same wrong request
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) throw new PermanentDeliveryError(msg);
    // The destination says when to come back (429 / 503): honoured by the retry, within limits
    throw Object.assign(new Error(msg), { retryAfterMs: parseRetryAfter(retryAfter) });
  }
}

/** Delays before the 2nd and 3rd attempt (tests shorten them) */
export const RETRY_DELAYS_MS = [2_000, 8_000];

/** deliver() with retries for temporary failures (network errors, timeouts, 5xx, 408, 429) */
/** Final failure after all attempts (attempts = how many were made) */
class DeliveryFailure extends Error {
  constructor(public readonly cause: Error, public readonly attempts: number) { super(cause.message); }
}

/** "Retry-After: 12" or an HTTP date → milliseconds (undefined when absent / unreadable) */
function parseRetryAfter(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}
/** Longest wait a destination may ask for before the next attempt */
const MAX_RETRY_AFTER_MS = 30_000;
/** Live counters for the notification health view */
const runtime = { inFlight: 0, waitingRetry: 0, retriesTotal: 0 };
export const deliveryRuntime = () => ({ ...runtime });

async function deliverWithRetry(channel: CommunicationChannel, msg: NotificationMessage): Promise<number> {
  runtime.inFlight++;
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await deliver(channel, msg);
        return attempt;
      } catch (err) {
        const base = RETRY_DELAYS_MS[attempt - 1];
        if (err instanceof PermanentDeliveryError || base === undefined) throw new DeliveryFailure(err as Error, attempt);
        // Exponential steps with up to 30 % random jitter (no synchronized retry bursts); a Retry-After
        // from the destination wins when it is longer, up to MAX_RETRY_AFTER_MS
        const asked = (err as { retryAfterMs?: number }).retryAfterMs;
        const delay = Math.round(Math.max(base + Math.random() * base * 0.3, Math.min(asked ?? 0, MAX_RETRY_AFTER_MS)));
        log.warn('notify', `${channel.type} channel "${channel.name}" attempt ${attempt} failed (${(err as Error).message}) — retrying in ${(delay / 1000).toFixed(1)}s`);
        runtime.retriesTotal++;
        runtime.waitingRetry++;
        try { await new Promise(r => setTimeout(r, delay)); } finally { runtime.waitingRetry--; }
      }
    }
  } finally {
    runtime.inFlight--;
  }
}

/**
 * Teams "Workflows" webhooks (Power Automate: *.logic.azure.com, *.powerplatform.com) only post
 * Adaptive Cards; the retired Office 365 connector URLs (*.webhook.office.com) take MessageCards.
 * Sending a MessageCard to a Workflows URL is accepted (202) but nothing appears in the channel.
 */
export const isTeamsWorkflowUrl = (url: string) => {
  try { return /(^|\.)(logic\.azure\.com|powerplatform\.com|api\.powerplatform\.com)$/i.test(new URL(url).hostname); } catch { return false; }
};

export function teamsPayload(url: string, msg: NotificationMessage): Record<string, unknown> {
  if (!isTeamsWorkflowUrl(url)) {
    return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      themeColor: COLORS[msg.status],
      summary: msg.title,
      title: `[${msg.status}] ${msg.title}`,
      text: msg.text.replace(/\n/g, '<br>'),
      potentialAction: msg.link ? [{ '@type': 'OpenUri', name: 'Open in Scholario Ops', targets: [{ os: 'default', uri: msg.link }] }] : undefined,
    };
  }
  const color = msg.status === 'FIRING' ? 'Attention' : msg.status === 'ESCALATED' ? 'Warning' : msg.status === 'RESOLVED' ? 'Good' : 'Accent';
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        msteams: { width: 'Full' },
        body: [
          { type: 'TextBlock', text: `[${msg.status}] ${msg.title}`, weight: 'Bolder', size: 'Medium', color, wrap: true },
          ...msg.text.split('\n').filter(Boolean).map(line => ({ type: 'TextBlock', text: line, wrap: true, spacing: 'Small' })),
        ],
        actions: msg.link ? [{ type: 'Action.OpenUrl', title: 'Open in Scholario Ops', url: msg.link }] : [],
      },
    }],
  };
}

const COLORS: Record<NotificationMessage['status'], string> = { FIRING: 'D13438', RESOLVED: '2EB886', ESCALATED: 'FF8C00', INFO: '0078D7', TEST: '0078D7' };

async function deliver(channel: CommunicationChannel, msg: NotificationMessage) {
  const target = channel.targetEndpoint.trim();
  if (!target) throw new PermanentDeliveryError('Channel has no target configured');
  if (isSealed(target)) throw new PermanentDeliveryError('The stored channel target cannot be decrypted (the secrets key changed or was lost) — edit the channel and enter it again');
  switch (channel.type) {
    case 'TEAMS':
      await postJson(target, teamsPayload(target, msg));
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

/** Delivers with retries and writes the result to the delivery log */
async function deliverAndRecord(channel: CommunicationChannel, msg: NotificationMessage, resendOf?: string): Promise<{ ok: boolean; error?: string; deliveryId: string }> {
  const started = Date.now();
  const base = {
    channelId: channel.id, channelName: channel.name, channelType: channel.type, kind: msg.status, incidentId: msg.incidentId,
    severity: msg.severity, title: msg.title, durationMs: 0, resendOf,
    message: { title: msg.title, text: msg.text, severity: msg.severity, status: msg.status, incidentId: msg.incidentId, link: msg.link },
  };
  try {
    const attempts = await deliverWithRetry(channel, msg);
    if (attempts > 1) log.info('notify', `${channel.type} channel "${channel.name}" delivered on attempt ${attempts}`);
    const row = recordDelivery({ ...base, result: 'DELIVERED', attempts, durationMs: Date.now() - started });
    return { ok: true, deliveryId: row.id };
  } catch (err) {
    const attempts = err instanceof DeliveryFailure ? err.attempts : 1;
    const message = (err as Error).message;
    const row = recordDelivery({ ...base, result: 'FAILED', attempts, durationMs: Date.now() - started, error: message });
    return { ok: false, error: message, deliveryId: row.id };
  }
}

/** Sends to one channel, records the result on the channel and in the delivery log. */
export async function sendToChannel(channel: CommunicationChannel, msg: NotificationMessage, resendOf?: string): Promise<{ ok: boolean; error?: string; deliveryId?: string }> {
  try {
    const r = await deliverAndRecord(channel, msg, resendOf);
    channel.lastDeliveryAt = new Date().toISOString();
    channel.lastDeliveryStatus = r.ok ? 'DELIVERED' : 'FAILED';
    if (r.ok) channel.failureCount = 0;
    else {
      channel.failureCount += 1;
      log.error('notify', `${channel.type} channel "${channel.name}" failed: ${r.error}`);
    }
    return r;
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

/** Open notification groups per application: the first alert was sent, these wait for the summary */
const groups = new Map<string, { items: Incident[]; timer: ReturnType<typeof setTimeout>; openedAt: number }>();
const SEV_RANK: Record<string, number> = { INFO: 0, WARNING: 1, HIGH: 2, CRITICAL: 3, EMERGENCY: 4 };

/** Removes a not-yet-sent grouped incident (it recovered before the summary went out) */
function dropFromGroup(incident: Incident): boolean {
  const g = incident.applicationId ? groups.get(incident.applicationId) : undefined;
  const i = g ? g.items.findIndex(x => x.id === incident.id) : -1;
  if (!g || i < 0) return false;
  g.items.splice(i, 1);
  timelineNote(incident, 'INFO', 'Recovered before the grouped notification was sent — nobody was paged for it');
  persist();
  return true;
}

/** Sends the summary of one application's group (one message, all its alerts) */
function flushGroup(applicationId: string) {
  const g = groups.get(applicationId);
  if (!g) return;
  clearTimeout(g.timer);
  groups.delete(applicationId);
  const items = g.items.filter(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  if (items.length === 0) return;
  for (const i of items) firingSent.add(i.id);
  const top = items.reduce((a, b) => ((SEV_RANK[b.severity] ?? 0) > (SEV_RANK[a.severity] ?? 0) ? b : a));
  const appName = db.applications.find(a => a.id === applicationId)?.name ?? 'the same application';
  const msg: NotificationMessage = items.length === 1
    ? {
      title: `${items[0].id} ${items[0].title}`,
      text: [`Severity: ${items[0].severity} | Environment: ${items[0].environment} | Status: ${items[0].status}`, items[0].rootCause ? `Detail: ${items[0].rootCause}` : ''].filter(Boolean).join('\n'),
      severity: items[0].severity, status: 'FIRING', incidentId: items[0].id, link: incidentLink(items[0].id),
    }
    : {
      title: `${items.length} more alerts for ${appName}`,
      text: [`Grouped: ${items.length} further alerts for ${appName} within ${config.notifyGroupWindowSec} s of the first one.`, ...items.map(i => `• ${i.id} [${i.severity}] ${i.title}`)].join('\n'),
      severity: top.severity, status: 'FIRING', incidentId: top.id, link: incidentLink(top.id),
    };
  for (const ch of channelsForSeverity(top.severity)) void sendToChannel(ch, msg);
  log.info('notify', `grouped notification for ${appName}: ${items.length} alert(s)`);
}

/** Alerts waiting in an open group for their summary */
export const pendingGroupedAlerts = () => [...groups.values()].reduce((n, g) => n + g.items.length, 0);

/** Sends every pending group now (graceful shutdown, tests) */
export function flushNotificationGroups() { for (const id of [...groups.keys()]) flushGroup(id); }

/** Severities whose notifications are never held by quiet hours */
export const NEVER_QUIET: ReadonlyArray<Incident['severity']> = ['CRITICAL', 'EMERGENCY'];

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
export function notifyIncident(incident: Incident, status: 'FIRING' | 'RESOLVED', extra?: string, opts: { afterDelay?: boolean; quietRelease?: boolean } = {}): boolean {
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
  // Quiet hours (never for CRITICAL / EMERGENCY): hold the notification until they end. Opened and
  // recovered inside quiet hours → nobody is paged. Reminders inside quiet hours are skipped.
  if (!opts.quietRelease && policy?.quietHours && !NEVER_QUIET.includes(incident.severity) && isQuietTime(new Date(), policy.quietHours)) {
    if (status === 'RESOLVED' && incident.quietHeld?.status === 'FIRING') {
      incident.quietHeld = undefined;
      timelineNote(incident, 'INFO', 'Opened and recovered during quiet hours — nobody was paged');
      persist();
      return false;
    }
    if (!isReminderMsg) {
      incident.quietHeld = { status, since: new Date().toISOString(), extra };
      timelineNote(incident, 'INFO', `${status === 'FIRING' ? 'Notification' : 'Recovery notification'} held: quiet hours until ${quietUntil(policy.quietHours)}`);
      persist();
      log.info('notify', `${incident.id}: ${status} held for quiet hours`);
    }
    return false;
  }
  if (status === 'RESOLVED' && dropFromGroup(incident)) return false;
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
  // Several non-critical alerts for one application within the window: the first goes out now, the
  // others in one summary when the window closes (CRITICAL / EMERGENCY are never grouped or delayed)
  if (status === 'FIRING' && !isReminderMsg && incident.applicationId && config.notifyGroupWindowSec > 0 && !NEVER_QUIET.includes(incident.severity)) {
    const g = groups.get(incident.applicationId);
    if (g) {
      if (!g.items.some(i => i.id === incident.id)) {
        g.items.push(incident);
        timelineNote(incident, 'INFO', `Included in a grouped notification for this application (sent within ${config.notifyGroupWindowSec} s)`);
        persist();
      }
      return true;
    }
    const timer = setTimeout(() => flushGroup(incident.applicationId), config.notifyGroupWindowSec * 1000);
    timer.unref?.();
    groups.set(incident.applicationId, { items: [], timer, openedAt: now });
  }
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
 * The ordered escalation steps of a policy. Policies saved before multi-step escalation (or edited
 * with the single "Escalate after" setting) become one step.
 */
export function policySteps(policy: EscalationPolicy): EscalationStep[] {
  if (policy.steps?.length) return [...policy.steps].filter(s => s.afterMin > 0).sort((a, b) => a.afterMin - b.afterMin);
  return policy.autoEscalateAfterMin > 0
    ? [{ afterMin: policy.autoEscalateAfterMin, channels: policy.escalationChannels ?? [], notifyOnCall: true, label: policy.escalateToTeam ?? '' }]
    : [];
}

/**
 * Runs escalation step `index` of `steps` for an incident still unacknowledged: one [ESCALATED]
 * message to the step's channels (all enabled channels when none are chosen) and, when the step says
 * so, an email to every active user marked On-Call (when SMTP is configured). The step counter is
 * stored on the incident before anything is sent, so a step never runs twice — not even across a
 * restart or a crash in the middle of sending.
 */
export function escalateStep(incident: Incident, steps: EscalationStep[], index: number): { channels: number; onCall: number } {
  const step = steps[index];
  const nowIso = new Date().toISOString();
  const nextStep = steps[index + 1];
  incident.escalatedAt ??= nowIso;
  incident.escalation = {
    stepsDone: index + 1,
    nextAt: nextStep ? new Date(Date.parse(incident.startedAt) + nextStep.afterMin * 60000).toISOString() : null,
    history: [...(incident.escalation?.history ?? [])],
  };
  persist(); // durable before sending: idempotent per step

  const enabled = db.channels.filter(c => c.enabled);
  const chosen = step.channels.length ? enabled.filter(c => step.channels.includes(c.id)) : enabled;
  const onCall = step.notifyOnCall ? db.users.filter(u => u.isActive && u.isOnCall && u.email) : [];
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(incident.startedAt)) / 60000));
  const team = step.label.trim();
  const stepText = steps.length > 1 ? ` (step ${index + 1} of ${steps.length})` : '';
  const msg: NotificationMessage = {
    title: `${incident.id} ${incident.title}`,
    text: [
      `Not acknowledged after ${minutes} min — escalated${team ? ` to ${team}` : ''}${stepText}.`,
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
    void deliverAndRecord(direct, msg).then(r => { if (!r.ok) log.error('notify', `escalation email to on-call users failed: ${r.error}`); });
  }
  const who = [
    chosen.length ? `${chosen.length} channel(s)` : '',
    emailOnCall ? `${onCall.length} on-call user(s) by email` : onCall.length ? `${onCall.length} on-call user(s) not emailed (SMTP not configured)` : '',
  ].filter(Boolean).join(' + ') || 'nobody (no enabled channel, no on-call user)';
  incident.escalation.history.push({ step: index + 1, at: nowIso, label: team, channels: chosen.length, onCall: emailOnCall ? onCall.length : 0 });
  timelineNote(incident, 'CRITICAL', `Escalated${team ? ` to ${team}` : ''}${stepText}: unacknowledged after ${minutes} min → ${who}`);
  persist();
  broadcast('incident_update', incident);
  audit('Escalation Policy', 'INCIDENT_ESCALATED', 'INCIDENT', incident.id, `${incident.title}${stepText}: unacknowledged after ${minutes} min → ${who}`);
  return { channels: chosen.length, onCall: emailOnCall ? onCall.length : 0 };
}

/** Escalation stops for good once somebody acknowledges or the incident is resolved (recorded once) */
export function stopEscalation(incident: Incident, reason: 'acknowledged' | 'resolved') {
  const e = incident.escalation;
  if (!e || e.stoppedAt || e.nextAt === null) return;
  e.stoppedAt = new Date().toISOString();
  e.stoppedReason = reason;
  e.nextAt = null;
  timelineNote(incident, 'INFO', `Escalation stopped: incident ${reason} (after step ${e.stepsDone})`);
  persist();
}

/** Compatibility: the single-step escalation of older code paths */
export function escalateIncident(incident: Incident, policy: EscalationPolicy) {
  const steps = policySteps(policy);
  return steps.length ? escalateStep(incident, steps, 0) : { channels: 0, onCall: 0 };
}

export function notifyAll(title: string, text: string, severity = 'INFO') {
  for (const ch of channelsForSeverity(severity)) void sendToChannel(ch, { title, text, severity, status: 'INFO' });
}

/**
 * Rebuilds the duplicate protection after a restart from the delivery log: the per-alert cooldown
 * (fingerprint + status + severity) and which open incidents already had their FIRING delivered
 * (so their RESOLVED is always sent). Without this a restart forgot both.
 */
export async function restoreNotificationMemory(): Promise<number> {
  const rows = await recentIncidentSends(24);
  let n = 0;
  for (const r of rows) {
    const inc = db.incidents.find(i => i.id === r.incidentId);
    if (!inc?.fingerprint) continue;
    const key = `${inc.fingerprint}|${r.kind}|${r.severity}`;
    const t = Date.parse(r.t);
    if (t > (lastSent.get(key) ?? 0)) { lastSent.set(key, t); n++; }
    if (r.kind === 'FIRING' && r.delivered && inc.status !== 'RESOLVED' && inc.status !== 'CLOSED') firingSent.add(inc.id);
  }
  return n;
}

/** For tests: forget the in-memory duplicate protection (simulates a process restart) */
export function forgetNotificationMemoryForTests() { lastSent.clear(); firingSent.clear(); }

/** A channel with this many failed deliveries in a row is reported as failing (health view + alert) */
export const CHANNEL_FAILING_AFTER = 3;

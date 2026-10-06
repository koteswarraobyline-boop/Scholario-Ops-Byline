import nodemailer from 'nodemailer';
import { CommunicationChannel, Incident } from '../src/types/index.ts';
import { config, isSmtpConfigured } from './config.ts';
import { db, persist } from './store.ts';
import { broadcast } from './events.ts';

export interface NotificationMessage {
  title: string;
  text: string;
  severity: string;
  status: 'FIRING' | 'RESOLVED' | 'INFO' | 'TEST';
  incidentId?: string;
  link?: string;
}

let transporter: nodemailer.Transporter | null = null;
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

async function postJson(url: string, body: unknown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

const COLORS: Record<NotificationMessage['status'], string> = { FIRING: 'D13438', RESOLVED: '2EB886', INFO: '0078D7', TEST: '0078D7' };

async function deliver(channel: CommunicationChannel, msg: NotificationMessage) {
  const target = channel.targetEndpoint.trim();
  if (!target) throw new Error('Channel has no target configured');
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
      await postJson(target, { ...msg, details: msg.text, text: `*[${msg.status}] ${msg.title}*\n${msg.text}${msg.link ? `\n${msg.link}` : ''}` });
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
      if (!t) throw new Error('SMTP is not configured (SMTP_HOST / SMTP_FROM)');
      await t.sendMail({
        from: config.smtp.from,
        to: target,
        subject: `[${msg.status}] ${msg.title}`,
        text: `${msg.text}${msg.link ? `\n\n${msg.link}` : ''}`,
      });
      return;
    }
    default:
      throw new Error(`Unsupported channel type ${channel.type}`);
  }
}

/** Sends to one channel and records the delivery result on the channel. */
export async function sendToChannel(channel: CommunicationChannel, msg: NotificationMessage): Promise<{ ok: boolean; error?: string }> {
  try {
    await deliver(channel, msg);
    channel.lastDeliveryAt = new Date().toISOString();
    channel.lastDeliveryStatus = 'DELIVERED';
    channel.failureCount = 0;
    return { ok: true };
  } catch (err) {
    channel.lastDeliveryAt = new Date().toISOString();
    channel.lastDeliveryStatus = 'FAILED';
    channel.failureCount += 1;
    console.error(`[notify] ${channel.type} channel "${channel.name}" failed: ${(err as Error).message}`);
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

export function notifyIncident(incident: Incident, status: 'FIRING' | 'RESOLVED', extra?: string) {
  const channels = channelsForSeverity(incident.severity);
  if (channels.length === 0) return;
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
}

export function notifyAll(title: string, text: string, severity = 'INFO') {
  for (const ch of channelsForSeverity(severity)) void sendToChannel(ch, { title, text, severity, status: 'INFO' });
}

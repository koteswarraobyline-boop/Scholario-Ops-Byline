import crypto from 'crypto';
import http from 'http';
import https from 'https';
import net from 'net';
import dns from 'dns';
import { createRequire } from 'module';
import nodemailer, { type Transporter } from 'nodemailer';
import { CommunicationChannel, Incident, EscalationPolicy, EscalationStep } from '../src/types/index.ts';
import { config } from './config.ts';
import { db, persist } from './store.ts';
import { broadcast, audit } from './events.ts';
import { log } from './logger.ts';
import { guardedLookup, addressRefusal, UnsafeTargetError, policyFromEnv, type TargetPolicy } from './netguard.ts';
import { recordDelivery, recentIncidentSends, recentDeliveredFiringMessages } from './deliveries.ts';
import { isSealed } from './secrets.ts';
import { isQuietTime, quietUntil } from '../src/lib/quietHours.ts';
import { isNotificationWorker } from './leader.ts';

export interface NotificationMessage {
  title: string;
  text: string;
  severity: string;
  status: 'FIRING' | 'RESOLVED' | 'ESCALATED' | 'INFO' | 'TEST';
  incidentId?: string;
  link?: string;
}

const wellKnown = createRequire(import.meta.url)('nodemailer/lib/well-known') as (name: string) => { host?: string; port?: number; secure?: boolean } | false;

/** The mail server to contact: SMTP_HOST, or the host of the SMTP_SERVICE preset. null when neither is usable. */
export function smtpEndpoint(): { host: string; port: number; secure: boolean } | null {
  const s = config.smtp;
  // An explicit host wins over a preset (lets a preset be pointed at a regional endpoint)
  if (s.host) return { host: s.host, port: s.port, secure: s.secure ?? s.port === 465 };
  if (!s.service) return null;
  const p = wellKnown(s.service);
  if (!p || !p.host) return null;
  if (s.portSet) return { host: p.host, port: s.port, secure: s.secure ?? s.port === 465 };
  const port = p.port ?? 587;
  return { host: p.host, port, secure: s.secure ?? p.secure ?? port === 465 };
}

/** What is missing or wrong in the SMTP settings (names only — never values), or null when complete */
export function smtpConfigProblem(): string | null {
  const s = config.smtp;
  if (!s.host && !s.service) return 'SMTP is not configured: set SMTP_HOST (or SMTP_SERVICE / SMTP_URL) and SMTP_FROM in the server .env, then restart';
  if (!s.host && !smtpEndpoint()) return `SMTP_SERVICE "${s.service}" is not a known provider preset — use SMTP_HOST / SMTP_PORT instead`;
  if (!s.from) return 'SMTP_FROM is not set (and SMTP_USER is not an email address to fall back to)';
  if (!/^(.*<\s*)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+(\s*>)?$/.test(s.from)) return 'SMTP_FROM is not a valid email address (use alerts@example.com or "Ops Alerts <alerts@example.com>")';
  if (s.user && !s.pass) return 'SMTP_USER is set but SMTP_PASS is empty';
  if (!s.user && s.pass) return 'SMTP_PASS is set but SMTP_USER is empty';
  const ep = smtpEndpoint();
  if (ep?.port === 465 && !ep.secure) return 'Port 465 uses implicit TLS but SMTP_SECURE=false: set SMTP_SECURE=true (or remove it), or use port 587';
  if (ep?.port === 587 && ep.secure) return 'Port 587 uses STARTTLS but SMTP_SECURE=true: set SMTP_SECURE=false (or remove it), or use port 465';
  return null;
}

/** nodemailer options; `address` is the checked IP to connect to (TLS still verifies the host name) */
export function smtpTransportOptions(address?: string): Record<string, unknown> {
  const s = config.smtp;
  const ep = smtpEndpoint();
  if (!ep) throw new PermanentDeliveryError(smtpConfigProblem() ?? 'SMTP is not configured');
  return {
    host: address ?? ep.host,
    port: ep.port,
    secure: ep.secure,
    servername: ep.host,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    requireTLS: s.requireTls || undefined,
    tls: { rejectUnauthorized: s.tlsRejectUnauthorized, servername: ep.host },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

/**
 * Resolves the mail server and applies the outbound guard (server/netguard.ts): link-local / cloud
 * metadata is always refused; loopback / private only when listed in NOTIFY_ALLOWED_PRIVATE_TARGETS.
 * The returned address is the one connected to (no second resolution, no DNS rebinding).
 */
export async function resolveSmtpAddress(host: string): Promise<string> {
  const policy = notifyTargetPolicy();
  const allowedName = policy.allowPrivate.some(e => e.trim().toLowerCase() === host.toLowerCase());
  if (!net.isIP(host) && /^(localhost|.*\.localhost|metadata(\.google\.internal)?|.*\.internal|.*\.local)$/i.test(host) && !allowedName) {
    throw new PermanentDeliveryError(`Refused: mail server ${host} is an internal host name (allow it explicitly with NOTIFY_ALLOWED_PRIVATE_TARGETS)`);
  }
  let addresses: string[];
  if (net.isIP(host)) addresses = [host];
  else {
    try { addresses = (await dns.promises.lookup(host, { all: true, verbatim: true })).map(a => a.address); }
    catch { throw new Error(`Cannot reach the mail server: ${host} does not resolve (check SMTP_HOST / DNS)`); }
  }
  for (const ip of addresses) {
    const why = addressRefusal(ip, host, policy);
    if (why) throw new PermanentDeliveryError(`Refused: mail server ${host} → ${why}`);
  }
  return addresses[0];
}

/** A transport for one send / check, connected to the checked address */
async function mailer(): Promise<Transporter> {
  const problem = smtpConfigProblem();
  if (problem) throw new PermanentDeliveryError(problem);
  const ep = smtpEndpoint()!;
  return nodemailer.createTransport(smtpTransportOptions(await resolveSmtpAddress(ep.host)));
}

/** Server replies can echo what was sent: the password never leaves in an error message */
const redactSmtp = (s: string) => (config.smtp.pass && config.smtp.pass.length >= 4 ? s.split(config.smtp.pass).join('••••') : s);

/**
 * SMTP failure → plain-language reason. Authentication, sender / recipient refusals and TLS
 * mismatches are permanent (retrying sends the same request); network trouble and 4xx are retried.
 */
export function describeSmtpError(err: unknown): { message: string; permanent: boolean } {
  if (err instanceof PermanentDeliveryError) return { permanent: true, message: redactSmtp(err.message) };
  const e = err as { code?: string; responseCode?: number; response?: string; message?: string };
  const raw = redactSmtp((e.response || e.message || 'unknown error').trim()).slice(0, 300);
  const code = e.responseCode;
  const where = smtpServerLabel();
  if (/^Cannot reach the mail server/.test(raw)) return { permanent: false, message: raw };
  if (e.code === 'EAUTH' || code === 535 || code === 534 || code === 530) {
    return { permanent: true, message: `SMTP login rejected (${raw}). Check SMTP_USER / SMTP_PASS. Gmail and Microsoft 365 need an app password (or SMTP AUTH enabled for the mailbox); SendGrid uses the user "apikey" with the API key as password.` };
  }
  if (/wrong version number|ssl3_get_record|unknown protocol|EPROTO/i.test(raw) || e.code === 'ETLS') {
    return { permanent: true, message: `TLS mismatch with ${where} (${raw}). Use port 465 with SMTP_SECURE=true, or port 587 with SMTP_SECURE=false (STARTTLS).` };
  }
  if (/self[- ]signed|unable to verify|certificate/i.test(raw)) {
    return { permanent: true, message: `The certificate of ${where} is not trusted (${raw}). For an internal relay with its own certificate set SMTP_TLS_REJECT_UNAUTHORIZED=false.` };
  }
  if (e.code === 'EENVELOPE' || (code !== undefined && code >= 550 && code <= 554)) {
    return { permanent: true, message: `The mail server refused the message (${raw}). SMTP_FROM must be an address this account may send as, and the recipients must be valid.` };
  }
  if (code !== undefined && code >= 500) return { permanent: true, message: `SMTP error ${code}: ${raw}` };
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNECTION' || e.code === 'ESOCKET' || e.code === 'EDNS' || /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timeout/i.test(raw)) {
    return { permanent: false, message: `Cannot reach the mail server ${where} (${raw}). Check the host and port, and that outbound SMTP is allowed by the firewall / hosting provider (port 25 is often blocked — use 587 or 465).` };
  }
  return { permanent: false, message: `SMTP error${code ? ` ${code}` : ''}: ${raw}` };
}

/** "smtp.gmail.com:465 (Gmail)" — host and port only, never credentials */
export function smtpServerLabel(): string {
  const ep = smtpEndpoint();
  if (!ep) return config.smtp.service || '(not configured)';
  return `${ep.host}:${ep.port}${config.smtp.service && !config.smtp.host ? ` (${config.smtp.service})` : ''}`;
}

/** Connects and logs in without sending anything (Setup / Notifications "Check SMTP") */
export async function verifySmtp(): Promise<{ ok: boolean; error?: string; server: string }> {
  const server = smtpServerLabel();
  let t: Transporter | null = null;
  try {
    t = await mailer();
    await t.verify();
    return { ok: true, server };
  } catch (err) {
    return { ok: false, server, error: describeSmtpError(err).message };
  } finally {
    t?.close();
  }
}

const htmlEscape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Email body: plain text plus a simple HTML version (most clients show the HTML) */
export function emailContent(msg: NotificationMessage): { subject: string; text: string; html: string } {
  const color = `#${COLORS[msg.status]}`;
  const lines = msg.text.split('\n').filter(Boolean).map(l => `<p style="margin:0 0 6px">${htmlEscape(l)}</p>`).join('');
  const link = msg.link ? `<p style="margin:14px 0 0"><a href="${htmlEscape(msg.link)}" style="color:#0b5cad">Open in Scholario Ops</a></p>` : '';
  return {
    subject: `[${msg.status}] ${msg.title}`,
    text: `${msg.text}${msg.link ? `\n\n${msg.link}` : ''}`,
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2933">`
      + `<div style="border-left:4px solid ${color};padding:4px 12px;margin-bottom:12px"><strong style="font-size:15px">[${msg.status}] ${htmlEscape(msg.title)}</strong></div>`
      + `${lines}${link}<p style="margin:16px 0 0;font-size:11px;color:#7b8794">Sent by Scholario Ops</p></div>`,
  };
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

/** "Get link to channel" opens Teams in a browser; a POST to it returns 405 and nothing is delivered */
export const TEAMS_CHANNEL_LINK = /^https:\/\/teams\.(microsoft\.com|cloud\.microsoft|live\.com)\//i;
export const TEAMS_CHANNEL_LINK_HELP = 'This is a link to a Teams channel, not a webhook — nothing was sent. In Teams open the channel → ⋯ → Workflows → "Post to a channel when a webhook request is received", then edit this channel and paste the URL it gives you.';

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

/**
 * Why a TEAMS target cannot receive messages, or null. Browser pages (channel / chat links, the
 * Power Automate editor, SharePoint, sign-in pages) answer a POST with 405 or a login page; a
 * Workflows URL without its sig= parameter is rejected with 401.
 */
export function teamsTargetProblem(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return 'The Teams webhook URL is not a valid URL'; }
  const host = u.hostname.toLowerCase();
  if (TEAMS_CHANNEL_LINK.test(url)) return TEAMS_CHANNEL_LINK_HELP;
  if (/(^|\.)(make\.powerautomate\.com|flow\.microsoft\.com|make\.powerapps\.com)$/.test(host)) {
    return 'This is the Power Automate editor page, not the webhook — nothing was sent. Open the flow, select the "When a Teams webhook request is received" trigger and copy its HTTP URL.';
  }
  if (/(^|\.)(sharepoint\.com|login\.microsoftonline\.com|login\.live\.com)$/.test(host)) {
    return 'This is a Microsoft web page, not a webhook — nothing was sent. Paste the Workflows webhook URL from the Teams channel (⋯ → Workflows).';
  }
  if (isTeamsWorkflowUrl(url) && !u.searchParams.get('sig')) {
    return 'The Workflows webhook URL is incomplete: the "sig=" parameter is missing (Teams would answer 401). Copy the whole URL from the workflow trigger.';
  }
  return null;
}

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

/** PagerDuty Events API v2 body. RESOLVED closes the incident (same dedup_key); everything else triggers. */
export function pagerdutyPayload(routingKey: string, msg: NotificationMessage): Record<string, unknown> {
  const severity = ['CRITICAL', 'EMERGENCY'].includes(msg.severity) ? 'critical'
    : msg.severity === 'HIGH' ? 'error'
      : msg.severity === 'WARNING' ? 'warning' : 'info';
  return {
    routing_key: routingKey,
    event_action: msg.status === 'RESOLVED' ? 'resolve' : 'trigger',
    dedup_key: msg.incidentId,
    payload: { summary: msg.title, source: 'scholario-ops', severity, custom_details: { text: msg.text } },
    links: msg.link ? [{ href: msg.link, text: 'Scholario Ops' }] : undefined,
  };
}

async function deliver(channel: CommunicationChannel, msg: NotificationMessage) {
  const target = channel.targetEndpoint.trim();
  if (!target) throw new PermanentDeliveryError('Channel has no target configured');
  if (isSealed(target)) throw new PermanentDeliveryError('The stored channel target cannot be decrypted (the secrets key changed or was lost) — edit the channel and enter it again');
  switch (channel.type) {
    case 'TEAMS':
      { const problem = teamsTargetProblem(target); if (problem) throw new PermanentDeliveryError(problem); }
      await postJson(target, teamsPayload(target, msg));
      return;
    case 'WEBHOOK':
      // `text` makes this compatible with Slack / Google Chat / Mattermost incoming webhooks
      await postJson(target, { ...msg, details: msg.text, text: `*[${msg.status}] ${msg.title}*\n${msg.text}${msg.link ? `\n${msg.link}` : ''}` }, true);
      return;
    case 'PAGERDUTY':
      await postJson('https://events.pagerduty.com/v2/enqueue', pagerdutyPayload(target, msg));
      return;
    case 'EMAIL': {
      const to = target.split(/[,;\s]+/).filter(Boolean);
      let t: Transporter | null = null;
      try {
        t = await mailer();
        await t.sendMail({ from: config.smtp.from, to, ...emailContent(msg) });
      } catch (err) {
        const d = describeSmtpError(err);
        throw d.permanent ? new PermanentDeliveryError(d.message) : new Error(d.message);
      } finally {
        t?.close();
      }
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
  incident.notifyGroupPending = undefined;
  timelineNote(incident, 'INFO', 'Recovered before the grouped notification was sent — nobody was paged for it');
  persist();
  return true;
}

const inOpenGroup = (incident: Incident) => {
  const g = incident.applicationId ? groups.get(incident.applicationId) : undefined;
  return Boolean(g && g.items.some(i => i.id === incident.id));
};

/**
 * One summary for the follow-up alerts of an application. Flags are cleared after the send is
 * recorded, so a crash in between is replayed from the flags and skipped when the log already
 * shows the summary was delivered.
 */
async function dispatchGroupSummary(applicationId: string, items: Incident[]): Promise<boolean> {
  const live = items.filter(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED' && !NEVER_QUIET.includes(i.severity));
  let dirty = false;
  for (const i of items) {
    if (!live.includes(i) && i.notifyGroupPending) { i.notifyGroupPending = undefined; dirty = true; }
  }
  if (live.length === 0) { if (dirty) persist(); return false; }
  for (const i of live) firingSent.add(i.id);
  const top = live.reduce((a, b) => ((SEV_RANK[b.severity] ?? 0) > (SEV_RANK[a.severity] ?? 0) ? b : a));
  const appName = db.applications.find(a => a.id === applicationId)?.name ?? 'the same application';
  const msg: NotificationMessage = live.length === 1
    ? {
      title: `${live[0].id} ${live[0].title}`,
      text: [`Severity: ${live[0].severity} | Environment: ${live[0].environment} | Status: ${live[0].status}`, live[0].rootCause ? `Detail: ${live[0].rootCause}` : ''].filter(Boolean).join('\n'),
      severity: live[0].severity, status: 'FIRING', incidentId: live[0].id, link: incidentLink(live[0].id),
    }
    : {
      title: `${live.length} more alerts for ${appName}`,
      text: [`Grouped: ${live.length} further alerts for ${appName} within ${config.notifyGroupWindowSec} s of the first one.`, ...live.map(i => `• ${i.id} [${i.severity}] ${i.title}`)].join('\n'),
      severity: top.severity, status: 'FIRING', incidentId: top.id, link: incidentLink(top.id),
    };
  await Promise.all(channelsForSeverity(top.severity).map(ch => sendToChannel(ch, msg)));
  for (const i of live) i.notifyGroupPending = undefined;
  persist();
  log.info('notify', `grouped notification for ${appName}: ${live.length} alert(s)`);
  return true;
}

/** Sends the summary of one application's group (one message, all its alerts) */
function flushGroup(applicationId: string): Promise<boolean> {
  const g = groups.get(applicationId);
  if (!g) return Promise.resolve(false);
  clearTimeout(g.timer);
  groups.delete(applicationId);
  return dispatchGroupSummary(applicationId, g.items);
}

/**
 * After a restart (leader only): open incidents still flagged from a group that never flushed.
 * Recovered and critical alerts are not grouped. A summary already in the delivery log is not sent again.
 */
export async function replayPendingGroupSummaries(): Promise<number> {
  if (!isNotificationWorker()) return 0;
  const sent = await recentDeliveredFiringMessages(24);
  const already = (id: string) => firingSent.has(id) || sent.some(s => s.incidentId === id || s.text.includes(`• ${id} [`));
  const byApp = new Map<string, Incident[]>();
  let dirty = false;
  const clear = (inc: Incident) => { if (inc.notifyGroupPending) { inc.notifyGroupPending = undefined; dirty = true; } };
  for (const inc of db.incidents) {
    if (!inc.notifyGroupPending || inOpenGroup(inc)) continue;
    if (inc.status === 'RESOLVED' || inc.status === 'CLOSED' || !inc.applicationId) { clear(inc); continue; }
    if (already(inc.id)) { firingSent.add(inc.id); clear(inc); continue; }
    if (NEVER_QUIET.includes(inc.severity)) {
      clear(inc);
      if (dirty) { persist(); dirty = false; }
      notifyIncident(inc, 'FIRING');
      continue;
    }
    const list = byApp.get(inc.applicationId) ?? [];
    list.push(inc);
    byApp.set(inc.applicationId, list);
  }
  if (dirty) persist();
  let n = 0;
  for (const [appId, items] of byApp) if (await dispatchGroupSummary(appId, items)) n++;
  return n;
}

/** Alerts waiting for a grouped summary: the live window, plus flags a restart has not replayed yet */
export const pendingGroupedAlerts = () => {
  const inMemory = new Set<string>();
  let n = 0;
  for (const g of groups.values()) for (const i of g.items) { inMemory.add(i.id); n++; }
  for (const i of db.incidents) {
    if (i.notifyGroupPending && !inMemory.has(i.id) && i.status !== 'RESOLVED' && i.status !== 'CLOSED') n++;
  }
  return n;
};

/** Sends every pending group now (graceful shutdown, tests) and resolves when those sends are recorded */
export function flushNotificationGroups(): Promise<void> {
  return Promise.all([...groups.keys()].map(id => flushGroup(id))).then(() => undefined);
}

/** For tests: drop the in-memory group window without sending, leaving the durable flags behind */
export function dropOpenGroupsForTests() {
  for (const g of groups.values()) clearTimeout(g.timer);
  groups.clear();
}

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
        // Durable: a crash inside the window still sends this summary on the next start
        incident.notifyGroupPending = new Date().toISOString();
        timelineNote(incident, 'INFO', `Included in a grouped notification for this application (sent within ${config.notifyGroupWindowSec} s)`);
        persist();
      }
      return true;
    }
    const timer = setTimeout(() => { void flushGroup(incident.applicationId).catch(err => log.error('notify', `grouped summary failed: ${(err as Error).message}`)); }, config.notifyGroupWindowSec * 1000);
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
  const emailOnCall = onCall.length > 0 && !smtpConfigProblem();
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

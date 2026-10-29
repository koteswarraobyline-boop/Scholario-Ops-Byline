/**
 * The incident email: a short page a person can read without opening the dashboard.
 * Plain text is the same content for clients that do not show HTML.
 */

export type IssueLayer = 'Application' | 'Server' | 'Database' | 'Backup' | 'Certificate' | 'Load balancer' | 'Notification' | 'Recovery site';

export interface IncidentMailInput {
  kind: 'FIRING' | 'RESOLVED' | 'ESCALATED' | 'INFO' | 'TEST';
  severity: string;
  incidentId: string;
  title: string;
  environment: string;
  application: string | null;
  server: string | null;
  ip: string | null;
  database: string | null;
  monitor: string | null;
  target: string | null;
  probeStatus: string | null;
  responseCode: number | null;
  latencyMs: number | null;
  reason: string;
  startedAt: string;
  durationMinutes?: number;
  extra?: string;
  link?: string;
  test?: boolean;
  fingerprint?: string;
  monitorType?: string | null;
  /** Other alerts included in the same email (grouped warnings). */
  also?: { id: string; title: string; detail: string; severity?: string }[];
}

export interface IncidentExplanation {
  layer: IssueLayer;
  headline: string;
  summary: string;
  where: string;
  why: string;
  saw: string;
  action: string;
}

const envLabel = (env: string) => env === 'PRD' ? 'Production' : env === 'DR' ? 'Disaster recovery' : env || 'Unknown environment';
const article = (word: string) => /^[aeiou]/i.test(word) ? 'an' : 'a';

export function issueLayer(fingerprint: string, monitorType?: string | null): IssueLayer {
  const fp = fingerprint || '';
  if (fp.startsWith('db-down:') || fp.startsWith('db-replication:') || monitorType === 'DB_CONN' || monitorType === 'DB_REPLICATION') return 'Database';
  if (fp.startsWith('backup:') || fp === 'ops-backup' || monitorType === 'BACKUP_FRESHNESS') return 'Backup';
  if (fp.startsWith('ssl-expiry:') || monitorType === 'SSL') return 'Certificate';
  if (fp.startsWith('cf-origin:')) return 'Load balancer';
  if (fp.startsWith('agent-offline:') || fp.startsWith('telemetry:') || fp.startsWith('capacity-disk:') || monitorType === 'INFRA_CPU' || monitorType === 'INFRA_RAM' || monitorType === 'INFRA_DISK') return 'Server';
  if (fp.startsWith('channel-failing:')) return 'Notification';
  if (fp.startsWith('dr-not-ready:')) return 'Recovery site';
  return 'Application';
}

export function explainIncident(input: IncidentMailInput): IncidentExplanation {
  const layer = issueLayer(input.fingerprint ?? '', input.monitorType);
  const place = input.application || input.monitor || input.title;
  const env = envLabel(input.environment);
  const warning = input.severity === 'WARNING' || input.probeStatus === 'DEGRADED';
  const recovered = input.kind === 'RESOLVED';

  const headline = recovered
    ? `${place} has recovered`
    : input.kind === 'ESCALATED'
      ? `${place} is still open`
      : warning
        ? `${place} needs attention`
        : `${place} is down`;

  const layerName = layer.toLowerCase();
  const summary = recovered
    ? `${headline}. The earlier ${layerName} problem in ${env} has cleared.`
    : input.kind === 'ESCALATED'
      ? `${headline}. Nobody has acknowledged this ${layerName} problem in ${env} yet.`
      : warning
        ? `${headline}. This is a warning, not a confirmed outage. It is ${article(layerName)} ${layerName} problem in ${env}.`
        : `${headline}. This is ${article(layerName)} ${layerName} problem in ${env}.`;

  const whereParts = [
    `Layer: ${layer}.`,
    input.application ? `Application: ${input.application}.` : 'This check is not linked to an application.',
    `Environment: ${env}.`,
    input.server ? `Server: ${input.server}${input.ip ? ` (${input.ip})` : ''}.` : '',
    input.database ? `Database: ${input.database}.` : '',
    input.monitor ? `Check: ${input.monitor}.` : '',
    input.target ? `Target: ${input.target}.` : '',
  ].filter(Boolean);
  const where = whereParts.join(' ');

  const why = whyText(input, layer, warning, recovered);
  const reason = input.reason && !/[.!?]$/.test(input.reason) ? `${input.reason}.` : input.reason;
  const saw = [
    reason,
    input.probeStatus ? `Result class: ${input.probeStatus}.` : '',
    input.responseCode ? `HTTP ${input.responseCode}.` : '',
    input.latencyMs != null ? `Latency: ${Math.round(input.latencyMs)} ms.` : '',
    input.extra ?? '',
  ].filter(Boolean).join(' ');

  const action = recovered
    ? 'No action is required unless the same problem returns. The incident is closed in Scholario Ops.'
    : warning
      ? 'Look at this before it becomes an outage. Confirm the application, server, and database named above, then fix the cause or acknowledge the incident.'
      : `Treat this as a live problem on the ${layer.toLowerCase()}. Confirm ${input.application ? input.application : 'the affected service'} in ${env}, then use the link below to acknowledge it and follow the runbook.`;

  return { layer, headline, summary, where, why, saw: saw || 'No further detail was recorded.', action };
}

function whyText(input: IncidentMailInput, layer: IssueLayer, warning: boolean, recovered: boolean): string {
  if (recovered) return 'The check that opened this incident is healthy again. Users should be able to continue, but it is worth confirming the application yourself if this was customer-facing.';
  if (input.probeStatus === 'TIMEOUT') return 'The check waited and received no answer. The service may be stuck, or the network path to it is blocked. This is not the same as an HTTP error page.';
  if (input.probeStatus === 'DNS_ERROR') return 'The hostname could not be looked up, so the check never reached the server. The application process may still be running; the name or DNS record is the failure.';
  if (input.probeStatus === 'TLS_ERROR') return 'The secure certificate was rejected. Browsers will warn or refuse the site until the certificate is trusted and in date.';
  if (input.probeStatus === 'CONNECTION_ERROR') return 'The connection was refused or dropped before any answer. The process may be stopped, or a firewall is blocking the port.';
  if (input.responseCode && input.responseCode >= 500) return `The service did answer, with HTTP ${input.responseCode}. It is reachable, but it is reporting that it cannot serve requests.`;
  if (warning || input.probeStatus === 'DEGRADED') return 'It is still responding, but slower, weaker, or closer to a limit than the threshold you set. This is the warning before a full outage.';
  if (layer === 'Database') return 'This is the database the application stores and reads. While it is down or lagging, logins and saves can fail even when the web page itself looks up.';
  if (layer === 'Server') return 'This is the machine, not a single web page. Anything hosted on this server — the application, its workers, and its local database — can be affected together.';
  if (layer === 'Backup') return 'The site can keep running. What failed is the copy you would restore from. There may be no recent backup if data is lost today.';
  if (layer === 'Certificate') return 'Visitors depend on this certificate to trust the site. When it expires or is untrusted, the browser blocks them even if the application is healthy.';
  if (layer === 'Load balancer') return 'The edge reports an origin as unhealthy. User traffic may be failing, or shifting to the other site, before the application monitor agrees.';
  if (layer === 'Notification') return 'A channel that should deliver alerts is itself failing. A later outage might not reach you on that channel.';
  if (layer === 'Recovery site') return 'The disaster-recovery site is not ready. A failover now would not meet the recovery plan.';
  return 'A monitor reported a real failure. The lines below are exactly what was recorded — the application, where it sits, and the error text.';
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Only http(s) links become a button. Anything else is left out of the HTML. */
export function safeMailLink(link?: string): string | undefined {
  if (!link) return undefined;
  try {
    const u = new URL(link);
    return u.protocol === 'https:' || u.protocol === 'http:' ? link : undefined;
  } catch {
    return undefined;
  }
}

/** Inbox subject. A full incident page names the severity; a short test message keeps its status word. */
export function mailSubject(msg: { title: string; status: string; severity: string; html?: string }): string {
  if (!msg.html) return `[${msg.status}] ${msg.title}`;
  const tag = msg.status === 'RESOLVED' ? 'RECOVERED'
    : msg.status === 'ESCALATED' ? 'ESCALATED'
    : msg.severity === 'WARNING' ? 'WARNING'
    : msg.severity === 'CRITICAL' || msg.severity === 'EMERGENCY' ? 'CRITICAL'
    : msg.severity === 'HIGH' ? 'HIGH'
    : msg.status;
  return `[${tag}] ${msg.title}`;
}

const banner = (input: IncidentMailInput): { label: string; color: string; bg: string } => {
  if (input.test) return { label: 'TEST', color: '#1d4ed8', bg: '#eff6ff' };
  if (input.kind === 'RESOLVED') return { label: 'RECOVERED', color: '#047857', bg: '#ecfdf5' };
  if (input.kind === 'ESCALATED') return { label: 'ESCALATED', color: '#c2410c', bg: '#fff7ed' };
  if (input.severity === 'WARNING') return { label: 'WARNING', color: '#b45309', bg: '#fffbeb' };
  if (input.severity === 'CRITICAL' || input.severity === 'EMERGENCY') return { label: 'DOWN', color: '#9f1239', bg: '#fff1f2' };
  return { label: 'PROBLEM', color: '#c2410c', bg: '#fff7ed' };
};

function factRows(input: IncidentMailInput, layer: IssueLayer): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [
    { label: 'Incident', value: input.incidentId },
    { label: 'Title', value: input.title },
    { label: 'Severity', value: input.severity },
    { label: 'Layer', value: layer },
    { label: 'Application', value: input.application || 'Not linked' },
    { label: 'Environment', value: envLabel(input.environment) },
  ];
  if (input.server) rows.push({ label: 'Server', value: input.ip ? `${input.server} (${input.ip})` : input.server });
  if (input.database) rows.push({ label: 'Database', value: input.database });
  if (input.monitor) rows.push({ label: 'Check', value: input.monitor });
  if (input.target) rows.push({ label: 'Target', value: input.target });
  if (input.probeStatus) rows.push({ label: 'Result', value: input.probeStatus });
  if (input.responseCode) rows.push({ label: 'HTTP code', value: String(input.responseCode) });
  if (input.latencyMs != null) rows.push({ label: 'Latency', value: `${Math.round(input.latencyMs)} ms` });
  if (input.startedAt) rows.push({ label: 'Started', value: input.startedAt });
  if (input.durationMinutes != null && input.kind === 'RESOLVED') rows.push({ label: 'Duration', value: `${input.durationMinutes} min` });
  return rows;
}

/** HTML page plus the same words as plain text. Every inserted value is escaped in the HTML. */
export function renderIncidentMail(input: IncidentMailInput): { text: string; html: string } {
  input = { ...input, link: safeMailLink(input.link) };
  const explained = explainIncident(input);
  const band = banner(input);
  const facts = factRows(input, explained.layer);
  const also = input.also ?? [];

  const text = [
    `[${band.label}] ${input.incidentId} ${input.title}`,
    '',
    'What happened',
    explained.summary,
    '',
    'Where',
    explained.where,
    '',
    'Why this matters',
    explained.why,
    '',
    'What we saw',
    explained.saw,
    '',
    ...facts.map(f => `${f.label}: ${f.value}`),
    ...(also.length ? ['', 'Also in this email', ...also.map(a => `• ${a.id} [${a.severity ?? 'ALERT'}] ${a.title} — ${a.detail}`)] : []),
    '',
    'What to do',
    explained.action,
    input.link ? `\nOpen in Scholario Ops: ${input.link}` : '',
  ].filter(line => line !== undefined).join('\n');

  const rowHtml = facts.map(f =>
    `<tr><td style="padding:8px 12px;color:#64748b;width:140px;vertical-align:top">${esc(f.label)}</td><td style="padding:8px 12px;color:#0f172a;font-weight:600">${esc(f.value)}</td></tr>`,
  ).join('');
  const alsoHtml = also.length
    ? `<p style="margin:20px 0 8px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#64748b">Also in this email</p><ul style="margin:0;padding-left:18px;color:#0f172a">${also.map(a => `<li style="margin:0 0 6px"><strong>${esc(a.id)}</strong> ${esc(a.title)} — ${esc(a.detail)}</li>`).join('')}</ul>`
    : '';
  const button = input.link
    ? `<p style="margin:22px 0 0"><a href="${esc(input.link)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Open this incident</a></p>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(input.incidentId)} ${esc(input.title)}</title></head><body style="margin:0;padding:0;background:#f1f5f9;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(explained.summary)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
<tr><td style="background:${band.bg};padding:20px 24px;border-bottom:4px solid ${band.color}">
<div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:${band.color}">${esc(band.label)} · ${esc(input.severity)} · ${esc(input.incidentId)}</div>
<h1 style="margin:8px 0 0;font-size:22px;line-height:1.3">${esc(explained.headline)}</h1>
</td></tr>
<tr><td style="padding:22px 24px 8px;font-size:15px;line-height:1.5">
<p style="margin:0 0 16px">${esc(explained.summary)}</p>
<p style="margin:0 0 6px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#64748b">Where</p>
<p style="margin:0 0 16px">${esc(explained.where)}</p>
<p style="margin:0 0 6px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#64748b">Why this matters</p>
<p style="margin:0 0 16px">${esc(explained.why)}</p>
<p style="margin:0 0 6px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#64748b">What we saw</p>
<p style="margin:0 0 8px">${esc(explained.saw)}</p>
</td></tr>
<tr><td style="padding:0 24px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;font-size:14px">${rowHtml}</table>
${alsoHtml}
</td></tr>
<tr><td style="padding:8px 24px 24px;font-size:15px;line-height:1.5">
<p style="margin:8px 0 6px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#64748b">What to do</p>
<p style="margin:0">${esc(explained.action)}</p>
${button}
<p style="margin:18px 0 0;font-size:12px;color:#94a3b8">Sent by Scholario Ops. This email is the alert.${input.link ? ' The button opens the same incident in the dashboard.' : ''}</p>
</td></tr>
</table></td></tr></table></body></html>`;

  return { text, html };
}

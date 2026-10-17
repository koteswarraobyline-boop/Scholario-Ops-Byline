/**
 * Turns an incident the monitors already opened into the HTML page sent by email.
 * The page itself lives in src/lib/incidentMail.ts so the wording stays in one place.
 */
import { Incident } from '../src/types/index.ts';
import { IncidentMailInput, renderIncidentMail } from '../src/lib/incidentMail.ts';
import type { NotificationMessage } from './notify.ts';

export interface IncidentNames {
  application?: string;
  server?: string;
  ip?: string;
  database?: string;
  monitor?: string;
  monitorType?: string | null;
  target?: string;
}

const named = (value?: string | null): string | null => {
  const v = value?.trim();
  return v && v !== '—' ? v : null;
};

/** A clock time a person can read. Unknown values stay as they were recorded. */
export function formatWhen(iso?: string): string {
  if (!iso) return 'Not recorded';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return `${new Date(t).toLocaleString('en-GB', {
    timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })} UTC`;
}

function toInput(incident: Incident, status: NotificationMessage['status'], names: IncidentNames, extra?: string, link?: string, also?: IncidentMailInput['also']): IncidentMailInput {
  const ctx = incident.context;
  const when = status === 'RESOLVED' && incident.resolvedAt ? incident.resolvedAt : incident.startedAt;
  return {
    kind: status,
    severity: incident.severity,
    incidentId: incident.id,
    title: incident.title,
    environment: incident.environment,
    application: named(names.application) ?? named(ctx?.application) ?? named(incident.affectedServices.filter(Boolean)[0]) ,
    server: named(ctx?.vps) ?? named(names.server),
    ip: named(ctx?.ip) ?? named(names.ip),
    database: named(names.database),
    monitor: named(ctx?.monitor) ?? named(names.monitor),
    target: named(ctx?.target) ?? named(names.target),
    probeStatus: ctx?.probeStatus ?? null,
    responseCode: ctx?.responseCode ?? null,
    latencyMs: ctx?.latencyMs ?? null,
    reason: ctx?.failureReason || incident.rootCause || '',
    startedAt: formatWhen(when),
    durationMinutes: incident.durationMinutes,
    extra,
    link,
    fingerprint: incident.fingerprint,
    monitorType: names.monitorType,
    also,
  };
}

export function incidentNotification(incident: Incident, status: NotificationMessage['status'], names: IncidentNames = {}, extra?: string, link?: string): NotificationMessage {
  const page = renderIncidentMail(toInput(incident, status, names, extra, link));
  return {
    title: `${incident.id} ${incident.title}`,
    text: page.text,
    html: page.html,
    severity: incident.severity,
    status,
    incidentId: incident.id,
    link,
  };
}

/** Several alerts for one application, still one HTML page. Each id is in the plain text so a restart does not send the page again. */
export function groupedNotification(items: Incident[], windowSec: number, namesFor: (i: Incident) => IncidentNames, link?: string): NotificationMessage {
  const rank: Record<string, number> = { INFO: 0, WARNING: 1, HIGH: 2, CRITICAL: 3, EMERGENCY: 4 };
  const ordered = [...items].sort((a, b) => (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0));
  const top = ordered[0];
  const also = ordered.slice(1).map(i => ({ id: i.id, title: i.title, detail: i.rootCause || i.title, severity: i.severity }));
  const names = top ? namesFor(top) : {};
  const page = top
    ? renderIncidentMail(toInput(top, 'FIRING', names, `${ordered.length} alerts opened within ${windowSec}s for the same application.`, link, also))
    : { text: '', html: '' };
  return {
    title: `${ordered.length} alerts · ${names.application || top?.title || 'Scholario Ops'}`,
    text: page.text,
    html: page.html,
    severity: top?.severity ?? 'WARNING',
    status: 'FIRING',
    incidentId: top?.id,
    link,
  };
}

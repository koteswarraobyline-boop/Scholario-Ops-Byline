/**
 * Which incidents deserve a browser notification + sound: open, CRITICAL / EMERGENCY, not
 * acknowledged, and not alerted before. The key includes the severity, so an incident that is
 * escalated to CRITICAL later alerts once more. Pure so it can be unit-tested.
 */
import type { Incident } from '../types';

export const ALERT_SEVERITIES: ReadonlyArray<Incident['severity']> = ['CRITICAL', 'EMERGENCY'];

export const isOpen = (i: Pick<Incident, 'status'>) => i.status !== 'RESOLVED' && i.status !== 'CLOSED';
export const alertKey = (i: Pick<Incident, 'id' | 'severity'>) => `${i.id}:${i.severity}`;
export const needsAlert = (i: Incident) => isOpen(i) && !i.acknowledged && ALERT_SEVERITIES.includes(i.severity);

/** Incidents to announce now; `seen` is updated in place (also with incidents that need no alert). */
export function takeNewCriticalAlerts(incidents: Incident[], seen: Set<string>): Incident[] {
  const fresh: Incident[] = [];
  for (const i of incidents) {
    const key = alertKey(i);
    if (seen.has(key)) continue;
    seen.add(key);
    if (needsAlert(i)) fresh.push(i);
  }
  return fresh;
}

/** "(2) CRITICAL · Scholario Ops" while unacknowledged critical incidents are open, else the base title */
export function titleWithCriticalCount(base: string, incidents: Incident[]): string {
  const n = incidents.filter(needsAlert).length;
  return n > 0 ? `(${n}) CRITICAL · ${base}` : base;
}

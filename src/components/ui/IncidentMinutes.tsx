import React from 'react';
import { Incident } from '../../types';
import { useNow } from './Freshness';

/** Minutes an incident has lasted: live from startedAt while open, the recorded duration once closed. */
export function incidentMinutes(inc: Pick<Incident, 'status' | 'startedAt' | 'durationMinutes'>, now = Date.now()): number {
  if (inc.status === 'RESOLVED' || inc.status === 'CLOSED') return inc.durationMinutes ?? 0;
  const t = Date.parse(inc.startedAt);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60000)) : (inc.durationMinutes ?? 0);
}

/** Renders incidentMinutes() and keeps it current (the server does not push duration changes). */
export const IncidentMinutes: React.FC<{ incident: Pick<Incident, 'status' | 'startedAt' | 'durationMinutes'> }> = ({ incident }) => {
  const now = useNow(15_000);
  return <>{incidentMinutes(incident, now)}</>;
};

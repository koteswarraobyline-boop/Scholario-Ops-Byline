import { DeadManControlPlane, DeadManStatus, TelemetryLevel } from '../../types';

/** Display level of a dead-man state. Not configured / pending are "no data", never green. */
export const deadManLevel = (s: DeadManStatus): TelemetryLevel =>
  s === 'HEALTHY' ? 'HEALTHY' : s === 'DEGRADED' ? 'WARNING' : s === 'FAILING' ? 'CRITICAL' : 'UNKNOWN';

export const deadManLabel = (s: DeadManStatus) =>
  s === 'NOT_CONFIGURED' ? 'Not configured' : s === 'PENDING' ? 'Starting' : s === 'HEALTHY' ? 'Healthy' : s === 'DEGRADED' ? 'Degraded' : 'Failing';

export const deadManDot = (s: DeadManStatus) =>
  s === 'HEALTHY' ? 'bg-emerald-400' : s === 'DEGRADED' ? 'bg-amber-400' : s === 'FAILING' ? 'bg-rose-400' : 'bg-slate-500';

/** "84 ms" / "—" (no measurement is never shown as 0) */
export const deadManLatency = (d: DeadManControlPlane) => (d.lastLatencyMs === null || d.lastLatencyMs === undefined ? '—' : `${Math.round(d.lastLatencyMs)} ms`);

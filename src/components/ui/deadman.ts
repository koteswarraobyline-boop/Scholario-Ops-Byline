import { DeadManControlPlane, DeadManStatus, HeartbeatCheck, HeartbeatState, TelemetryLevel } from '../../types';

/** Display level of a heartbeat state. Unknown / not configured are "no data", never green. */
export const deadManLevel = (s: DeadManStatus | HeartbeatState): TelemetryLevel =>
  s === 'HEALTHY' ? 'HEALTHY' : s === 'DEGRADED' ? 'WARNING' : s === 'FAILING' ? 'CRITICAL' : 'UNKNOWN';

export const deadManLabel = (s: DeadManStatus | HeartbeatState) =>
  s === 'NOT_CONFIGURED' ? 'No servers' : s === 'HEALTHY' ? 'Healthy' : s === 'DEGRADED' ? 'Degraded' : s === 'FAILING' ? 'Failing' : 'Unknown';

/** Header badge of the heartbeat stream */
export const deadManBadge = (s: DeadManStatus) =>
  s === 'HEALTHY' ? 'SYNCHRONIZED' : s === 'DEGRADED' ? 'DEGRADED' : s === 'FAILING' ? 'HEARTBEAT FAILING' : s === 'NOT_CONFIGURED' ? 'NO SERVERS REGISTERED' : 'AWAITING TELEMETRY';

export const deadManDot = (s: DeadManStatus | HeartbeatState) =>
  s === 'HEALTHY' ? 'bg-emerald-400' : s === 'DEGRADED' ? 'bg-amber-400' : s === 'FAILING' ? 'bg-rose-400' : 'bg-slate-500';

/** "84 ms" / "—" (no measurement is never shown as 0) */
export const fmtLatency = (ms: number | null | undefined) => (ms === null || ms === undefined ? '—' : `${Math.round(ms)} ms`);

/** All checks of the stream, flattened */
export const allChecks = (d: DeadManControlPlane): HeartbeatCheck[] =>
  d.servers.flatMap(s => [s.server, ...s.applications.checks, ...s.services.checks, ...s.databases.checks]);

/** Most recent server heartbeat across all servers (null when none ever reported) */
export const lastServerHeartbeat = (d: DeadManControlPlane): string | null =>
  d.servers.map(s => s.server.lastSuccessAt).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;

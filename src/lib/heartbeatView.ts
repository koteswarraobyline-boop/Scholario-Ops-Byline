/**
 * Presentation layer of the Dead-Man Heartbeat Stream: overall node state, filtering, summaries and
 * the incident related to a heartbeat. Pure functions over the heartbeat data the API already sends
 * (GET /api/v1/deadman/status, SSE deadman_update). Nothing here changes a heartbeat, an incident or
 * any backend state — the individual heartbeat states are shown exactly as the server computed them.
 */
import { Application, DeadManControlPlane, HeartbeatCheck, HeartbeatKind, HeartbeatState, Incident, ServerHeartbeat } from '../types';

export type NodeState = 'HEALTHY' | 'DEGRADED' | 'FAILING' | 'DISCONNECTED' | 'UNKNOWN';
export type TypeFilter = 'ALL' | HeartbeatKind;
export type StatusFilter = 'ALL' | HeartbeatState;
export interface HeartbeatFilters { type: TypeFilter; status: StatusFilter; server: 'ALL' | string }
export const DEFAULT_FILTERS: HeartbeatFilters = { type: 'ALL', status: 'ALL', server: 'ALL' };

export const GROUPS = [
  { key: 'applications', kind: 'APPLICATION', label: 'Applications', one: 'application', short: 'Apps' },
  { key: 'services', kind: 'SERVICE', label: 'Services', one: 'service', short: 'Services' },
  { key: 'databases', kind: 'DATABASE', label: 'Database', one: 'database', short: 'DB' },
] as const;

/** Word for a state, specific to the heartbeat type (a server heartbeat is "connected", not "healthy") */
export function stateWord(kind: HeartbeatKind, s: HeartbeatState): string {
  if (kind === 'SERVER') return s === 'HEALTHY' ? 'CONNECTED' : s === 'DEGRADED' ? 'STALE' : s === 'FAILING' ? 'DISCONNECTED' : 'NEVER REPORTED';
  return s;
}

/**
 * Overall node state — an aggregation for display only:
 * server heartbeat disconnected → DISCONNECTED; any child FAILING → FAILING; server stale or any child
 * DEGRADED → DEGRADED; any UNKNOWN → UNKNOWN; otherwise HEALTHY. Categories that are not configured
 * (no checks) are left out — they never count as healthy, and never as a problem either.
 */
export function nodeState(s: ServerHeartbeat): { state: NodeState; reasons: string[] } {
  const reasons: string[] = [];
  if (s.server.state === 'FAILING') return { state: 'DISCONNECTED', reasons: ['Server heartbeat disconnected — the agent stopped reporting'] };
  const count = (state: HeartbeatState) => {
    for (const g of GROUPS) {
      const hit = s[g.key].checks.filter(c => c.state === state);
      if (hit.length) reasons.push(`${hit.length} ${g.one} heartbeat${hit.length === 1 ? '' : 's'} ${state.toLowerCase()} (${hit.map(c => c.name).join(', ')})`);
    }
  };
  count('FAILING');
  if (reasons.length) return { state: 'FAILING', reasons };
  if (s.server.state === 'DEGRADED') reasons.push('Server heartbeat stale — reports are late');
  count('DEGRADED');
  if (reasons.length) return { state: 'DEGRADED', reasons };
  if (s.server.state === 'UNKNOWN') reasons.push('Server heartbeat unknown — the agent has never reported');
  count('UNKNOWN');
  if (reasons.length) return { state: 'UNKNOWN', reasons };
  return { state: 'HEALTHY', reasons: [] };
}

export interface HeartbeatRecord { server: ServerHeartbeat; check: HeartbeatCheck }

/** Every heartbeat as a flat record (server heartbeats first, then applications, services, databases) */
export function records(d: DeadManControlPlane): HeartbeatRecord[] {
  return d.servers.flatMap(s => [
    { server: s, check: s.server },
    ...s.applications.checks.map(check => ({ server: s, check })),
    ...s.services.checks.map(check => ({ server: s, check })),
    ...s.databases.checks.map(check => ({ server: s, check })),
  ]);
}

/** The server-filter value of a server: its environment (PRD / DR); ids are used when an environment is shared */
export function serverFilterOptions(d: DeadManControlPlane): Array<{ value: string; label: string }> {
  const byEnv = new Map<string, number>();
  for (const s of d.servers) byEnv.set(s.environment, (byEnv.get(s.environment) ?? 0) + 1);
  return d.servers.map(s => byEnv.get(s.environment) === 1
    ? { value: s.environment, label: s.environment }
    : { value: s.serverId, label: `${s.environment} · ${s.hostname}` });
}
export const matchesServer = (s: ServerHeartbeat, server: string) => server === 'ALL' || server === s.environment || server === s.serverId;

export function filterRecords(d: DeadManControlPlane, f: HeartbeatFilters): HeartbeatRecord[] {
  return records(d).filter(r =>
    (f.type === 'ALL' || r.check.kind === f.type)
    && (f.status === 'ALL' || r.check.state === f.status)
    && matchesServer(r.server, f.server));
}

export const isDefaultView = (f: HeartbeatFilters) => f.type === 'ALL' && f.status === 'ALL';

/** Totals per heartbeat type: healthy / configured (not-configured categories add nothing) */
export function typeTotals(d: DeadManControlPlane): Record<HeartbeatKind, { healthy: number; total: number }> {
  const out = { SERVER: { healthy: 0, total: 0 }, APPLICATION: { healthy: 0, total: 0 }, SERVICE: { healthy: 0, total: 0 }, DATABASE: { healthy: 0, total: 0 } };
  for (const r of records(d)) {
    out[r.check.kind].total++;
    if (r.check.state === 'HEALTHY') out[r.check.kind].healthy++;
  }
  return out;
}

export function stateCounts(d: DeadManControlPlane): Record<HeartbeatState, number> {
  const out: Record<HeartbeatState, number> = { HEALTHY: 0, DEGRADED: 0, FAILING: 0, UNKNOWN: 0 };
  for (const r of records(d)) out[r.check.state]++;
  return out;
}

/** Open incident raised for this heartbeat (same fingerprints the alert engine uses), or undefined */
export function incidentFor(check: HeartbeatCheck, server: ServerHeartbeat, incidents: Incident[], applications: Application[]): Incident | undefined {
  const open = incidents.filter(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  const fps: string[] = [];
  const pfx = `telemetry:${server.serverId}:`;
  if (check.kind === 'SERVER') fps.push(`agent-offline:${server.serverId}`);
  if (check.kind === 'APPLICATION') fps.push(`${pfx}app-health:${check.key.slice('app:'.length)}`);
  if (check.kind === 'SERVICE') fps.push(`${pfx}systemd:${check.key.slice('service:'.length)}`);
  if (check.kind === 'DATABASE') {
    fps.push(`${pfx}db-down:${check.name}`);
    // A database configured for an application raises the per-application incident instead
    for (const a of applications) {
      if (a.prdServerId === server.serverId) fps.push(`db-down:${a.id}:PRD`);
      if (a.drServerId === server.serverId) fps.push(`db-down:${a.id}:DR`);
    }
  }
  return open.find(i => fps.includes(i.fingerprint));
}

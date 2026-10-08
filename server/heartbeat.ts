/**
 * Dead-man heartbeat of the MONITORED infrastructure: for every registered server (PRD / DR) the
 * heartbeat of its telemetry agent, its application health checks, its watched systemd services and
 * its database probes. Scholario Ops is the monitoring control plane, not a monitored target.
 *
 * Everything is derived from agent reports that were already pushed and stored (no polling, no
 * outbound request, no external watchdog). Missing or stale data is UNKNOWN — never HEALTHY.
 */
import {
  DeadManControlPlane, HeartbeatCheck, HeartbeatGroup, HeartbeatState, ServerHeartbeat,
} from '../src/types/index.ts';
import { THRESHOLDS } from '../src/lib/thresholds.ts';
import { config } from './config.ts';
import { db, ServerRecord } from './store.ts';
import { agentState } from './health.ts';

const RANK: Record<HeartbeatState, number> = { HEALTHY: 0, UNKNOWN: 1, DEGRADED: 2, FAILING: 3 };
export const worstState = (states: HeartbeatState[], fallback: HeartbeatState = 'UNKNOWN'): HeartbeatState =>
  states.length ? states.reduce((a, b) => (RANK[b] > RANK[a] ? b : a)) : fallback;

/** Heavy collectors (services, application checks, databases) run on every 3rd agent report */
const HEAVY_EVERY = 3;

const check = (c: Partial<HeartbeatCheck> & Pick<HeartbeatCheck, 'kind' | 'key' | 'name' | 'state' | 'detail'>): HeartbeatCheck => ({
  target: null, lastCheckAt: null, lastSuccessAt: null, latencyMs: null, failures: null, httpStatus: null, restartCount: null, intervalSec: null, toleranceSec: null, ...c,
});

const group = (checks: HeartbeatCheck[]): HeartbeatGroup => ({
  state: worstState(checks.map(c => c.state)),
  total: checks.length,
  healthy: checks.filter(c => c.state === 'HEALTHY').length,
  checks,
});

/** Server heartbeat = the agent's telemetry delivery (the existing source of truth). */
function serverCheck(srv: ServerRecord, now: number): HeartbeatCheck {
  const state = agentState(srv);
  const interval = srv.reportIntervalSec ?? null;
  const age = srv.lastSeen ? Math.max(0, (now - Date.parse(srv.lastSeen)) / 1000) : null;
  // Missed heartbeats: reports that should have arrived since the last one (only once the interval is known)
  const missed = age !== null && interval ? Math.max(0, Math.floor(age / interval) - 1) : null;
  const t = srv.telemetry;
  // Delivery latency: measured transport delay (agent ≥ 3.3), else receive − sample time (whole seconds)
  const delivery = srv.agentTiming?.transportDelayMs ?? (t?.observedAt && t?.receivedAt ? Math.max(0, Date.parse(t.receivedAt) - Date.parse(t.observedAt)) : null);
  const hb: HeartbeatState = state === 'ONLINE' ? 'HEALTHY' : state === 'STALE' ? 'DEGRADED' : state === 'OFFLINE' ? 'FAILING' : 'UNKNOWN';
  const word = state === 'ONLINE' ? 'CONNECTED' : state === 'STALE' ? 'STALE' : state === 'OFFLINE' ? 'DISCONNECTED' : 'NEVER REPORTED';
  return check({
    kind: 'SERVER', key: 'server', name: 'Server heartbeat', state: hb,
    detail: state === 'NOT_CONNECTED' ? 'Agent has never reported — install it from Setup'
      : `Agent ${srv.agentVersion ? `v${srv.agentVersion} ` : ''}${word}${missed ? ` · ${missed} report(s) missed` : ''}`,
    target: srv.ip || null,
    lastCheckAt: srv.lastSeen || null, lastSuccessAt: srv.lastSeen || null,
    latencyMs: delivery, failures: missed, intervalSec: interval, toleranceSec: config.telemetryStaleSec,
  });
}

/** With a stale / disconnected agent, last-known component results are not live: report them as UNKNOWN. */
const liveOr = (online: boolean, s: HeartbeatState): HeartbeatState => (online ? s : 'UNKNOWN');

function applicationChecks(srv: ServerRecord, online: boolean, heavyInterval: number | null): HeartbeatCheck[] {
  const out: HeartbeatCheck[] = [];
  const reported = srv.appHealth ?? [];
  for (const c of reported) {
    const slow = c.latencyMs !== null && c.latencyMs >= THRESHOLDS.localHealthLatencyMs.warning;
    const s: HeartbeatState = c.status === 'DOWN'
      ? (c.consecutiveFailures >= THRESHOLDS.localHealthFailuresForAlert ? 'FAILING' : 'DEGRADED')
      : c.status === 'HEALTHY' ? (slow ? 'DEGRADED' : 'HEALTHY') : 'UNKNOWN';
    out.push(check({
      kind: 'APPLICATION', key: `app:${c.applicationId}:${c.port}`, name: c.name || `Port ${c.port}`, state: liveOr(online, s),
      detail: c.status === 'DOWN' ? `Health check failing: ${c.error ?? 'error'}${c.listening === false ? ' (port not listening)' : ''}`
        : c.status === 'HEALTHY' ? `HTTP ${c.statusCode ?? '?'}${slow ? ' · slow response' : ''}` : 'No result',
      target: `127.0.0.1:${c.port}${c.path}`,
      lastCheckAt: c.checkedAt, lastSuccessAt: c.lastSuccessAt ?? (c.status === 'HEALTHY' ? c.checkedAt : null),
      latencyMs: c.latencyMs, failures: c.consecutiveFailures, httpStatus: c.statusCode,
      intervalSec: heavyInterval, toleranceSec: config.telemetryStaleSec * HEAVY_EVERY,
    }));
  }
  // Applications configured for this server whose check the agent has not reported (older agent / not yet run)
  for (const app of db.applications) {
    for (const env of ['PRD', 'DR'] as const) {
      if ((env === 'PRD' ? app.prdServerId : app.drServerId) !== srv.id) continue;
      const port = app.environments?.[env]?.appPort;
      if (!port || reported.some(c => c.applicationId === app.id && c.port === port)) continue;
      out.push(check({
        kind: 'APPLICATION', key: `app:${app.id}:${port}`, name: app.name, state: 'UNKNOWN',
        detail: srv.lastSeen ? 'Check not reported yet (needs agent 3.3 — reinstall from Setup)' : 'Agent not connected',
        target: `127.0.0.1:${port}${app.environments?.[env]?.healthPath ?? '/'}`,
      }));
    }
  }
  return out;
}

function serviceChecks(srv: ServerRecord, online: boolean, heavyInterval: number | null): HeartbeatCheck[] {
  return srv.services.map(s => {
    const st: HeartbeatState = s.status === 'active' ? 'HEALTHY' : s.status === 'failed' ? 'FAILING' : 'DEGRADED';
    const word = s.status === 'active' ? 'running' : s.status === 'failed' ? 'FAILED' : s.status === 'restarting' ? (s.activeState ?? 'restarting') : 'stopped';
    return check({
      kind: 'SERVICE', key: `service:${s.name}`, name: s.name, state: liveOr(online, st),
      detail: `${word}${s.subState && s.subState !== 'running' ? ` (${s.subState})` : ''}${s.restartCount ? ` · ${s.restartCount} restart(s)` : ''}`,
      target: 'systemd',
      lastCheckAt: srv.servicesObservedAt ?? null, lastSuccessAt: s.status === 'active' ? (srv.servicesObservedAt ?? null) : null,
      restartCount: s.restartCount ?? null, intervalSec: heavyInterval, toleranceSec: config.telemetryStaleSec * HEAVY_EVERY,
    });
  });
}

function databaseChecks(srv: ServerRecord, online: boolean, heavyInterval: number | null): HeartbeatCheck[] {
  return (srv.databases ?? []).map(d => {
    const label = `${d.engine}${d.name ? ` ${d.name}` : ''}`;
    const pressure = d.connectionUsagePercent != null && d.connectionUsagePercent >= THRESHOLDS.dbConnectionUsagePercent.critical;
    const repl = d.replication?.role === 'replica' && d.replication.state !== 'running';
    const st: HeartbeatState = !d.available ? 'FAILING' : pressure || repl || d.longRunningQueries ? 'DEGRADED' : 'HEALTHY';
    return check({
      kind: 'DATABASE', key: `db:${d.engine}:${d.name ?? ''}`, name: label, state: liveOr(online, st),
      detail: !d.available ? `Unavailable: ${d.error ?? 'no error text'}`
        : [d.version ?? 'available', pressure ? `connections ${d.connectionUsagePercent}%` : null, repl ? `replication ${d.replication!.state}` : null,
          d.longRunningQueries ? `${d.longRunningQueries} long query(ies)` : null].filter(Boolean).join(' · '),
      target: d.engine,
      lastCheckAt: d.observedAt, lastSuccessAt: d.lastSuccessAt ?? (d.available ? d.observedAt : null),
      latencyMs: d.latencyMs, failures: d.consecutiveFailures ?? (d.available ? 0 : 1),
      intervalSec: heavyInterval, toleranceSec: config.telemetryStaleSec * HEAVY_EVERY,
    });
  });
}

export function serverHeartbeat(srv: ServerRecord, now = Date.now()): ServerHeartbeat {
  const server = serverCheck(srv, now);
  const online = server.state === 'HEALTHY';
  const heavy = srv.reportIntervalSec ? srv.reportIntervalSec * HEAVY_EVERY : null;
  const applications = group(applicationChecks(srv, online, heavy));
  const services = group(serviceChecks(srv, online, heavy));
  const databases = group(databaseChecks(srv, online, heavy));
  // A server's state: its heartbeat, then the components that exist on it
  const parts = [server.state, ...[applications, services, databases].filter(g => g.total > 0).map(g => g.state)];
  return {
    serverId: srv.id, hostname: srv.hostname, ip: srv.ip, environment: srv.environment,
    state: worstState(parts), server, applications, services, databases,
  };
}

/** The whole picture, PRD first. Never contains agent tokens or other secrets (only ids, names, states). */
export function infraHeartbeat(now = Date.now()): DeadManControlPlane {
  const servers = [...db.servers]
    .sort((a, b) => (a.environment === b.environment ? a.hostname.localeCompare(b.hostname) : a.environment === 'PRD' ? -1 : 1))
    .map(s => serverHeartbeat(s, now));
  const all = servers.flatMap(s => [s.server, ...s.applications.checks, ...s.services.checks, ...s.databases.checks]);
  const intervals = db.servers.map(s => s.reportIntervalSec).filter((v): v is number => typeof v === 'number' && v > 0).sort((a, b) => a - b);
  return {
    id: 'deadman-infrastructure',
    name: 'Dead-Man Watchdog Heartbeat Stream',
    status: servers.length ? worstState(servers.map(s => s.state)) : 'NOT_CONFIGURED',
    evaluatedAt: new Date(now).toISOString(),
    telemetryIntervalSec: intervals.length ? intervals[Math.floor(intervals.length / 2)] : null,
    staleAfterSec: config.telemetryStaleSec,
    disconnectedAfterSec: config.telemetryStaleSec * 10,
    servers,
    counts: {
      total: all.length,
      healthy: all.filter(c => c.state === 'HEALTHY').length,
      degraded: all.filter(c => c.state === 'DEGRADED').length,
      failing: all.filter(c => c.state === 'FAILING').length,
      unknown: all.filter(c => c.state === 'UNKNOWN').length,
    },
  };
}

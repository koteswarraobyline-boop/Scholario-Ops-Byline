import crypto from 'crypto';
import {
  Application, Monitor, Incident, OperationalStatus, DeadManControlPlane, AppDependency, ServerMetricPoint,
  VpsProcess, VpsService, VpsLogEntry,
} from '../src/types/index.ts';
import { config, isCloudflareConfigured } from './config.ts';
import { db, persist, liveMetrics, minuteMetrics, ServerRecord, MonitorBucket } from './store.ts';
import { broadcast, audit } from './events.ts';
import { httpProbe, tcpProbe, dnsProbe, sslProbe, parseHostPort } from './probes.ts';
import { notifyIncident, notifyAll } from './notify.ts';
import { switchDnsRecord } from './cloudflare.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Monitor classification
// ─────────────────────────────────────────────────────────────────────────────
export const HTTP_TYPES: Monitor['type'][] = ['HTTP', 'HTTPS', 'APP_HEALTH', 'APP_READINESS', 'API_BUSINESS'];
export const TCP_TYPES: Monitor['type'][] = ['TCP', 'DB_CONN'];
export const INFRA_TYPES: Monitor['type'][] = ['INFRA_CPU', 'INFRA_RAM', 'INFRA_DISK'];
export const PUSH_TYPES: Monitor['type'][] = ['CRON_HEARTBEAT', 'WORKER_HEARTBEAT', 'DEAD_MAN', 'DB_REPLICATION', 'BACKUP_FRESHNESS'];
/** Monitors that represent "is the service reachable" — used for auto-failover decisions */
const AVAILABILITY_TYPES: Monitor['type'][] = [...HTTP_TYPES, 'TCP'];

const SEVERITY_RANK: Record<OperationalStatus, number> = { HEALTHY: 0, MAINTENANCE: 1, UNKNOWN: 2, STALE: 3, WARNING: 4, CRITICAL: 5 };
const worst = (statuses: OperationalStatus[], fallback: OperationalStatus = 'UNKNOWN'): OperationalStatus =>
  statuses.length === 0 ? fallback : statuses.reduce((a, b) => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a));

// ─────────────────────────────────────────────────────────────────────────────
// Check execution
// ─────────────────────────────────────────────────────────────────────────────
interface CheckOutcome { ok: boolean; degraded: boolean; latencyMs: number; statusCode?: number; detail: string; pending?: boolean }

const pct = (v: number, fallback: number) => (v > 0 && v <= 100 ? v : fallback);

async function executeCheck(m: Monitor): Promise<CheckOutcome> {
  const timeoutMs = Math.max(1, m.timeoutSec) * 1000;

  if (HTTP_TYPES.includes(m.type)) {
    const r = await httpProbe(m.target, { timeoutMs });
    if (!r.reachable) return { ok: false, degraded: false, latencyMs: r.latencyMs, detail: r.error || 'Unreachable' };
    const statusOk = m.expectedStatusCode ? r.statusCode === m.expectedStatusCode : (r.statusCode ?? 0) < 400;
    if (!statusOk) {
      return { ok: false, degraded: false, latencyMs: r.latencyMs, statusCode: r.statusCode ?? undefined, detail: `Unexpected HTTP ${r.statusCode}${m.expectedStatusCode ? ` (expected ${m.expectedStatusCode})` : ''}` };
    }
    if (m.expectedBodyContains && !r.body.includes(m.expectedBodyContains)) {
      return { ok: false, degraded: false, latencyMs: r.latencyMs, statusCode: r.statusCode ?? undefined, detail: `Response body does not contain "${m.expectedBodyContains}"` };
    }
    if (m.criticalThresholdMs > 0 && r.latencyMs > m.criticalThresholdMs) {
      return { ok: false, degraded: false, latencyMs: r.latencyMs, statusCode: r.statusCode ?? undefined, detail: `HTTP ${r.statusCode} but too slow: ${r.latencyMs}ms > ${m.criticalThresholdMs}ms critical threshold` };
    }
    const slow = m.warningThresholdMs > 0 && r.latencyMs > m.warningThresholdMs;
    return { ok: true, degraded: slow, latencyMs: r.latencyMs, statusCode: r.statusCode ?? undefined, detail: `HTTP ${r.statusCode} in ${r.latencyMs}ms${slow ? ` (slow, > ${m.warningThresholdMs}ms)` : ''}` };
  }

  if (TCP_TYPES.includes(m.type)) {
    const hp = parseHostPort(m.target);
    if (!hp) return { ok: false, degraded: false, latencyMs: 0, detail: `Invalid target "${m.target}" — use host:port` };
    const r = await tcpProbe(hp.host, hp.port, timeoutMs);
    if (!r.open) return { ok: false, degraded: false, latencyMs: r.latencyMs, detail: `TCP ${hp.host}:${hp.port} closed — ${r.error}` };
    const slow = m.warningThresholdMs > 0 && r.latencyMs > m.warningThresholdMs;
    return { ok: true, degraded: slow, latencyMs: r.latencyMs, detail: `TCP ${hp.host}:${hp.port} open in ${r.latencyMs}ms` };
  }

  if (m.type === 'DNS') {
    const r = await dnsProbe(m.target, timeoutMs);
    return { ok: r.ok, degraded: false, latencyMs: r.latencyMs, detail: r.detail };
  }

  if (m.type === 'SSL') {
    const r = await sslProbe(m.target, timeoutMs);
    if (!r.ok) return { ok: false, degraded: false, latencyMs: r.latencyMs, detail: r.detail };
    if (r.daysLeft !== null && r.daysLeft < 7) return { ok: false, degraded: false, latencyMs: r.latencyMs, detail: `Certificate expires in ${r.daysLeft} days` };
    return { ok: true, degraded: r.daysLeft !== null && r.daysLeft < 21, latencyMs: r.latencyMs, detail: r.detail };
  }

  if (INFRA_TYPES.includes(m.type)) {
    const srv = db.servers.find(s => s.id === (m.serverId || m.target));
    if (!srv) return { ok: false, degraded: false, latencyMs: 0, detail: 'Linked server no longer exists' };
    if (srv.agentStatus !== 'CONNECTED') return { ok: false, degraded: false, latencyMs: 0, detail: `Telemetry agent on ${srv.hostname} is ${srv.agentStatus}` };
    const key = m.type === 'INFRA_CPU' ? 'cpuPercent' : m.type === 'INFRA_RAM' ? 'ramPercent' : 'diskPercent';
    const value = srv.telemetry[key];
    const warn = pct(m.warningThresholdMs, 80);
    const crit = pct(m.criticalThresholdMs, 95);
    const label = key.replace('Percent', '').toUpperCase();
    if (value >= crit) return { ok: false, degraded: false, latencyMs: Math.round(value), detail: `${label} ${value.toFixed(1)}% ≥ ${crit}% critical` };
    return { ok: true, degraded: value >= warn, latencyMs: Math.round(value), detail: `${label} ${value.toFixed(1)}%${value >= warn ? ` ≥ ${warn}% warning` : ''}` };
  }

  if (PUSH_TYPES.includes(m.type)) {
    const graceMs = (m.intervalSec + m.timeoutSec) * 1000;
    const last = m.lastPingAt ? new Date(m.lastPingAt).getTime() : null;
    if (last === null) {
      const createdAt = monitorCreatedAt.get(m.id) ?? Date.now();
      if (Date.now() - createdAt < graceMs) return { ok: true, degraded: false, latencyMs: 0, detail: 'Waiting for first ping', pending: true };
      return { ok: false, degraded: false, latencyMs: 0, detail: `No ping received (expected every ${m.intervalSec}s)` };
    }
    const ageSec = Math.round((Date.now() - last) / 1000);
    if (Date.now() - last > graceMs) return { ok: false, degraded: false, latencyMs: 0, detail: `Last ping ${ageSec}s ago (expected every ${m.intervalSec}s)` };
    if (m.type === 'DB_REPLICATION' && typeof m.lastValue === 'number') {
      const lagMs = m.lastValue * 1000;
      if (m.criticalThresholdMs > 0 && lagMs > m.criticalThresholdMs) return { ok: false, degraded: false, latencyMs: lagMs, detail: `Replication lag ${m.lastValue}s exceeds ${m.criticalThresholdMs / 1000}s` };
      return { ok: true, degraded: m.warningThresholdMs > 0 && lagMs > m.warningThresholdMs, latencyMs: lagMs, detail: `Replication lag ${m.lastValue}s` };
    }
    return { ok: true, degraded: false, latencyMs: 0, detail: `Last ping ${ageSec}s ago${typeof m.lastValue === 'number' ? ` (value ${m.lastValue})` : ''}` };
  }

  return { ok: false, degraded: false, latencyMs: 0, detail: `Unsupported monitor type ${m.type}` };
}

/** Runs a check with retries: a failure is only recorded after all attempts fail. */
async function checkWithRetries(m: Monitor): Promise<CheckOutcome> {
  const attempts = PUSH_TYPES.includes(m.type) || INFRA_TYPES.includes(m.type) ? 1 : Math.min(Math.max(1, m.retries), 3);
  let outcome = await executeCheck(m);
  for (let i = 1; i < attempts && !outcome.ok; i++) {
    await new Promise(r => setTimeout(r, 2000));
    outcome = await executeCheck(m);
  }
  return outcome;
}

// ─────────────────────────────────────────────────────────────────────────────
// State machine, history, uptime buckets, incidents
// ─────────────────────────────────────────────────────────────────────────────
const latencySamples = new Map<string, number[]>();
const monitorCreatedAt = new Map<string, number>();
const lastRunAt = new Map<string, number>();
const inFlight = new Set<string>();

export function registerNewMonitor(m: Monitor) {
  monitorCreatedAt.set(m.id, Date.now());
  lastRunAt.delete(m.id); // run immediately
}

function recordBucket(monitorId: string, ok: boolean, latencyMs: number) {
  const h = Math.floor(Date.now() / 3_600_000);
  const buckets = (db.monitorBuckets[monitorId] ??= []);
  let b: MonitorBucket | undefined = buckets[buckets.length - 1];
  if (!b || b.h !== h) {
    b = { h, total: 0, ok: 0, latSum: 0 };
    buckets.push(b);
    while (buckets.length && buckets[0].h < h - 24 * 30) buckets.shift();
  }
  b.total += 1;
  if (ok) { b.ok += 1; b.latSum += latencyMs; }
}

function uptimeFor(monitorIds: string[], hours: number): number | null {
  const minH = Math.floor(Date.now() / 3_600_000) - hours + 1;
  let total = 0, ok = 0;
  for (const id of monitorIds) {
    for (const b of db.monitorBuckets[id] ?? []) {
      if (b.h >= minH) { total += b.total; ok += b.ok; }
    }
  }
  return total === 0 ? null : Math.round((ok / total) * 10000) / 100;
}

function isInMaintenance(m: Monitor): boolean {
  const now = Date.now();
  return db.maintenanceWindows.some(w =>
    w.status !== 'COMPLETED' && w.status !== 'EXPIRED' &&
    new Date(w.startTime).getTime() <= now && new Date(w.endTime).getTime() > now &&
    (w.suppressMonitors.includes(m.id) ||
      (w.suppressMonitors.length === 0 && w.applicationId === m.applicationId && w.environment === m.environment)));
}

function findOpenIncident(fingerprint: string): Incident | undefined {
  return db.incidents.find(i => i.fingerprint === fingerprint && i.status !== 'RESOLVED' && i.status !== 'CLOSED');
}

function timelineEvent(source: string, level: Incident['timeline'][number]['level'], message: string) {
  return { id: crypto.randomUUID(), timestamp: new Date().toISOString(), source, level, message };
}

export function nextIncidentId() {
  db.incidentSeq += 1;
  return `INC-${db.incidentSeq}`;
}

const lastNotifiedAt = new Map<string, number>();

function openIncidentForMonitor(m: Monitor, detail: string) {
  const fingerprint = `monitor:${m.id}`;
  const existing = findOpenIncident(fingerprint);
  if (existing) {
    existing.timeline.push(timelineEvent('Monitor Engine', 'CRITICAL', `${m.name} failed again: ${detail}`));
    broadcast('incident_update', existing);
    return;
  }
  const srv = m.serverId ? db.servers.find(s => s.id === m.serverId) : undefined;
  const app = db.applications.find(a => a.id === m.applicationId);
  const incident: Incident = {
    id: nextIncidentId(),
    title: `${m.name} is DOWN`,
    severity: m.environment === 'PRD' ? 'CRITICAL' : 'HIGH',
    status: 'OPEN',
    applicationId: m.applicationId,
    environment: m.environment,
    fingerprint,
    rootCause: detail,
    startedAt: new Date().toISOString(),
    durationMinutes: 0,
    owner: 'Unassigned',
    acknowledged: false,
    affectedServices: [app?.name, srv?.hostname].filter((x): x is string => Boolean(x)),
    affectedMonitors: [m.id],
    dependentFailures: [],
    timeline: [timelineEvent('Monitor Engine', 'CRITICAL',
      `${m.name} (${m.type} ${m.target}) confirmed DOWN after ${m.consecutiveFailures} consecutive failures: ${detail}`)],
    recoveryStatus: 'Awaiting recovery',
    runbookId: m.runbookId,
    notes: [],
  };
  db.incidents.unshift(incident);
  lastNotifiedAt.set(incident.id, Date.now());
  broadcast('incident_created', incident);
  audit('Monitor Engine', 'INCIDENT_OPENED', 'INCIDENT', incident.id, `${incident.title}: ${detail}`);
  notifyIncident(incident, 'FIRING');
}

function resolveIncidentForMonitor(m: Monitor) {
  const incident = findOpenIncident(`monitor:${m.id}`);
  if (!incident) return;
  const now = new Date();
  incident.status = 'RESOLVED';
  incident.resolvedAt = now.toISOString();
  incident.durationMinutes = Math.max(0, Math.round((now.getTime() - new Date(incident.startedAt).getTime()) / 60000));
  incident.recoveryStatus = `Recovered automatically after ${m.consecutiveRecoveries} consecutive successful checks`;
  incident.timeline.push(timelineEvent('Monitor Engine', 'SUCCESS', `${m.name} recovered — ${incident.recoveryStatus}`));
  lastNotifiedAt.delete(incident.id);
  broadcast('incident_update', incident);
  audit('Monitor Engine', 'INCIDENT_AUTO_RESOLVED', 'INCIDENT', incident.id, `${incident.title} recovered after ${incident.durationMinutes} min`);
  notifyIncident(incident, 'RESOLVED', `Downtime: ${incident.durationMinutes} min`);
}

function applyOutcome(m: Monitor, outcome: CheckOutcome) {
  const now = new Date().toISOString();
  const prev = m.status;
  const maintenance = isInMaintenance(m);
  m.activeMaintenance = maintenance;
  m.lastCheck = now;

  if (outcome.pending) {
    m.history = [{ timestamp: now, status: 'UNKNOWN' as OperationalStatus, responseTimeMs: 0, detail: outcome.detail }, ...m.history].slice(0, 60);
    return;
  }

  if (outcome.ok) {
    m.consecutiveFailures = 0;
    m.consecutiveRecoveries += 1;
    m.lastSuccess = now;
    m.responseTimeMs = outcome.latencyMs;
    const healthyStatus: OperationalStatus = outcome.degraded ? 'WARNING' : 'HEALTHY';
    const recovering = prev === 'CRITICAL' && m.consecutiveRecoveries < m.recoveryConfirmationThreshold;
    m.status = maintenance ? 'MAINTENANCE' : recovering ? 'CRITICAL' : healthyStatus;
    if (HTTP_TYPES.includes(m.type) || TCP_TYPES.includes(m.type)) {
      const samples = latencySamples.get(m.id) ?? [];
      samples.push(outcome.latencyMs);
      if (samples.length > 300) samples.shift();
      latencySamples.set(m.id, samples);
    }
  } else {
    m.consecutiveRecoveries = 0;
    m.consecutiveFailures += 1;
    m.lastFailure = now;
    m.responseTimeMs = outcome.latencyMs;
    const confirmed = m.consecutiveFailures >= m.failureConfirmationThreshold;
    m.status = maintenance ? 'MAINTENANCE' : confirmed ? 'CRITICAL' : prev === 'UNKNOWN' ? 'UNKNOWN' : 'WARNING';
  }

  recordBucket(m.id, outcome.ok, outcome.latencyMs);
  m.uptimePercent = uptimeFor([m.id], 24 * 30) ?? 100;
  m.history = [{
    timestamp: now,
    status: outcome.ok ? (outcome.degraded ? 'WARNING' : 'HEALTHY') : 'CRITICAL',
    responseTimeMs: outcome.latencyMs,
    statusCode: outcome.statusCode,
    detail: outcome.detail,
  } as Monitor['history'][number], ...m.history].slice(0, 60);

  if (!maintenance) {
    if (m.status === 'CRITICAL' && prev !== 'CRITICAL') openIncidentForMonitor(m, outcome.detail);
    if (prev === 'CRITICAL' && m.status !== 'CRITICAL') resolveIncidentForMonitor(m);
  }
}

export async function runMonitorNow(m: Monitor): Promise<Monitor> {
  if (inFlight.has(m.id)) return m;
  inFlight.add(m.id);
  lastRunAt.set(m.id, Date.now());
  try {
    const outcome = await checkWithRetries(m);
    // The monitor may have been deleted or replaced while the check was running
    const current = db.monitors.find(x => x.id === m.id);
    if (!current) return m;
    applyOutcome(current, outcome);
    persist();
    broadcast('monitor_update', current);
    recomputeDerived();
    void evaluateAutoFailover(current);
    return current;
  } catch (err) {
    console.error(`[engine] monitor ${m.name} check crashed: ${(err as Error).message}`);
    return m;
  } finally {
    inFlight.delete(m.id);
  }
}

function schedulerTick() {
  const now = Date.now();
  for (const m of db.monitors) {
    if (inFlight.size >= config.monitorConcurrency) break;
    if (!m.enabled || inFlight.has(m.id)) continue;
    const last = lastRunAt.get(m.id);
    if (last !== undefined && now - last < Math.max(5, m.intervalSec) * 1000) continue;
    void runMonitorNow(m);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent telemetry
// ─────────────────────────────────────────────────────────────────────────────
export interface AgentReport {
  agentVersion?: string;
  hostname?: string;
  os?: string;
  cpuCores?: number;
  ramTotalMb?: number;
  diskTotalGb?: number;
  uptimeSec?: number;
  cpuPercent: number;
  ramPercent: number;
  diskPercent: number;
  load?: number[];
  netInKbps?: number;
  netOutKbps?: number;
  processes?: Array<{ pid: number; name: string; user?: string; cpu?: number; memMb?: number; status?: string }>;
  services?: Array<{ name: string; status: string; pid?: number; memoryMb?: number; cpuPercent?: number; since?: string; version?: string }>;
  logs?: Array<{ ts?: string; level?: string; service?: string; message: string }>;
}

const num = (v: unknown, min: number, max: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, n));
};
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

const minuteAcc = new Map<string, { minute: number; n: number; sum: ServerMetricPoint }>();

function recordMetric(serverId: string, p: ServerMetricPoint) {
  const live = (liveMetrics[serverId] ??= []);
  live.push(p);
  if (live.length > 720) live.splice(0, live.length - 720);

  const minute = Math.floor(Date.parse(p.t) / 60000);
  const acc = minuteAcc.get(serverId);
  if (!acc || acc.minute !== minute) {
    if (acc && acc.n > 0) {
      const series = (minuteMetrics[serverId] ??= []);
      const r = (x: number) => Math.round((x / acc.n) * 10) / 10;
      series.push({ t: new Date(acc.minute * 60000).toISOString(), cpu: r(acc.sum.cpu), ram: r(acc.sum.ram), disk: r(acc.sum.disk), load1: r(acc.sum.load1), netIn: r(acc.sum.netIn), netOut: r(acc.sum.netOut) });
      const cutoff = Date.now() - config.metricsRetentionHours * 3600 * 1000;
      while (series.length && Date.parse(series[0].t) < cutoff) series.shift();
    }
    minuteAcc.set(serverId, { minute, n: 1, sum: { ...p } });
  } else {
    acc.n += 1;
    acc.sum.cpu += p.cpu; acc.sum.ram += p.ram; acc.sum.disk += p.disk;
    acc.sum.load1 += p.load1; acc.sum.netIn += p.netIn; acc.sum.netOut += p.netOut;
  }
}

export function ingestAgentReport(srv: ServerRecord, r: AgentReport) {
  const now = new Date().toISOString();
  const load = Array.isArray(r.load) ? r.load : [];
  srv.telemetry = {
    cpuPercent: Math.round(num(r.cpuPercent, 0, 100) * 10) / 10,
    ramPercent: Math.round(num(r.ramPercent, 0, 100) * 10) / 10,
    diskPercent: Math.round(num(r.diskPercent, 0, 100) * 10) / 10,
    loadAvg: [num(load[0], 0, 1e4), num(load[1], 0, 1e4), num(load[2], 0, 1e4)],
    networkInKbps: Math.round(num(r.netInKbps, 0, 1e9)),
    networkOutKbps: Math.round(num(r.netOutKbps, 0, 1e9)),
    observedAt: now,
    receivedAt: now,
  };
  srv.lastSeen = now;
  if (r.agentVersion) srv.agentVersion = text(r.agentVersion, 32);
  if (r.os) srv.os = text(r.os, 120);
  if (r.cpuCores) srv.cpuCores = Math.round(num(r.cpuCores, 0, 1024));
  if (r.ramTotalMb) srv.ramGb = Math.round(num(r.ramTotalMb, 0, 1e7) / 102.4) / 10;
  if (r.diskTotalGb) srv.diskGb = Math.round(num(r.diskTotalGb, 0, 1e7));
  if (r.uptimeSec !== undefined) srv.uptimeDays = Math.floor(num(r.uptimeSec, 0, 1e10) / 86400);

  if (Array.isArray(r.processes)) {
    srv.processes = r.processes.slice(0, 25).map((p): VpsProcess => ({
      pid: Math.round(num(p.pid, 0, 1e9)),
      name: text(p.name, 200),
      user: text(p.user, 64),
      cpuPercent: Math.round(num(p.cpu, 0, 10000) * 10) / 10,
      memMb: Math.round(num(p.memMb, 0, 1e7)),
      status: p.status === 'sleeping' || p.status === 'stopped' ? p.status : 'running',
    }));
  }
  if (Array.isArray(r.services)) {
    srv.services = r.services.slice(0, 50).map((s): VpsService => ({
      name: text(s.name, 100),
      status: (['active', 'inactive', 'failed', 'restarting'] as const).includes(s.status as VpsService['status']) ? s.status as VpsService['status'] : 'inactive',
      version: text(s.version, 50),
      pid: Math.round(num(s.pid, 0, 1e9)),
      memoryMb: Math.round(num(s.memoryMb, 0, 1e7)),
      cpuPercent: Math.round(num(s.cpuPercent, 0, 10000) * 10) / 10,
      lastRestart: text(s.since, 64),
    }));
  }
  if (Array.isArray(r.logs) && r.logs.length) {
    const entries = r.logs.slice(0, 50).map((l): VpsLogEntry => ({
      id: crypto.randomUUID(),
      timestamp: l.ts && !Number.isNaN(Date.parse(l.ts)) ? new Date(l.ts).toISOString() : now,
      level: l.level === 'error' || l.level === 'warn' ? l.level : 'info',
      service: text(l.service, 100),
      message: text(l.message, 1000),
    }));
    srv.logs = [...entries, ...srv.logs].slice(0, 200);
  }

  recordMetric(srv.id, {
    t: now,
    cpu: srv.telemetry.cpuPercent,
    ram: srv.telemetry.ramPercent,
    disk: srv.telemetry.diskPercent,
    load1: srv.telemetry.loadAvg[0],
    netIn: srv.telemetry.networkInKbps,
    netOut: srv.telemetry.networkOutKbps,
  });

  const wasDisconnected = srv.agentStatus !== 'CONNECTED';
  recomputeServer(srv);
  if (wasDisconnected) audit('Telemetry Agent', 'AGENT_CONNECTED', 'INFRASTRUCTURE', srv.id, `Agent on ${srv.hostname} (${srv.ip}) is reporting`);
  persist();
  broadcast('server_update', publicServer(srv));
}

export function publicServer(s: ServerRecord) {
  const { agentToken: _t, ...rest } = s;
  return rest;
}

// ─────────────────────────────────────────────────────────────────────────────
// Derived state: servers, applications, maintenance, incident durations
// ─────────────────────────────────────────────────────────────────────────────
function recomputeServer(srv: ServerRecord): boolean {
  const before = `${srv.status}|${srv.agentStatus}`;
  const age = srv.lastSeen ? (Date.now() - Date.parse(srv.lastSeen)) / 1000 : Infinity;
  srv.agentStatus = age <= config.telemetryStaleSec ? 'CONNECTED' : age <= config.telemetryStaleSec * 10 ? 'STALE' : 'DISCONNECTED';

  const monitorStatuses = db.monitors.filter(m => m.enabled && m.serverId === srv.id).map(m => m.status);
  let status = worst(monitorStatuses.filter(s => s !== 'UNKNOWN'), 'UNKNOWN');

  if (srv.agentStatus === 'CONNECTED') {
    const t = srv.telemetry;
    const hot = Math.max(t.cpuPercent, t.ramPercent, t.diskPercent);
    const resourceStatus: OperationalStatus = hot >= 95 ? 'CRITICAL' : hot >= 85 ? 'WARNING' : 'HEALTHY';
    status = status === 'UNKNOWN' ? resourceStatus : worst([status, resourceStatus === 'CRITICAL' ? 'WARNING' : resourceStatus]);
  } else if (srv.lastSeen) {
    // The agent used to report and stopped: treat as degraded visibility
    status = status === 'UNKNOWN' || status === 'HEALTHY' ? 'STALE' : status;
  }
  srv.status = status;
  return before !== `${srv.status}|${srv.agentStatus}`;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]);
}

const DEP_TYPE: Partial<Record<Monitor['type'], AppDependency['type']>> = {
  DB_CONN: 'DATABASE', DB_REPLICATION: 'DATABASE', WORKER_HEARTBEAT: 'WORKER', CRON_HEARTBEAT: 'WORKER', BACKUP_FRESHNESS: 'STORAGE',
};

function recomputeApplication(app: Application): boolean {
  const before = JSON.stringify([app.status, app.uptime24h, app.p95Ms, app.dependencies.length, app.currentReplicationLagSec, app.recentDeploymentVersion]);
  const activeEnv = app.failoverState === 'DR_ACTIVE' ? 'DR' : 'PRD';
  const appMonitors = db.monitors.filter(m => m.enabled && m.applicationId === app.id);
  const active = appMonitors.filter(m => m.environment === activeEnv);
  const activeIds = active.map(m => m.id);

  if (active.length > 0) {
    app.status = worst(active.map(m => m.status).filter(s => s !== 'UNKNOWN'), 'UNKNOWN');
  } else {
    const srv = db.servers.find(s => s.id === (activeEnv === 'DR' ? app.drServerId : app.prdServerId));
    app.status = srv?.status ?? 'UNKNOWN';
  }
  if (app.failoverState === 'FAILING_OVER') app.status = worst([app.status, 'WARNING']);

  app.uptime24h = uptimeFor(activeIds, 24);
  app.uptime7d = uptimeFor(activeIds, 24 * 7);
  app.uptime30d = uptimeFor(activeIds, 24 * 30);
  const e24 = app.uptime24h;
  app.errorRatePercent = e24 === null ? null : Math.round((100 - e24) * 100) / 100;

  const samples = active.flatMap(m => latencySamples.get(m.id) ?? []).sort((a, b) => a - b);
  app.p50Ms = percentile(samples, 50);
  app.p95Ms = percentile(samples, 95);
  app.p99Ms = percentile(samples, 99);

  const repl = appMonitors.find(m => m.type === 'DB_REPLICATION' && typeof m.lastValue === 'number');
  app.currentReplicationLagSec = repl ? (repl.lastValue as number) : null;

  app.dependencies = appMonitors.map(m => ({
    id: m.id,
    name: `${m.name} [${m.environment}]`,
    type: DEP_TYPE[m.type] ?? 'EXTERNAL_API',
    status: m.status,
    latencyMs: m.responseTimeMs,
    lastChecked: m.lastCheck,
    target: m.target,
  }));
  const checks = appMonitors.map(m => m.lastCheck).filter(Boolean).sort();
  if (checks.length) app.lastChecked = checks[checks.length - 1];

  const lastDeploy = db.deployments
    .filter(d => d.applicationId === app.id && d.status === 'SUCCESS' && d.environment === activeEnv)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  app.recentDeploymentVersion = lastDeploy?.version;

  return before !== JSON.stringify([app.status, app.uptime24h, app.p95Ms, app.dependencies.length, app.currentReplicationLagSec, app.recentDeploymentVersion]);
}

function updateMaintenanceStatuses(): boolean {
  const now = Date.now();
  let changed = false;
  for (const w of db.maintenanceWindows) {
    if (w.status === 'COMPLETED') continue;
    const start = Date.parse(w.startTime), end = Date.parse(w.endTime);
    const next: typeof w.status = now < start ? 'SCHEDULED' : now < end ? 'IN_PROGRESS' : 'EXPIRED';
    if (next !== w.status) {
      w.status = next;
      changed = true;
      broadcast('maintenance_update', w);
    }
  }
  return changed;
}

export function recomputeDerived() {
  let serversChanged = false;
  for (const srv of db.servers) if (recomputeServer(srv)) serversChanged = true;
  let appsChanged = false;
  for (const app of db.applications) if (recomputeApplication(app)) appsChanged = true;
  if (updateMaintenanceStatuses()) persist();
  if (serversChanged) broadcast('servers_changed', null);
  if (appsChanged) broadcast('applications_changed', null);
}

function updateIncidentDurations() {
  const now = Date.now();
  for (const inc of db.incidents) {
    if (inc.status === 'RESOLVED' || inc.status === 'CLOSED') continue;
    inc.durationMinutes = Math.max(0, Math.round((now - Date.parse(inc.startedAt)) / 60000));
    // Repeat notification for unacknowledged incidents according to the escalation policy
    const policy = db.escalationPolicies.find(p => p.severity === inc.severity);
    if (policy && !inc.acknowledged && policy.repeatIntervalMin > 0) {
      const last = lastNotifiedAt.get(inc.id) ?? Date.parse(inc.startedAt);
      if (now - last >= policy.repeatIntervalMin * 60000) {
        lastNotifiedAt.set(inc.id, now);
        notifyIncident(inc, 'FIRING', `Reminder: still unacknowledged after ${inc.durationMinutes} min`);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Failover (real Cloudflare DNS switch)
// ─────────────────────────────────────────────────────────────────────────────
const failoverLocks = new Set<string>();
const FAILOVER_COOLDOWN_MS = 10 * 60 * 1000;

export class FailoverError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function performFailover(app: Application, target: 'DR' | 'PRIMARY', operator: string, reason: string) {
  if (failoverLocks.has(app.id)) throw new FailoverError('A failover for this application is already in progress', 409);
  const targetServer = db.servers.find(s => s.id === (target === 'DR' ? app.drServerId : app.prdServerId));
  if (!targetServer) throw new FailoverError(`No ${target === 'DR' ? 'DR' : 'PRD'} server is linked to ${app.name}`);
  if (!isCloudflareConfigured()) {
    throw new FailoverError('Cloudflare is not configured — set CLOUDFLARE_API_TOKEN in .env and restart the server');
  }
  if (!app.cloudflareZone || !app.dnsRecordName) {
    throw new FailoverError(`${app.name} has no Cloudflare zone / DNS record configured — set them in Setup before failing over`);
  }
  const desiredState = target === 'DR' ? 'DR_ACTIVE' : 'PRIMARY_ACTIVE';
  failoverLocks.add(app.id);
  const previousState = app.failoverState;
  app.failoverState = 'FAILING_OVER';
  broadcast('application_update', app);
  try {
    const changed = await switchDnsRecord(app.cloudflareZone, app.dnsRecordName, targetServer.ip);
    app.failoverState = desiredState;
    app.lastFailoverAt = new Date().toISOString();
    const summary = changed.length
      ? changed.map(c => `${c.from} → ${c.to}`).join(', ')
      : `already pointing at ${targetServer.ip}`;
    audit(operator, `FAILOVER_TO_${target}`, 'FAILOVER', app.id, `${app.name}: ${app.dnsRecordName} ${summary}. Reason: ${reason}`);
    notifyAll(`Failover: ${app.name} → ${target}`, `${app.dnsRecordName} now points to ${targetServer.hostname} (${targetServer.ip}).\nBy: ${operator}\nReason: ${reason}`, 'HIGH');
    recomputeDerived();
    persist();
    broadcast('application_update', app);
    return { app, changed };
  } catch (err) {
    app.failoverState = previousState;
    audit(operator, `FAILOVER_TO_${target}_FAILED`, 'FAILOVER', app.id, `${app.name}: ${(err as Error).message}`);
    persist();
    broadcast('application_update', app);
    throw new FailoverError((err as Error).message, 502);
  } finally {
    failoverLocks.delete(app.id);
  }
}

async function evaluateAutoFailover(m: Monitor) {
  if (m.environment !== 'PRD' || m.status !== 'CRITICAL') return;
  const app = db.applications.find(a => a.id === m.applicationId);
  if (!app || !app.autoFailover || app.failoverState !== 'PRIMARY_ACTIVE') return;
  if (app.lastFailoverAt && Date.now() - Date.parse(app.lastFailoverAt) < FAILOVER_COOLDOWN_MS) return;
  const drAvailability = db.monitors.filter(x => x.enabled && x.applicationId === app.id && x.environment === 'DR' && AVAILABILITY_TYPES.includes(x.type));
  if (drAvailability.length === 0) {
    audit('Auto-Failover', 'AUTO_FAILOVER_SKIPPED', 'FAILOVER', app.id, `${app.name} PRD is CRITICAL but no DR availability monitors exist to confirm DR is healthy`);
    return;
  }
  if (!drAvailability.every(x => x.status === 'HEALTHY' || x.status === 'WARNING')) {
    audit('Auto-Failover', 'AUTO_FAILOVER_SKIPPED', 'FAILOVER', app.id, `${app.name} PRD is CRITICAL but DR is not healthy — staying on PRD`);
    return;
  }
  try {
    await performFailover(app, 'DR', 'Auto-Failover', `${m.name} confirmed CRITICAL: ${m.history[0]?.detail ?? ''}`);
  } catch (err) {
    console.error(`[engine] auto-failover for ${app.name} failed: ${(err as Error).message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dead-man switch: this server pings an EXTERNAL heartbeat service. If this
// server dies, the external service stops receiving pings and alerts you.
// ─────────────────────────────────────────────────────────────────────────────
export const deadMan: DeadManControlPlane = {
  id: 'deadman-outbound',
  name: 'External Dead-Man Heartbeat',
  nodeLocation: config.deadManHeartbeatUrl ? new URL(config.deadManHeartbeatUrl).host : 'Not configured',
  targetControlPlane: config.deadManHeartbeatUrl ? new URL(config.deadManHeartbeatUrl).origin : '',
  lastHeartbeatReceivedAt: '',
  intervalSec: config.deadManIntervalSec,
  toleranceSec: config.deadManToleranceSec,
  status: config.deadManHeartbeatUrl ? 'HEALTHY' : 'NOT_CONFIGURED',
  consecutiveMisses: 0,
};

async function sendDeadManHeartbeat() {
  if (!config.deadManHeartbeatUrl) return;
  const prevStatus = deadMan.status;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(config.deadManHeartbeatUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    deadMan.lastHeartbeatReceivedAt = new Date().toISOString();
    deadMan.consecutiveMisses = 0;
    deadMan.status = 'HEALTHY';
  } catch (err) {
    deadMan.consecutiveMisses += 1;
    if (deadMan.consecutiveMisses * deadMan.intervalSec >= deadMan.toleranceSec) deadMan.status = 'CRITICAL_SILENCE';
    console.error(`[deadman] heartbeat failed: ${(err as Error).message}`);
  }
  if (prevStatus !== deadMan.status) {
    audit('Dead-Man Switch', `DEADMAN_${deadMan.status}`, 'MONITOR', deadMan.id, `Outbound heartbeat is now ${deadMan.status}`);
  }
  broadcast('deadman_update', deadMan);
}

// ─────────────────────────────────────────────────────────────────────────────
export function startEngine() {
  for (const m of db.monitors) {
    // Spread first runs across the interval so a restart does not fire every check at once
    const offset = (db.monitors.indexOf(m) * 997) % (Math.max(5, m.intervalSec) * 1000);
    lastRunAt.set(m.id, Date.now() - Math.max(5, m.intervalSec) * 1000 + offset);
    if (!m.lastPingAt) monitorCreatedAt.set(m.id, Date.now());
  }
  recomputeDerived();
  setInterval(schedulerTick, 1000).unref();
  setInterval(() => {
    recomputeDerived();
    updateIncidentDurations();
    broadcast('telemetry_tick', {
      timestamp: new Date().toISOString(),
      deadManStatus: deadMan.status,
      servers: db.servers.map(s => ({ id: s.id, status: s.status, agentStatus: s.agentStatus, lastSeen: s.lastSeen, telemetry: s.telemetry })),
    });
  }, 5000).unref();
  if (config.deadManHeartbeatUrl) {
    void sendDeadManHeartbeat();
    setInterval(sendDeadManHeartbeat, config.deadManIntervalSec * 1000).unref();
  }
}

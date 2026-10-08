/**
 * DR readiness, failover pre-flight and availability — computed only from real evidence:
 * monitor checks, agent telemetry and database probes, backup reports and the Cloudflare
 * Load Balancer state. Missing evidence is UNKNOWN or NOT_CONFIGURED, never PASS.
 */
import {
  Application, CheckVerdict, DrOverall, DrReadinessItem, FailoverPreflight, FailoverPreflightCheck, LbPool,
} from '../src/types/index.ts';
import { config } from './config.ts';
import { db, ServerRecord } from './store.ts';
import { HTTP_TYPES } from './engine.ts';
import { lbState, poolFor, routingFor, originHealthy, originRtt, PERMISSION_HINT } from './loadbalancer.ts';
import { readChecks, availability, AvailabilityStats } from './history.ts';
import { THRESHOLDS } from '../src/lib/thresholds.ts';
import { serverHealth } from './telemetryHealth.ts';
import { Env, agentState, appHealth, backupStatus, databaseHealth, inventoryFor, serverFor, sslMonitor, urlMonitor } from './health.ts';

const envLabel = (env: Env) => (env === 'PRD' ? 'Production' : 'DR');
const item = (key: string, label: string, status: CheckVerdict, detail: string, observedAt: string | null = null, group: 'core' | 'capacity' = 'core'): DrReadinessItem =>
  ({ key, label, status, detail, observedAt: observedAt || null, group });

/** Why Cloudflare data is missing, in operator terms */
function lbUnavailableReason(): string {
  switch (lbState.status) {
    case 'NOT_CONFIGURED': return `Not configured — ${lbState.lastError ?? 'Cloudflare token missing'}`;
    case 'PERMISSION_REQUIRED': return PERMISSION_HINT;
    case 'PENDING': return 'Cloudflare not synced yet';
    default: return `Check failed — ${lbState.lastError ?? 'Cloudflare API error'}`;
  }
}

function originOf(pool: LbPool | undefined, srv: ServerRecord | undefined) {
  return pool ? (pool.origins.find(o => o.address === srv?.ip) ?? pool.origins[0]) : undefined;
}

// ── Individual checks (shared by readiness and pre-flight) ───────────────────
function checkReachable(app: Application, env: Env, key: string): DrReadinessItem {
  const L = `${envLabel(env)} reachable`;
  const srv = serverFor(app, env);
  if (!srv) return item(key, L, 'NOT_CONFIGURED', `No ${envLabel(env)} server linked to ${app.name}`);
  const pool = app.loadBalancer ? poolFor(app, env) : undefined;
  const origin = originOf(pool, srv);
  const oh = origin ? originHealthy(origin) : null;
  const agent = agentState(srv);
  const lbAt = pool?.healthFetchedAt ?? pool?.listFetchedAt ?? null;
  if (oh === true || agent === 'ONLINE') {
    return item(key, L, 'PASS', [oh === true ? `Cloudflare reaches origin ${origin!.address}` : null, agent === 'ONLINE' ? `agent heartbeat ${srv.lastSeen}` : null].filter(Boolean).join(' · '), agent === 'ONLINE' ? srv.lastSeen : lbAt);
  }
  if (oh === false) return item(key, L, 'FAIL', `Cloudflare marks origin ${origin!.address} unhealthy${agent !== 'NOT_CONNECTED' ? ` and agent is ${agent}` : ''}`, lbAt);
  if (agent === 'OFFLINE') return item(key, L, 'FAIL', `Agent on ${srv.ip} stopped reporting (last ${srv.lastSeen}) and no Cloudflare origin data`, srv.lastSeen);
  return item(key, L, 'UNKNOWN', `No evidence for ${srv.ip}: Cloudflare origin health ${pool ? 'not available' : app.loadBalancer ? lbUnavailableReason() : 'not mapped'}; agent ${agent === 'NOT_CONNECTED' ? 'not installed' : agent}`);
}

function checkApp(app: Application, env: Env, key: string): DrReadinessItem {
  const h = appHealth(app, env);
  const verdict: CheckVerdict = h.status === 'HEALTHY' ? 'PASS' : h.status === 'DOWN' ? 'FAIL' : h.status === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : h.status === 'DEGRADED' ? 'FAIL' : 'UNKNOWN';
  return item(key, `${envLabel(env)} application healthy`, verdict, h.status === 'DEGRADED' ? `DEGRADED — ${h.detail}` : h.detail, h.observedAt);
}

function checkDb(app: Application, env: Env, key: string): DrReadinessItem {
  const d = databaseHealth(app, env);
  const verdict: CheckVerdict = d.status === 'HEALTHY' || d.status === 'DEGRADED' ? 'PASS' : d.status === 'DOWN' ? 'FAIL' : d.status === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'UNKNOWN';
  return item(key, `${envLabel(env)} database available`, verdict, d.detail, d.observedAt);
}

function checkReplication(app: Application): DrReadinessItem[] {
  const d = databaseHealth(app, 'DR');
  const maxLag = inventoryFor(app, 'DR')?.replicationMaxLagSec ?? config.replicationMaxLagSec;
  if (d.status === 'NOT_CONFIGURED') {
    return [item('replication_healthy', 'Replication healthy', 'NOT_CONFIGURED', d.detail), item('replication_lag', `Replication lag ≤ ${maxLag}s`, 'NOT_CONFIGURED', d.detail)];
  }
  const r = d.report?.replication;
  if (!d.report || d.status === 'UNKNOWN') {
    return [item('replication_healthy', 'Replication healthy', 'UNKNOWN', d.detail, d.observedAt), item('replication_lag', `Replication lag ≤ ${maxLag}s`, 'UNKNOWN', d.detail, d.observedAt)];
  }
  if (!d.report.available) {
    return [item('replication_healthy', 'Replication healthy', 'FAIL', d.detail, d.observedAt), item('replication_lag', `Replication lag ≤ ${maxLag}s`, 'UNKNOWN', 'DR database unavailable', d.observedAt)];
  }
  if (!r || r.role !== 'replica') {
    const why = `The DR database does not report itself as a replica (${r ? `role ${r.role}` : 'no replication status'}) — replication from Production is not confirmed`;
    return [item('replication_healthy', 'Replication healthy', 'UNKNOWN', why, d.observedAt), item('replication_lag', `Replication lag ≤ ${maxLag}s`, 'UNKNOWN', why, d.observedAt)];
  }
  const healthy = item('replication_healthy', 'Replication healthy', r.state === 'running' ? 'PASS' : r.state === 'unknown' ? 'UNKNOWN' : 'FAIL',
    `Replica ${r.state}${r.error ? `: ${r.error}` : ''}${r.lastSuccessAt ? ` · last replayed ${r.lastSuccessAt}` : ''}`, d.observedAt);
  const lag = item('replication_lag', `Replication lag ≤ ${maxLag}s`, r.lagSec === null ? 'UNKNOWN' : r.lagSec <= maxLag ? 'PASS' : 'FAIL',
    r.lagSec === null ? 'Replica does not report a lag value' : `Lag ${r.lagSec}s (threshold ${maxLag}s)`, d.observedAt);
  return [healthy, lag];
}

function checkBackup(app: Application): DrReadinessItem {
  const b = backupStatus(app);
  if (b.status === 'UNKNOWN' && !b.lastBackupAt) return item('backup_recent', 'Backup recent', 'NOT_CONFIGURED', b.detail);
  return item('backup_recent', `Backup recent (≤ ${b.thresholdHours} h)`, b.status === 'HEALTHY' ? 'PASS' : b.status === 'UNKNOWN' ? 'UNKNOWN' : 'FAIL', b.detail, b.lastBackupAt);
}

function checkPool(app: Application, env: Env, key: string): DrReadinessItem {
  const L = `${envLabel(env)} Cloudflare pool healthy`;
  if (!app.loadBalancer) return item(key, L, 'NOT_CONFIGURED', 'No Cloudflare Load Balancer mapping on this application');
  const pool = poolFor(app, env);
  if (!pool || (!pool.found && lbState.status !== 'OK')) return item(key, L, 'UNKNOWN', lbUnavailableReason());
  if (!pool.found) return item(key, L, 'FAIL', `Pool ${pool.id} was not returned by Cloudflare`, lbState.lastSyncAt);
  if (pool.enabled === false) return item(key, L, 'FAIL', `${pool.name} is disabled`, pool.listFetchedAt);
  const status: CheckVerdict = pool.enabled === true && pool.healthy === true ? 'PASS' : pool.healthy === false ? 'FAIL' : 'UNKNOWN';
  return item(key, L, status, `${pool.name}: enabled=${pool.enabled ?? 'unknown'}, healthy=${pool.healthy ?? 'unknown'}`, pool.healthFetchedAt ?? pool.listFetchedAt);
}

function checkOrigin(app: Application, env: Env, key: string): DrReadinessItem {
  const L = `${envLabel(env)} origin healthy`;
  if (!app.loadBalancer) return item(key, L, 'NOT_CONFIGURED', 'No Cloudflare Load Balancer mapping on this application');
  const srv = serverFor(app, env);
  const pool = poolFor(app, env);
  const origin = originOf(pool, srv);
  const at = pool?.healthFetchedAt ?? pool?.listFetchedAt ?? null;
  if (!origin) return item(key, L, 'UNKNOWN', pool?.found ? 'Pool has no origins' : lbUnavailableReason());
  if (origin.enabled === false) return item(key, L, 'FAIL', `Origin ${origin.address} is disabled in ${pool!.name}`, at);
  const oh = originHealthy(origin);
  const rtt = originRtt(origin);
  const failing = origin.health.filter(h => h.healthy === false);
  return item(key, L, oh === true ? 'PASS' : oh === false ? 'FAIL' : 'UNKNOWN',
    oh === false ? `Unhealthy at ${failing.map(h => `${h.pop} (${h.failureReason ?? 'no reason'})`).join(', ') || 'Cloudflare'}`
      : `${origin.name || origin.address} ${origin.address}: ${oh === true ? 'healthy' : 'no health data'}${rtt !== null ? ` · RTT ${rtt} ms` : ''}${origin.health.length ? ` from ${origin.health.length} PoP(s)` : ''}`, at);
}

function checkSsl(app: Application, env: Env, key: string): DrReadinessItem {
  const L = `${envLabel(env)} SSL valid`;
  const url = env === 'PRD' ? app.prdUrl : app.drUrl;
  if (!url) return item(key, L, 'NOT_CONFIGURED', `No ${envLabel(env)} URL configured`);
  if (!url.startsWith('https://')) return item(key, L, 'NOT_CONFIGURED', `${url} is not https`);
  const http = urlMonitor(app, env);
  if (http?.lastProbeStatus === 'TLS_ERROR') return item(key, L, 'FAIL', `TLS failure: ${http.history[0]?.detail ?? ''}`, http.lastCheck);
  const ssl = sslMonitor(app, env);
  if (!ssl) return item(key, L, 'NOT_CONFIGURED', 'TLS certificate monitoring is off for this application');
  if (!ssl.lastCheck) return item(key, L, 'UNKNOWN', `${ssl.name}: not checked yet`);
  const detail = ssl.history[0]?.detail ?? '';
  return item(key, L, ssl.status === 'HEALTHY' || ssl.status === 'WARNING' ? 'PASS' : ssl.status === 'CRITICAL' ? 'FAIL' : 'UNKNOWN',
    ssl.status === 'WARNING' ? `Valid but expiring soon — ${detail}` : detail, ssl.lastCheck);
}

function checkUrl(app: Application, env: Env, key: string): DrReadinessItem {
  const L = `${envLabel(env)} URL responding`;
  const m = urlMonitor(app, env);
  if (!m) return item(key, L, 'NOT_CONFIGURED', `No ${envLabel(env)} URL configured`);
  if (!m.lastCheck || !m.lastProbeStatus) return item(key, L, 'UNKNOWN', `${m.name}: not checked yet`);
  if (m.lastStatusCode == null) return item(key, L, 'FAIL', `No HTTP response (${m.lastProbeStatus}) from ${m.target}`, m.lastCheck);
  const good = m.expectedStatusCode ? m.lastStatusCode === m.expectedStatusCode : m.lastStatusCode < 400;
  return item(key, L, good ? 'PASS' : 'FAIL', `${m.target} → HTTP ${m.lastStatusCode}${m.expectedStatusCode ? ` (expected ${m.expectedStatusCode})` : ''} in ${m.history[0]?.responseTimeMs ?? '?'} ms`, m.lastCheck);
}

/** Resource checks of the DR server (agent). Shown separately; not part of the 13 core checks. */
function capacityChecks(app: Application): DrReadinessItem[] {
  const srv = serverFor(app, 'DR');
  const state = agentState(srv);
  const out: DrReadinessItem[] = [];
  const unknown = (key: string, label: string, why: string) => item(key, label, 'UNKNOWN', why, null, 'capacity');
  if (!srv) return [unknown('telemetry', 'DR telemetry heartbeat', 'No DR server linked')];
  out.push(state === 'ONLINE' ? item('telemetry', 'DR telemetry heartbeat', 'PASS', `Agent ${srv.agentVersion} online${srv.agentRestartCount ? ` · ${srv.agentRestartCount} restart(s)` : ''}`, srv.lastSeen, 'capacity')
    : state === 'NOT_CONNECTED' ? unknown('telemetry', 'DR telemetry heartbeat', `NOT_CONNECTED — agent not installed on ${srv.ip}`)
      : item('telemetry', 'DR telemetry heartbeat', state === 'STALE' ? 'WARNING' : 'FAIL', `Agent ${state} — last report ${srv.lastSeen}`, srv.lastSeen, 'capacity'));
  if (state !== 'ONLINE') {
    for (const [k, l] of [['services', 'Required services'], ['disk', 'Disk capacity'], ['memory', 'Memory capacity'], ['cpu', 'CPU / load'], ['pm2', 'PM2 applications'], ['app_local', 'Local application health'], ['time', 'Time synchronisation']]) out.push(unknown(k, l, 'No live telemetry'));
    return out;
  }
  const t = srv.telemetry;
  const at = t.observedAt || null;
  if (srv.services.length === 0) out.push(unknown('services', 'Required services', 'Agent reports no services — set SERVICES in /etc/scholario-agent.conf'));
  else {
    const failed = srv.services.filter(s => s.status === 'failed');
    const notActive = srv.services.filter(s => s.status !== 'active' && s.status !== 'failed');
    out.push(item('services', 'Required services', failed.length ? 'FAIL' : notActive.length ? 'WARNING' : 'PASS', srv.services.map(s => `${s.name}: ${s.status}`).join(', '), at, 'capacity'));
  }
  const gb = (v: number | null | undefined) => (v == null ? '?' : `${v} GB`);
  const cap = THRESHOLDS.drCapacity;
  // Fullest filesystem (all mounts when the agent reports them, otherwise the root filesystem)
  const fss = srv.filesystems?.length ? srv.filesystems : null;
  const fullest = fss ? fss.reduce((a, b) => ((b.usedPercent ?? 0) > (a.usedPercent ?? 0) ? b : a)) : null;
  const diskPct = fullest?.usedPercent ?? t.diskPercent;
  out.push(item('disk', 'Disk capacity', diskPct >= cap.diskPercent.critical ? 'FAIL' : diskPct >= cap.diskPercent.warning ? 'WARNING' : 'PASS',
    fullest ? `fullest ${fullest.mountPoint} ${fullest.usedPercent}% used (${fss!.length} filesystem(s))` : `${t.diskPercent}% used (${gb(t.diskUsedGb)} of ${gb(t.diskTotalGb)})`, at, 'capacity'));
  out.push(item('memory', 'Memory capacity', t.ramPercent >= cap.memoryPercent.critical ? 'FAIL' : t.ramPercent >= cap.memoryPercent.warning ? 'WARNING' : 'PASS', `${t.ramPercent}% used${t.swapPercent != null ? ` · swap ${t.swapPercent}%` : ''}`, at, 'capacity'));
  const cores = srv.cpuCores || srv.planSpec?.cpuCores || 0;
  const perCore = cores ? t.loadAvg[0] / cores : 0;
  out.push(item('cpu', 'CPU / load', t.cpuPercent >= cap.cpuPercent.critical || perCore >= THRESHOLDS.loadPerCore.critical ? 'FAIL' : t.cpuPercent >= cap.cpuPercent.warning || perCore >= THRESHOLDS.loadPerCore.warning ? 'WARNING' : 'PASS', `CPU ${t.cpuPercent}% · load ${t.loadAvg.map(l => l.toFixed(2)).join(' / ')}${cores ? ` on ${cores} cores` : ''}`, at, 'capacity'));

  // Agent >= 3.3 categories, judged by the same rules as the server health summary
  const health = serverHealth(srv).health;
  const fromHealth = (key: string, label: string, cat: string) => {
    const h = health.find(x => x.key === cat);
    if (!h || h.level === 'UNKNOWN') return out.push(unknown(key, label, h?.detail ?? 'Not reported'));
    out.push(item(key, label, h.level === 'CRITICAL' ? 'FAIL' : h.level === 'WARNING' ? 'WARNING' : 'PASS', h.detail, at, 'capacity'));
  };
  fromHealth('pm2', 'PM2 applications', 'pm2');
  fromHealth('app_local', 'Local application health', 'apps');
  fromHealth('time', 'Time synchronisation', 'time');
  return out;
}

export interface ReadinessResult {
  checks: DrReadinessItem[];
  overall: DrOverall;
  passed: number;
  total: number;
  evaluatedAt: string;
}

/** DR readiness: the 13 core checks (+ DR capacity, reported separately). */
export function readiness(app: Application): ReadinessResult {
  const core: DrReadinessItem[] = [
    checkReachable(app, 'PRD', 'prd_reachable'),
    checkReachable(app, 'DR', 'dr_reachable'),
    checkApp(app, 'PRD', 'prd_app'),
    checkApp(app, 'DR', 'dr_app'),
    checkDb(app, 'PRD', 'prd_db'),
    checkDb(app, 'DR', 'dr_db'),
    ...checkReplication(app),
    checkBackup(app),
    checkPool(app, 'DR', 'dr_pool'),
    checkOrigin(app, 'DR', 'dr_origin'),
    checkSsl(app, 'DR', 'dr_ssl'),
    checkUrl(app, 'DR', 'dr_url'),
  ];
  const passed = core.filter(c => c.status === 'PASS').length;
  // DR cannot be judged at all without evidence that the DR application answers
  const essential = core.filter(c => ['dr_app', 'dr_url'].includes(c.key));
  const overall: DrOverall = core.some(c => c.status === 'FAIL') ? 'NOT_READY'
    : passed === core.length ? 'READY'
      : essential.every(c => c.status !== 'PASS') ? 'UNKNOWN'
        : 'PARTIALLY_READY';
  return { checks: [...core, ...capacityChecks(app)], overall, passed, total: core.length, evaluatedAt: new Date().toISOString() };
}

export function failoverPreflight(app: Application, target: 'DR' | 'PRIMARY'): FailoverPreflight {
  const targetEnv: Env = target === 'DR' ? 'DR' : 'PRD';
  const sourceEnv: Env = targetEnv === 'DR' ? 'PRD' : 'DR';
  const now = new Date().toISOString();
  const srcHttp = urlMonitor(app, sourceEnv);
  const routing = app.loadBalancer ? routingFor(app) ?? null : null;
  const prdPool = app.loadBalancer ? poolFor(app, 'PRD') : undefined;
  const drPool = app.loadBalancer ? poolFor(app, 'DR') : undefined;
  const targetPool = targetEnv === 'DR' ? drPool : prdPool;
  const sourcePool = targetEnv === 'DR' ? prdPool : drPool;
  const dr = readiness(app);
  const checks: FailoverPreflightCheck[] = [];

  if (!srcHttp || !srcHttp.lastCheck) checks.push({ key: 'source_health', label: `${envLabel(sourceEnv)} health`, status: 'UNKNOWN', detail: 'No check result', observedAt: null });
  else checks.push({
    key: 'source_health', label: `${envLabel(sourceEnv)} health`,
    status: srcHttp.status === 'CRITICAL' ? 'PASS' : srcHttp.status === 'HEALTHY' ? 'WARNING' : 'UNKNOWN',
    detail: srcHttp.status === 'CRITICAL' ? `${srcHttp.name} is DOWN — failover is justified (${srcHttp.history[0]?.detail ?? ''})`
      : srcHttp.status === 'HEALTHY' ? `${srcHttp.name} is HEALTHY — failing over moves traffic away from a working ${envLabel(sourceEnv)}`
        : `${srcHttp.name}: ${srcHttp.status}`,
    observedAt: srcHttp.lastCheck,
  });
  const strip = (c: DrReadinessItem): FailoverPreflightCheck => ({ key: c.key, label: c.label, status: c.status, detail: c.detail, observedAt: c.observedAt });
  checks.push(strip(checkReachable(app, targetEnv, 'target_reachable')));
  checks.push(strip(checkApp(app, targetEnv, 'target_app')));
  checks.push(strip(checkSsl(app, targetEnv, 'target_https')));
  checks.push(strip(checkOrigin(app, targetEnv, 'target_origin')));
  checks.push(strip(checkPool(app, targetEnv, 'target_pool')));
  checks.push(strip(checkDb(app, targetEnv, 'target_db')));

  const lbOk = lbState.status === 'OK';
  checks.push({
    key: 'cloudflare_state', label: 'Cloudflare pool state',
    status: !app.loadBalancer ? 'NOT_CONFIGURED' : lbOk ? 'PASS' : lbState.status === 'ERROR' ? 'FAIL' : 'UNKNOWN',
    detail: !app.loadBalancer ? 'No Load Balancer mapping'
      : lbOk ? [prdPool, drPool].filter(Boolean).map(p => `${p!.name || p!.id}: enabled=${p!.enabled ?? '?'} healthy=${p!.healthy ?? '?'}`).join(' · ')
        : lbUnavailableReason(),
    observedAt: lbState.lastSyncAt,
  });
  const poolName = (id: string) => [prdPool, drPool].find(p => p?.id === id)?.name || id;
  checks.push({
    key: 'routing', label: 'Current routing state',
    status: !routing ? (app.loadBalancer ? 'UNKNOWN' : 'NOT_CONFIGURED') : routing.found ? 'PASS' : 'UNKNOWN',
    detail: !routing ? (app.loadBalancer ? 'Routing not read yet' : 'No Load Balancer mapping')
      : routing.found ? `${routing.hostname}: steering ${routing.steeringPolicy ?? 'default'}, pool order ${routing.defaultPools.map(poolName).join(' → ') || '—'}, fallback ${routing.fallbackPool ? poolName(routing.fallbackPool) : '—'}; serving: ${routing.activePoolId ? poolName(routing.activePoolId) : 'unknown'}`
        : `${routing.error ?? 'Load balancer not found'} — the token needs Zone › Load Balancers › Read on the zone`,
    observedAt: routing?.fetchedAt ?? null,
  });
  if (targetEnv === 'DR') {
    checks.push({
      key: 'readiness', label: 'DR readiness',
      status: dr.overall === 'READY' ? 'PASS' : dr.overall === 'NOT_READY' ? 'FAIL' : dr.overall === 'PARTIALLY_READY' ? 'WARNING' : 'UNKNOWN',
      detail: `${dr.overall} — ${dr.passed}/${dr.total} checks pass; not passing: ${dr.checks.filter(c => c.group === 'core' && c.status !== 'PASS').map(c => `${c.label} ${c.status}`).join(', ') || 'none'}`,
      observedAt: dr.evaluatedAt,
    });
  }

  const mode: FailoverPreflight['mode'] = app.loadBalancer ? 'LOAD_BALANCER_MANUAL' : 'DNS_RECORD';
  const tName = targetPool?.name || (targetEnv === 'DR' ? app.loadBalancer?.drPoolId : app.loadBalancer?.prdPoolId) || envLabel(targetEnv);
  const sName = sourcePool?.name || (sourceEnv === 'DR' ? app.loadBalancer?.drPoolId : app.loadBalancer?.prdPoolId) || envLabel(sourceEnv);
  const plan = mode === 'LOAD_BALANCER_MANUAL' ? [
    `Scholario Ops does NOT change Cloudflare. An authorised operator performs the switch in the Cloudflare dashboard (Traffic → Load Balancing → ${app.loadBalancer!.hostname}).`,
    `Move pool "${tName}" above "${sName}" in the default pool order${routing?.found ? ` (current order: ${routing.defaultPools.map(poolName).join(' → ')})` : ''}, or disable pool "${sName}" if it must stop receiving traffic.`,
    'Save, then watch this console: "Current routing state" should show the new serving pool and the target application check should stay HEALTHY.',
    'Record the decision below so it is captured in the audit log.',
  ] : [
    `Switch DNS record ${app.dnsRecordName ?? '(not configured)'} in zone ${app.cloudflareZone || '(not configured)'} to the ${envLabel(targetEnv)} server IP.`,
  ];

  return {
    appId: app.id, appName: app.name, target,
    currentPrimary: prdPool?.name || app.loadBalancer?.prdPoolId || serverFor(app, 'PRD')?.hostname || '—',
    currentDr: drPool?.name || app.loadBalancer?.drPoolId || serverFor(app, 'DR')?.hostname || '—',
    routing, checks, drOverall: dr.overall,
    preflightPassed: !checks.some(c => c.status === 'FAIL'),
    mode, plan, generatedAt: now,
  };
}

export interface EnvAvailability {
  environment: Env;
  /** Application availability: HTTP(S) synthetic checks of the application URL */
  application: AvailabilityStats & { monitors: string[] };
  /** Observed monitoring uptime: every check of every monitor for this environment (HTTP + TLS …) */
  monitoring: AvailabilityStats;
  /** Cloudflare origin health samples recorded at each Load Balancer sync */
  cloudflareOrigin: AvailabilityStats | null;
}

export async function applicationAvailability(app: Application, hours: number): Promise<{ range: string; since: string; environments: EnvAvailability[] }> {
  const since = Date.now() - hours * 3600 * 1000;
  const out: EnvAvailability[] = [];
  for (const env of ['PRD', 'DR'] as const) {
    const mons = db.monitors.filter(m => m.applicationId === app.id && m.environment === env);
    const httpIds = mons.filter(m => HTTP_TYPES.includes(m.type)).map(m => m.id);
    const all = await readChecks(since, mons.map(m => m.id));
    const poolId = env === 'PRD' ? app.loadBalancer?.prdPoolId : app.loadBalancer?.drPoolId;
    const cfRecs = poolId ? await readChecks(since, undefined, `cf-origin:${poolId}:`) : [];
    out.push({
      environment: env,
      application: { ...availability(all.filter(r => httpIds.includes(r.monitorId))), monitors: mons.filter(m => httpIds.includes(m.id)).map(m => m.name) },
      monitoring: availability(all),
      cloudflareOrigin: app.loadBalancer ? availability(cfRecs) : null,
    });
  }
  return { range: `${hours}h`, since: new Date(since).toISOString(), environments: out };
}

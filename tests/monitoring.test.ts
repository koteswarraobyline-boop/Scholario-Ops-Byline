/**
 * Monitoring framework tests (in-process, throw-away PostgreSQL schema).
 * External APIs (Hostinger, Cloudflare) are replaced by recorded response shapes at the HTTP
 * layer; application checks run against real local HTTP/HTTPS test servers. Nothing here
 * talks to real infrastructure.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
process.env.DB_SCHEMA = `ops_montest_${process.pid}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-montest-'));
process.env.HOSTINGER_API_TOKEN = 'montest-fake-hostinger-token';
process.env.HOSTINGER_TIMEOUT_MS = '800';
process.env.CLOUDFLARE_API_TOKEN = 'montest-fake-cloudflare-token';
process.env.ALERT_COOLDOWN_MIN = '10';
process.env.TELEMETRY_STALE_THRESHOLD_SEC = '10';
process.env.BACKUP_MAX_AGE_HOURS = '24';
process.env.REPLICATION_MAX_LAG_SEC = '60';

// ── HTTP-layer mocks for the external providers ──────────────────────────────
type Mode = 'ok' | 'auth' | 'timeout' | 'ratelimit-then-ok' | 'down';
let hostingerMode: Mode = 'ok';
let cloudflareMode: Mode = 'ok';
let hostingerCalls = 0;
const realFetch = globalThis.fetch;
const PRD_IP = '198.51.100.10', DR_IP = '198.51.100.20';
const ACC = '0123456789abcdef0123456789abcdef', PRD_POOL = 'a'.repeat(32), DR_POOL = 'b'.repeat(32);
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = String(input);
  if (u.startsWith('https://developers.hostinger.com/')) {
    hostingerCalls++;
    if (hostingerMode === 'auth') return new Response('{"message":"Unauthenticated."}', { status: 401 });
    if (hostingerMode === 'timeout') return new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    if (hostingerMode === 'ratelimit-then-ok' && hostingerCalls === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '1' } });
    if (u.endsWith('/data-centers')) return Response.json([{ id: 17, name: 'in-mum', city: 'Mumbai', location: 'in', continent: 'Asia' }]);
    return Response.json([
      { id: 1001, hostname: 'srv-prd.example', state: 'running', cpus: 8, memory: 32768, disk: 409600, plan: 'KVM 8', ipv4: [{ id: 1, address: PRD_IP }], template: { name: 'Ubuntu 24.04' }, data_center_id: 17 },
      { id: 1002, hostname: 'srv-dr.example', state: 'stopped', cpus: 2, memory: 8192, disk: 102400, plan: 'KVM 2', ipv4: [{ id: 2, address: DR_IP }], template: { name: 'Ubuntu 24.04' }, data_center_id: 99 },
    ]);
  }
  if (u.startsWith('https://api.cloudflare.com/')) {
    if (cloudflareMode === 'down') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const env = (result: unknown) => Response.json({ success: true, errors: [], result });
    if (u.includes('/health')) {
      const id = u.includes(PRD_POOL) ? PRD_POOL : DR_POOL, ip = id === PRD_POOL ? PRD_IP : DR_IP;
      return env({ pool_id: id, pop_health: { SAS: { healthy: true, origins: [{ [ip]: { healthy: true, rtt: '20ms', failure_reason: 'No failures', response_code: 200 } }] } } });
    }
    if (u.includes('/load_balancers/pools')) return env([
      { id: PRD_POOL, name: 'app-production', enabled: true, healthy: true, origins: [{ name: 'p', address: PRD_IP, enabled: true, weight: 1, healthy: true }] },
      { id: DR_POOL, name: 'app-dr', enabled: true, healthy: true, origins: [{ name: 'd', address: DR_IP, enabled: true, weight: 1, healthy: true }] },
    ]);
    return Response.json({ success: false, errors: [{ code: 7003, message: 'not found' }], result: null }, { status: 404 });
  }
  return realFetch(input, init);
}) as typeof fetch;

const { initStore, db, persist, flush } = await import('../server/store.ts');
const { query, closePool, SCHEMA } = await import('../server/db.ts');
const { syncHostinger, hostingerState, vmStatus } = await import('../server/hostinger.ts');
const { syncLoadBalancers } = await import('../server/loadbalancer.ts');
const { ingestAgentReport, recomputeDerived, runMonitorNow } = await import('../server/engine.ts');
const { databaseHealth, backupStatus, agentState, appHealth } = await import('../server/health.ts');
const { readiness } = await import('../server/readiness.ts');
const { openAlert, resolveAlert, evaluateAlerts, notificationStatus } = await import('../server/alerts.ts');
const { httpProbe, sslProbe } = await import('../server/probes.ts');
type ServerRecord = import('../server/store.ts').ServerRecord;
type Monitor = import('../src/types/index.ts').Monitor;

let local: http.Server; let localUrl = '';
let webhookHits: Array<{ status: string; title: string }> = [];
let hook: http.Server; let hookUrl = '';

function mkServer(env: 'PRD' | 'DR', ip: string): ServerRecord {
  return {
    id: crypto.randomUUID(), hostname: `mon-${env.toLowerCase()}`, ip, applicationId: '', environment: env, provider: '', region: '', plan: '',
    cpuCores: 0, ramGb: 0, diskGb: 0, os: '', status: 'UNKNOWN', agentVersion: '', agentStatus: 'DISCONNECTED', uptimeDays: 0, lastSeen: '',
    telemetry: { cpuPercent: 0, ramPercent: 0, diskPercent: 0, loadAvg: [0, 0, 0], networkInKbps: 0, networkOutKbps: 0, observedAt: '', receivedAt: '' },
    processes: [], services: [], logs: [], agentToken: crypto.randomBytes(24).toString('hex'), createdAt: new Date().toISOString(),
  };
}
function mkMonitor(appId: string, env: 'PRD' | 'DR', type: Monitor['type'], target: string, managedBy?: Monitor['managedBy']): Monitor {
  return {
    id: crypto.randomUUID(), name: `${env} ${type}`, type, target, applicationId: appId, environment: env, intervalSec: 3600, timeoutSec: 3, retries: 1,
    warningThresholdMs: 2000, criticalThresholdMs: 10000, failureConfirmationThreshold: 1, recoveryConfirmationThreshold: 1, consecutiveFailures: 0, consecutiveRecoveries: 0,
    status: 'UNKNOWN', lastCheck: '', lastSuccess: '', responseTimeMs: 0, uptimePercent: 0, history: [], enabled: true, activeMaintenance: false, managedBy,
  };
}
const agentReport = (extra: Record<string, unknown> = {}) => ({ observedAt: new Date().toISOString(), cpuPercent: 10, ramPercent: 30, diskPercent: 40, load: [0.1, 0.1, 0.1], ...extra });

before(async () => {
  await initStore();
  local = http.createServer((req, res) => { res.statusCode = req.url === '/down' ? 500 : 200; res.end('ok'); });
  await new Promise<void>(r => local.listen(0, '127.0.0.1', () => r()));
  localUrl = `http://127.0.0.1:${(local.address() as { port: number }).port}`;
  hook = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { try { const j = JSON.parse(b); webhookHits.push({ status: j.status, title: j.title }); } catch { /* ignore */ } res.end('ok'); }); });
  await new Promise<void>(r => hook.listen(0, '127.0.0.1', () => r()));
  hookUrl = `http://127.0.0.1:${(hook.address() as { port: number }).port}/hook`;
});

after(async () => {
  local?.close(); hook?.close();
  await query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  await closePool();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100).unref();
});

// ── Hostinger ────────────────────────────────────────────────────────────────
test('Hostinger: success → normalised VM data attached to the matching server', async () => {
  const prd = mkServer('PRD', PRD_IP), dr = mkServer('DR', DR_IP);
  db.servers.push(prd, dr);
  hostingerMode = 'ok';
  await syncHostinger();
  assert.equal(hostingerState.status, 'OK');
  assert.deepEqual([prd.hostinger?.plan, prd.hostinger?.cpus, prd.hostinger?.ramGb, prd.hostinger?.diskGb, prd.hostinger?.os, prd.hostinger?.region], ['KVM 8', 8, 32, 400, 'Ubuntu 24.04', 'Mumbai, in']);
  assert.equal(prd.hostinger?.status, 'HEALTHY');
  assert.equal(dr.hostinger?.status, 'UNAVAILABLE', 'stopped VM is UNAVAILABLE');
  assert.equal(dr.hostinger?.region, null, 'unknown data center → no invented region');
  assert.equal(prd.planSpec?.source, 'hostinger');
  assert.equal(vmStatus('restarting'), 'DEGRADED');
  assert.equal(vmStatus('something-new'), 'UNKNOWN');
});

test('Hostinger: authentication failure is reported, never thrown into monitoring as healthy', async () => {
  hostingerMode = 'auth';
  await assert.rejects(syncHostinger(), /rejected the token/);
  assert.equal(hostingerState.status, 'AUTH_FAILED');
  assert.ok(!(hostingerState.lastError ?? '').includes('montest-fake-hostinger-token'), 'token never in error text');
});

test('Hostinger: timeout → ERROR after one retry; 429 is retried', async () => {
  hostingerMode = 'timeout';
  const t0 = Date.now();
  await assert.rejects(syncHostinger(), /timeout/);
  assert.equal(hostingerState.status, 'ERROR');
  assert.ok(Date.now() - t0 < 5000);
  hostingerMode = 'ratelimit-then-ok'; hostingerCalls = 0;
  await syncHostinger();
  assert.equal(hostingerState.status, 'OK');
  assert.ok(hostingerCalls >= 2);
});

// ── Cloudflare ───────────────────────────────────────────────────────────────
test('Cloudflare unavailable → ERROR with no pool health (never healthy)', async () => {
  const app = { id: crypto.randomUUID(), name: 'CF App', codeName: 'cf-app', description: '', tier: 'TIER_1', status: 'UNKNOWN', uptime24h: null, uptime7d: null, uptime30d: null, rtoTargetMin: 30, rpoTargetMin: 15, currentReplicationLagSec: null, prdServerId: db.servers[0].id, drServerId: db.servers[1].id, failoverState: 'PRIMARY_ACTIVE', p50Ms: null, p95Ms: null, p99Ms: null, errorRatePercent: null, lastChecked: '', cloudflareZone: 'example.com', autoFailover: false, dependencies: [], loadBalancer: { accountId: ACC, hostname: 'app.example.com', prdPoolId: PRD_POOL, drPoolId: DR_POOL } } as import('../src/types/index.ts').Application;
  db.applications.push(app);
  cloudflareMode = 'down';
  const s = await syncLoadBalancers();
  assert.equal(s.status, 'ERROR');
  assert.ok(s.pools.every(p => p.healthy === null && p.origins.length === 0));
  cloudflareMode = 'ok';
  const ok = await syncLoadBalancers();
  assert.equal(ok.status, 'OK');
  assert.ok(ok.pools.every(p => p.healthy === true));
});

// ── Application health ───────────────────────────────────────────────────────
test('application: healthy and down are detected by real checks; UNKNOWN until checked', async () => {
  const app = db.applications[0];
  const up = mkMonitor(app.id, 'PRD', 'HTTP', `${localUrl}/ok`, 'app-url');
  db.monitors.push(up);
  assert.equal(appHealth(app, 'PRD').status, 'UNKNOWN');
  await runMonitorNow(up);
  assert.equal(appHealth(app, 'PRD').status, 'HEALTHY');
  up.target = `${localUrl}/down`;
  await runMonitorNow(up);
  assert.equal(up.lastProbeStatus, 'DOWN');
  assert.equal(appHealth(app, 'PRD').status, 'DOWN');
  up.target = `${localUrl}/ok`;
  await runMonitorNow(up);
});

test('SSL: untrusted (self-signed) certificate and hostname mismatch are failures', async (t) => {
  let openssl = 'openssl';
  try { execFileSync(openssl, ['version'], { stdio: 'ignore' }); } catch {
    const gitOpenssl = 'C:/Program Files/Git/usr/bin/openssl.exe';
    if (fs.existsSync(gitOpenssl)) openssl = gitOpenssl; else { t.skip('openssl not available to create a test certificate'); return; }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-tls-'));
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=other.example'], { stdio: 'ignore' });
  const srv = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (_q, r) => r.end('tls'));
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as { port: number }).port;
  try {
    const h = await httpProbe(`https://127.0.0.1:${port}/`, { timeoutMs: 3000 });
    assert.equal(h.probeStatus, 'TLS_ERROR');
    const s = await sslProbe(`localhost:${port}`, 3000);
    assert.equal(s.ok, false);
    assert.match(s.detail, /NOT trusted/);
    assert.equal(s.daysLeft !== null && s.daysLeft <= 2, true, 'expiry is read from the certificate');
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('probe classification: DNS failure and timeout are not "down/up" guesses', async () => {
  const dnsFail = await httpProbe('https://does-not-exist.invalid/', { timeoutMs: 3000 });
  assert.equal(dnsFail.probeStatus, 'DNS_ERROR');
  const slow = http.createServer(() => { /* never answers */ });
  await new Promise<void>(r => slow.listen(0, '127.0.0.1', () => r()));
  const t = await httpProbe(`http://127.0.0.1:${(slow.address() as { port: number }).port}/`, { timeoutMs: 500 });
  slow.closeAllConnections(); slow.close();
  assert.equal(t.probeStatus, 'TIMEOUT');
});

// ── Database + backups + agent ───────────────────────────────────────────────
test('database: NOT_CONFIGURED → UNKNOWN → HEALTHY → DOWN / replication unhealthy / stale', async () => {
  const app = db.applications[0];
  const prd = db.servers.find(s => s.id === app.prdServerId)!;
  const dr = db.servers.find(s => s.id === app.drServerId)!;
  assert.equal(databaseHealth(app, 'PRD').status, 'NOT_CONFIGURED');
  app.environments = {
    PRD: { appPort: null, healthPath: null, webServer: null, processManager: null, routing: null, dbEngine: 'mysql', dbName: 'app', dbPort: null, replicationMaxLagSec: null, backupMaxAgeHours: null, notes: '' },
    DR: { appPort: null, healthPath: null, webServer: null, processManager: null, routing: null, dbEngine: 'mysql', dbName: 'app', dbPort: null, replicationMaxLagSec: null, backupMaxAgeHours: null, notes: '' },
  };
  assert.equal(databaseHealth(app, 'PRD').status, 'UNKNOWN', 'no agent yet');
  const dbOk = { engine: 'mysql', name: 'app', available: true, latencyMs: 3, version: '8.0.36', sizeBytes: 1e9, connections: 10, maxConnections: 151, longRunningQueries: 0, replication: null, error: null };
  ingestAgentReport(prd, agentReport({ databases: [dbOk] }));
  assert.equal(databaseHealth(app, 'PRD').status, 'HEALTHY');
  ingestAgentReport(prd, agentReport({ databases: [{ ...dbOk, available: false, latencyMs: null, error: 'timeout after 10s' }] }));
  assert.equal(databaseHealth(app, 'PRD').status, 'DOWN');
  ingestAgentReport(dr, agentReport({ databases: [{ ...dbOk, replication: { role: 'replica', state: 'error', lagSec: null, lastSuccessAt: null, error: 'error connecting to source' } }] }));
  assert.equal(databaseHealth(app, 'DR').status, 'DEGRADED');
  ingestAgentReport(dr, agentReport({ databases: [{ ...dbOk, replication: { role: 'replica', state: 'running', lagSec: 600, lastSuccessAt: null, error: null } }] }));
  assert.match(databaseHealth(app, 'DR').detail, /lag 600s > 60s/);
  ingestAgentReport(dr, agentReport({ databases: [{ ...dbOk, engine: 'oracle' }] }));
  assert.equal(databaseHealth(app, 'DR').status, 'UNKNOWN', 'malformed / unsupported report is discarded, not trusted');
  // stale probe
  ingestAgentReport(prd, agentReport({ databases: [dbOk] }));
  prd.databases![0].observedAt = new Date(Date.now() - 3600_000).toISOString();
  assert.equal(databaseHealth(app, 'PRD').status, 'UNKNOWN');
});

test('backup: UNKNOWN without reports, HEALTHY when recent, STALE past the threshold, FAILED on failure', () => {
  const app = db.applications[0];
  assert.equal(backupStatus(app).status, 'UNKNOWN');
  const rec = (status: 'SUCCESS' | 'FAILED', hoursAgo: number) => ({ id: crypto.randomUUID(), applicationId: app.id, serverId: '', type: 'MYSQL_DUMP' as const, sizeGb: 1, destination: 's3://b', retentionDays: 7, encrypted: true, integrityVerified: false, integrityHash: '', restoreTestedAt: '', restoreDurationMin: 0, restoreStatus: 'PENDING' as const, status, completedAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString() });
  db.backups.unshift(rec('SUCCESS', 30));
  assert.equal(backupStatus(app).status, 'STALE');
  db.backups.unshift(rec('SUCCESS', 1));
  assert.equal(backupStatus(app).status, 'HEALTHY');
  db.backups.unshift(rec('FAILED', 0.1));
  assert.equal(backupStatus(app).status, 'FAILED');
  db.backups.splice(0, 1);
});

test('agent heartbeat: ONLINE → STALE → OFFLINE, and an offline agent raises an alert', () => {
  const srv = db.servers[0];
  ingestAgentReport(srv, agentReport({ agentStartedAt: '2026-01-01T00:00:00Z' }));
  ingestAgentReport(srv, agentReport({ agentStartedAt: '2026-01-02T00:00:00Z', errors: ['services: systemctl not found'] }));
  assert.equal(srv.agentRestartCount, 1);
  assert.deepEqual(srv.agentErrors, ['services: systemctl not found']);
  assert.equal(agentState(srv), 'ONLINE');
  srv.lastSeen = new Date(Date.now() - 30_000).toISOString(); recomputeDerived();
  assert.equal(agentState(srv), 'STALE');
  srv.lastSeen = new Date(Date.now() - 200_000).toISOString(); recomputeDerived();
  assert.equal(agentState(srv), 'OFFLINE');
  evaluateAlerts();
  assert.ok(db.incidents.some(i => i.fingerprint === `agent-offline:${srv.id}` && i.status === 'OPEN'));
  assert.equal(agentState(db.servers.find(s => !s.lastSeen) ?? { ...srv, lastSeen: '' } as ServerRecord), 'NOT_CONNECTED');
});

// ── DR readiness ─────────────────────────────────────────────────────────────
test('DR readiness: UNKNOWN without evidence; never counts UNKNOWN / NOT_CONFIGURED as PASS', () => {
  const app = { ...db.applications[0], id: crypto.randomUUID(), codeName: 'empty', loadBalancer: undefined, environments: undefined, prdServerId: '', drServerId: '' } as import('../src/types/index.ts').Application;
  db.applications.push(app);
  db.monitors.push(mkMonitor(app.id, 'DR', 'HTTPS', 'https://dr.example.invalid/', 'app-url'));
  const r = readiness(app);
  assert.equal(r.total, 13);
  assert.equal(r.passed, 0);
  assert.equal(r.overall, 'UNKNOWN');
  assert.ok(r.checks.filter(c => c.group === 'core').every(c => c.status === 'UNKNOWN' || c.status === 'NOT_CONFIGURED'));
  db.applications.pop();
});

test('DR readiness: READY (13/13) only when every check has passing evidence', async () => {
  const app = db.applications[0];
  const prd = db.servers.find(s => s.id === app.prdServerId)!, dr = db.servers.find(s => s.id === app.drServerId)!;
  app.prdUrl = 'https://app.example.com/'; app.drUrl = 'https://dr.example.com/';
  db.monitors = db.monitors.filter(m => m.applicationId !== app.id);
  const now = new Date().toISOString();
  const pass = (m: Monitor, code: number | null) => Object.assign(m, { status: 'HEALTHY', lastCheck: now, lastProbeStatus: 'UP', lastStatusCode: code, history: [{ timestamp: now, status: 'HEALTHY', responseTimeMs: 120, statusCode: code ?? undefined, detail: 'ok' }] });
  db.monitors.push(pass(mkMonitor(app.id, 'PRD', 'HTTPS', app.prdUrl, 'app-url'), 200), pass(mkMonitor(app.id, 'DR', 'HTTPS', app.drUrl, 'app-url'), 200), pass(mkMonitor(app.id, 'DR', 'SSL', 'dr.example.com', 'app-ssl'), null));
  const dbOk = { engine: 'mysql', name: 'app', available: true, latencyMs: 3, version: '8.0.36', sizeBytes: 1e9, connections: 10, maxConnections: 151, longRunningQueries: 0, replication: null, error: null };
  ingestAgentReport(prd, agentReport({ databases: [{ ...dbOk, replication: { role: 'primary', state: 'running', lagSec: null, lastSuccessAt: null, error: null } }] }));
  ingestAgentReport(dr, agentReport({ databases: [{ ...dbOk, replication: { role: 'replica', state: 'running', lagSec: 5, lastSuccessAt: now, error: null } }] }));
  db.backups.unshift({ id: crypto.randomUUID(), applicationId: app.id, serverId: prd.id, type: 'MYSQL_DUMP', sizeGb: 1, destination: 's3://b', retentionDays: 7, encrypted: true, integrityVerified: true, integrityHash: 'x', restoreTestedAt: '', restoreDurationMin: 0, restoreStatus: 'PENDING', status: 'SUCCESS', completedAt: now });
  await syncLoadBalancers();
  const r = readiness(app);
  const core = r.checks.filter(c => c.group === 'core');
  assert.deepEqual(core.filter(c => c.status !== 'PASS').map(c => `${c.key}:${c.status}:${c.detail}`), []);
  assert.equal(r.passed, 13);
  assert.equal(r.overall, 'READY');
  // one failing piece of evidence → NOT_READY
  ingestAgentReport(dr, agentReport({ databases: [{ ...dbOk, replication: { role: 'replica', state: 'stopped', lagSec: null, lastSuccessAt: null, error: 'stopped by admin' } }] }));
  assert.equal(readiness(app).overall, 'NOT_READY');
});

// ── Notifications ────────────────────────────────────────────────────────────
test('notifications: NOT_CONFIGURED without channels; deduplicated, recovery sent, cooldown stops storms', async () => {
  assert.equal(notificationStatus().status, 'NOT_CONFIGURED');
  db.channels.push({ id: crypto.randomUUID(), name: 'test hook', type: 'WEBHOOK', enabled: true, targetEndpoint: hookUrl, lastDeliveryAt: '', lastDeliveryStatus: 'PENDING', failureCount: 0 });
  persist(); await flush();
  assert.equal(notificationStatus().status, 'CONFIGURED');
  webhookHits = [];
  const a = { fingerprint: 'test:dedup', title: 'Test alert', severity: 'HIGH' as const, detail: 'boom', source: 'Test' };
  const first = openAlert(a); const second = openAlert(a);
  assert.equal(first.created, true); assert.equal(second.created, false);
  assert.equal(first.incident.id, second.incident.id, 'one incident per problem');
  resolveAlert('test:dedup', 'Test', 'recovered');
  openAlert(a); resolveAlert('test:dedup', 'Test', 'recovered again'); // flapping within the cooldown
  await new Promise(r => setTimeout(r, 800));
  assert.deepEqual(webhookHits.map(h => h.status), ['FIRING', 'RESOLVED'], 'one FIRING + one RESOLVED despite flapping');
});

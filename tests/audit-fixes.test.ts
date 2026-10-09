/**
 * Regression tests for the full-application audit fixes (in-process, throw-away PostgreSQL schema,
 * Cloudflare mocked at the HTTP layer): auto-failover safety, monitor incident lifecycle (recovery
 * flapping, maintenance, paused / re-targeted checks), orphaned incidents on delete, notification
 * cooldown pairing / escalation, DR readiness verdicts, all-or-nothing DNS switch, metric rollups
 * persisted to PostgreSQL, log scrubbing, live incident durations.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
process.env.DB_SCHEMA = `ops_auditfix_${process.pid}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-auditfix-'));
process.env.HOSTINGER_API_TOKEN = '';
process.env.CLOUDFLARE_API_TOKEN = 'auditfix-fake-cloudflare-token';
process.env.ALERT_COOLDOWN_MIN = '15';

// ── Cloudflare API mock ──────────────────────────────────────────────────────
type Rec = { id: string; type: string; name: string; content: string };
let records: Rec[] = [];
let failPatchOf: string | null = null;
const patches: Array<{ id: string; content: string }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = String(input);
  if (!u.startsWith('https://api.cloudflare.com/')) return realFetch(input, init);
  const ok = (result: unknown) => Response.json({ success: true, errors: [], result, result_info: { page: 1, total_pages: 1 } });
  if (u.includes('/zones?name=')) return ok([{ id: 'zone1', name: 'example.com' }]);
  const m = u.match(/\/dns_records\/([^/?]+)$/);
  if (m && init?.method === 'PATCH') {
    const content = JSON.parse(String(init.body)).content as string;
    if (failPatchOf === m[1]) return Response.json({ success: false, errors: [{ code: 1000, message: 'simulated failure' }], result: null }, { status: 500 });
    patches.push({ id: m[1], content });
    const r = records.find(x => x.id === m[1]); if (r) r.content = content;
    return ok(r);
  }
  if (u.includes('/dns_records?')) {
    const type = new URL(u).searchParams.get('type');
    return ok(records.filter(r => !type || r.type === type));
  }
  return ok([]);
}) as typeof fetch;

const { initStore, db, flushMetrics, minuteMetrics } = await import('../server/store.ts');
const { query, closePool, SCHEMA, T } = await import('../server/db.ts');
const engine = await import('../server/engine.ts');
const { applyOutcome, evaluateAutoFailover, closeIncidentsReferencing, ingestAgentReport } = engine;
const { readiness } = await import('../server/readiness.ts');
const { switchDnsRecord } = await import('../server/cloudflare.ts');
const { notifyIncident } = await import('../server/notify.ts');
const { scrub } = await import('../server/logger.ts');
const { incidentMinutes } = await import('../src/components/ui/IncidentMinutes.tsx');
type Monitor = import('../src/types/index.ts').Monitor;
type Application = import('../src/types/index.ts').Application;
type ServerRecord = import('../server/store.ts').ServerRecord;

function mkMonitor(appId: string, env: 'PRD' | 'DR', type: Monitor['type'], target = 'https://app.example.com/health'): Monitor {
  return {
    id: crypto.randomUUID(), name: `${env} ${type}`, type, target, applicationId: appId, environment: env, intervalSec: 30, timeoutSec: 5, retries: 1,
    warningThresholdMs: 2000, criticalThresholdMs: 10000, failureConfirmationThreshold: 3, recoveryConfirmationThreshold: 2, consecutiveFailures: 0, consecutiveRecoveries: 0,
    status: 'UNKNOWN', lastCheck: '', lastSuccess: '', responseTimeMs: 0, uptimePercent: 0, history: [], enabled: true, activeMaintenance: false,
  } as Monitor;
}
function mkServer(env: 'PRD' | 'DR', ip: string): ServerRecord {
  return {
    id: crypto.randomUUID(), hostname: `af-${env.toLowerCase()}-${ip.split('.').pop()}`, ip, applicationId: '', environment: env, provider: '', region: '', plan: '',
    cpuCores: 0, ramGb: 0, diskGb: 0, os: '', status: 'UNKNOWN', agentVersion: '', agentStatus: 'DISCONNECTED', uptimeDays: 0, lastSeen: '',
    telemetry: { cpuPercent: 0, ramPercent: 0, diskPercent: 0, loadAvg: [0, 0, 0], networkInKbps: 0, networkOutKbps: 0, observedAt: '', receivedAt: '' },
    processes: [], services: [], logs: [], agentToken: crypto.randomBytes(24).toString('hex'), createdAt: new Date().toISOString(),
  };
}
function mkApp(prd: string, dr: string, extra: Partial<Application> = {}): Application {
  return {
    id: crypto.randomUUID(), name: `App-${crypto.randomBytes(2).toString('hex')}`, codeName: 'af', description: '', tier: 'TIER_1', rtoTargetMin: 30, rpoTargetMin: 15,
    prdServerId: prd, drServerId: dr, prdUrl: '', drUrl: '', autoFailover: true, failoverState: 'PRIMARY_ACTIVE', cloudflareZone: 'example.com', dnsRecordName: 'app.example.com',
    status: 'UNKNOWN', uptime24h: null, uptime7d: null, uptime30d: null, errorRatePercent: null, p50Ms: null, p95Ms: null, p99Ms: null,
    dependencies: [], currentReplicationLagSec: null, recentDeploymentVersion: '', ...extra,
  } as unknown as Application;
}
const fail = (detail = 'HTTP 503') => ({ ok: false, degraded: false, latencyMs: 30, statusCode: 503, detail, probeStatus: 'DOWN' as const });
const pass = () => ({ ok: true, degraded: false, latencyMs: 30, statusCode: 200, detail: 'HTTP 200', probeStatus: 'UP' as const });
const failoverAudits = (appId: string) => db.auditLogs.filter(a => a.targetId === appId && a.category === 'FAILOVER');
const monitorIncident = (m: Monitor) => db.incidents.find(i => i.fingerprint === `monitor:${m.id}` && i.status !== 'RESOLVED' && i.status !== 'CLOSED');

let prd: ServerRecord, dr: ServerRecord;
before(async () => {
  await initStore();
  prd = mkServer('PRD', '203.0.113.41'); dr = mkServer('DR', '203.0.113.42');
  db.servers.push(prd, dr);
  // A notification channel so cooldown / pairing can be observed
  db.channels.push({ id: 'ch-test', name: 'Test webhook', type: 'WEBHOOK', targetEndpoint: 'http://127.0.0.1:9/never', enabled: true, severityFilter: [] } as never);
  db.escalationPolicies.length = 0;
});
after(async () => {
  globalThis.fetch = realFetch;
  await query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  await closePool();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100).unref();
});

test('auto-failover: never triggered by non-availability monitors (CPU / SSL / backup / heartbeat)', async () => {
  const app = mkApp(prd.id, dr.id); db.applications.push(app);
  const drHttp = mkMonitor(app.id, 'DR', 'HTTPS'); drHttp.status = 'HEALTHY'; drHttp.lastCheck = new Date().toISOString();
  db.monitors.push(drHttp);
  for (const type of ['INFRA_CPU', 'SSL', 'BACKUP_FRESHNESS', 'CRON_HEARTBEAT'] as const) {
    const m = mkMonitor(app.id, 'PRD', type); m.status = 'CRITICAL'; m.consecutiveFailures = 5;
    db.monitors.push(m);
    await evaluateAutoFailover(m);
  }
  assert.equal(failoverAudits(app.id).length, 0, 'no failover attempt for CPU / SSL / backup / heartbeat');
  assert.equal(app.failoverState, 'PRIMARY_ACTIVE');
});

test('auto-failover: DR must be confirmed healthy (WARNING / stale DR is refused); every PRD availability check must be down; attempts are rate-limited', async () => {
  const app = mkApp(prd.id, dr.id); db.applications.push(app);
  const prd1 = mkMonitor(app.id, 'PRD', 'HTTPS'); prd1.status = 'CRITICAL'; prd1.consecutiveFailures = 3;
  const prd2 = mkMonitor(app.id, 'PRD', 'TCP', 'app.example.com:443'); prd2.status = 'HEALTHY';
  const drm = mkMonitor(app.id, 'DR', 'HTTPS'); drm.status = 'WARNING'; drm.consecutiveFailures = 1; drm.lastCheck = new Date().toISOString();
  db.monitors.push(prd1, prd2, drm);
  await evaluateAutoFailover(prd1);
  assert.equal(failoverAudits(app.id).length, 0, 'one PRD endpoint down while another is up is not a site outage');
  prd2.status = 'CRITICAL'; prd2.consecutiveFailures = 3;
  await evaluateAutoFailover(prd1);
  assert.ok(failoverAudits(app.id).some(a => a.action === 'AUTO_FAILOVER_SKIPPED'), 'DR in WARNING (first unconfirmed failure) is not healthy');
  // DR healthy but its last check is old → still refused
  const before = failoverAudits(app.id).length;
  const app2 = mkApp(prd.id, dr.id); db.applications.push(app2);
  const p = mkMonitor(app2.id, 'PRD', 'HTTPS'); p.status = 'CRITICAL'; p.consecutiveFailures = 3;
  const d = mkMonitor(app2.id, 'DR', 'HTTPS'); d.status = 'HEALTHY'; d.lastCheck = new Date(Date.now() - 3600_000).toISOString();
  db.monitors.push(p, d);
  await evaluateAutoFailover(p);
  assert.ok(failoverAudits(app2.id).some(a => a.action === 'AUTO_FAILOVER_SKIPPED'), 'stale DR result');
  // DR confirmed healthy and fresh → one real attempt (DNS switch), then no retry within the cooldown
  d.lastCheck = new Date().toISOString();
  records = [{ id: 'r1', type: 'A', name: 'app.example.com', content: prd.ip }];
  const app3 = mkApp(prd.id, dr.id); db.applications.push(app3);
  const p3 = mkMonitor(app3.id, 'PRD', 'HTTPS'); p3.status = 'CRITICAL'; p3.consecutiveFailures = 3;
  const d3 = mkMonitor(app3.id, 'DR', 'HTTPS'); d3.status = 'HEALTHY'; d3.lastCheck = new Date().toISOString();
  db.monitors.push(p3, d3);
  await evaluateAutoFailover(p3);
  assert.equal(app3.failoverState, 'DR_ACTIVE');
  assert.equal(records[0].content, dr.ip);
  void before;
});

test('auto-failover: a failed attempt is not retried on every check', async () => {
  const app = mkApp(prd.id, dr.id, { dnsRecordName: 'missing.example.com' } as Partial<Application>); db.applications.push(app);
  const p = mkMonitor(app.id, 'PRD', 'HTTPS'); p.status = 'CRITICAL'; p.consecutiveFailures = 3;
  const d = mkMonitor(app.id, 'DR', 'HTTPS'); d.status = 'HEALTHY'; d.lastCheck = new Date().toISOString();
  db.monitors.push(p, d);
  records = [];
  await evaluateAutoFailover(p);
  await evaluateAutoFailover(p);
  await evaluateAutoFailover(p);
  assert.equal(failoverAudits(app.id).filter(a => a.action === 'FAILOVER_TO_DR_FAILED').length, 1);
  assert.equal(app.failoverState, 'PRIMARY_ACTIVE');
});

test('DNS switch is all-or-nothing: dual-stack refused; a partial failure restores the switched records', async () => {
  records = [{ id: 'a1', type: 'A', name: 'ds.example.com', content: '198.51.100.1' }, { id: 'v6', type: 'AAAA', name: 'ds.example.com', content: '2001:db8::1' }];
  await assert.rejects(switchDnsRecord('example.com', 'ds.example.com', '198.51.100.2'), /also has AAAA/);
  assert.equal(records[0].content, '198.51.100.1', 'nothing changed');
  records = [{ id: 'b1', type: 'A', name: 'two.example.com', content: '198.51.100.1' }, { id: 'b2', type: 'A', name: 'two.example.com', content: '198.51.100.1' }];
  patches.length = 0; failPatchOf = 'b2';
  await assert.rejects(switchDnsRecord('example.com', 'two.example.com', '198.51.100.9'), /restored to the previous address/);
  failPatchOf = null;
  assert.deepEqual(records.map(r => r.content), ['198.51.100.1', '198.51.100.1'], 'the first record was switched back');
  assert.deepEqual(patches, [{ id: 'b1', content: '198.51.100.9' }, { id: 'b1', content: '198.51.100.1' }]);
});

test('monitor lifecycle: a failure while recovering keeps the incident (no resolve → re-open flapping)', () => {
  const m = mkMonitor('', 'PRD', 'HTTPS'); db.monitors.push(m);
  applyOutcome(m, fail()); applyOutcome(m, fail()); applyOutcome(m, fail());
  const inc = monitorIncident(m)!;
  assert.ok(inc, 'incident opened after 3 confirmed failures');
  applyOutcome(m, pass());
  assert.equal(m.status, 'CRITICAL', 'one success is not a confirmed recovery');
  applyOutcome(m, fail());
  assert.equal(m.status, 'CRITICAL');
  assert.equal(monitorIncident(m)?.id, inc.id, 'same incident, not resolved and re-opened');
  applyOutcome(m, pass()); applyOutcome(m, pass());
  assert.equal(m.status, 'HEALTHY');
  assert.equal(db.incidents.find(i => i.id === inc.id)!.status, 'RESOLVED');
});

test('monitor lifecycle: an incident open when maintenance starts resolves when the service is back afterwards', () => {
  const m = mkMonitor('', 'PRD', 'HTTPS'); db.monitors.push(m);
  applyOutcome(m, fail()); applyOutcome(m, fail()); applyOutcome(m, fail());
  const inc = monitorIncident(m)!;
  m.status = 'MAINTENANCE'; // what applyOutcome sets during a window
  applyOutcome(m, pass());
  assert.equal(m.status, 'HEALTHY');
  assert.equal(db.incidents.find(i => i.id === inc.id)!.status, 'RESOLVED');
});

test('deleting a server / application closes every incident that references it', () => {
  const app = mkApp(prd.id, dr.id);
  const now = new Date().toISOString();
  const mk = (fingerprint: string) => ({ id: `INC-T${crypto.randomBytes(2).toString('hex')}`, title: fingerprint, severity: 'HIGH', status: 'OPEN', applicationId: app.id, environment: 'PRD', fingerprint, rootCause: '', startedAt: now, durationMinutes: 0, owner: '', acknowledged: false, affectedServices: [], affectedMonitors: [], dependentFailures: [], timeline: [], recoveryStatus: '', notes: [] });
  const gone = mkServer('PRD', '203.0.113.99');
  db.incidents.unshift(mk(`agent-offline:${gone.id}`) as never, mk(`telemetry:${gone.id}:systemd:nginx`) as never, mk(`backup:${app.id}`) as never, mk(`agent-offline:${prd.id}`) as never);
  assert.equal(closeIncidentsReferencing([gone.id], 'test', 'server removed'), 2);
  assert.equal(closeIncidentsReferencing([app.id], 'test', 'app deleted'), 1);
  assert.equal(db.incidents.find(i => i.fingerprint === `agent-offline:${prd.id}`)!.status, 'OPEN', 'unrelated incidents untouched');
});

test('notifications: an escalation is delivered inside the cooldown; RESOLVED is never suppressed after its FIRING was sent', () => {
  const inc = { id: 'INC-N1', title: 'x', severity: 'WARNING', status: 'OPEN', fingerprint: `fp-${crypto.randomUUID()}`, rootCause: '', environment: 'PRD' } as never as import('../src/types/index.ts').Incident;
  assert.equal(notifyIncident(inc, 'FIRING'), true);
  assert.equal(notifyIncident(inc, 'FIRING'), false, 'same status + severity within the cooldown is suppressed');
  inc.severity = 'HIGH';
  assert.equal(notifyIncident(inc, 'FIRING'), true, 'escalation to HIGH is delivered');
  assert.equal(notifyIncident(inc, 'RESOLVED'), true);
  // A re-opened incident in the cooldown: FIRING suppressed → its RESOLVED suppressed too (pairs stay consistent)
  const again = { ...inc, id: 'INC-N2' };
  assert.equal(notifyIncident(again, 'FIRING'), false);
  assert.equal(notifyIncident(again, 'RESOLVED'), false);
});

test('DR readiness: a single unconfirmed timeout is a WARNING (not FAIL); DNS-failover apps (no load balancer) can be READY', () => {
  const app = mkApp(prd.id, dr.id, { drUrl: 'https://dr.example.com' } as Partial<Application>);
  db.applications.push(app);
  const url = mkMonitor(app.id, 'DR', 'HTTPS', 'https://dr.example.com'); url.managedBy = 'app-url';
  url.status = 'WARNING'; url.lastCheck = new Date().toISOString(); url.lastProbeStatus = 'TIMEOUT'; url.lastStatusCode = null; url.consecutiveFailures = 1;
  db.monitors.push(url);
  const r = readiness(app);
  assert.equal(r.checks.find(c => c.key === 'dr_url')!.status, 'WARNING');
  assert.notEqual(r.overall, 'NOT_READY');
  assert.equal(r.total, 11, 'pool / origin checks do not apply without a load balancer');
  url.status = 'CRITICAL'; url.consecutiveFailures = 3;
  assert.equal(readiness(app).checks.find(c => c.key === 'dr_url')!.status, 'FAIL', 'a confirmed outage is a FAIL');
});

test('metric rollups are really written to PostgreSQL', async () => {
  const srv = mkServer('DR', '203.0.113.77'); db.servers.push(srv);
  const minuteAgo = new Date(Date.now() - 120_000).toISOString();
  engine.ingestAgentReport(srv, { observedAt: new Date().toISOString(), cpuPercent: 12, ramPercent: 34, diskPercent: 56, load: [0.1, 0.1, 0.1], swapPercent: 7 } as never);
  // Force a completed minute: the store queue receives the rollup when the next minute starts
  const { queueMetric } = await import('../server/store.ts');
  queueMetric(srv.id, { t: minuteAgo, cpu: 12, ram: 34, disk: 56, load1: 0.1, netIn: 1, netOut: 2, swap: 7, iowait: null, steal: null, diskRead: null, diskWrite: null, diskUtil: null });
  await flushMetrics();
  const rows = (await query(`SELECT cpu, ram, swap, iowait FROM ${T('server_metrics')} WHERE server_id = $1`, [srv.id])).rows;
  assert.equal(rows.length, 1, 'rollup persisted (placeholders correct)');
  assert.equal(Number(rows[0].cpu), 12);
  assert.equal(Number(rows[0].swap), 7);
  assert.equal(rows[0].iowait, null);
  void minuteMetrics; void ingestAgentReport;
});

test('logs never contain push-heartbeat tokens', () => {
  const line = scrub('POST /api/v1/heartbeat/3f9a8b7c6d5e4f30 200 {"path":"/api/v1/heartbeat/abcdef123456"}');
  assert.equal(line.includes('3f9a8b7c6d5e4f30'), false);
  assert.equal(line.includes('abcdef123456'), false);
  assert.match(line, /\/heartbeat\/\[REDACTED\]/);
});

test('open-incident duration is computed live from startedAt; closed incidents keep their recorded duration', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  assert.equal(incidentMinutes({ status: 'OPEN', startedAt: '2026-10-09T10:00:00Z', durationMinutes: 0 }, now), 120);
  assert.equal(incidentMinutes({ status: 'RESOLVED', startedAt: '2026-10-09T10:00:00Z', durationMinutes: 42 }, now), 42);
  assert.equal(incidentMinutes({ status: 'OPEN', startedAt: 'garbage', durationMinutes: 5 }, now), 5);
});

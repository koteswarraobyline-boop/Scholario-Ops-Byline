/**
 * Dead-man heartbeat of the monitored infrastructure (server/heartbeat.ts + alerts): server, application,
 * service and database heartbeats derived from agent reports, across several servers and applications;
 * stale / disconnected servers; failure → incident (deduplicated, escalated, recovered); no external
 * watchdog request even when the deprecated DEADMAN_* variables are set; no secrets in the output.
 * In-process, throw-away PostgreSQL schema.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

// A would-be "external watchdog": it must never receive a request
let watchdogHits = 0;
const watchdog = http.createServer((_q, r) => { watchdogHits++; r.end('OK'); });
await new Promise<void>(r => watchdog.listen(0, '127.0.0.1', () => r()));
const WATCHDOG_URL = `http://127.0.0.1:${(watchdog.address() as { port: number }).port}/ping/old-secret-uuid?token=old-token`;

process.env.DB_SCHEMA = `ops_hbtest_${process.pid}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-hbtest-'));
process.env.HOSTINGER_API_TOKEN = '';
process.env.CLOUDFLARE_API_TOKEN = '';
process.env.TELEMETRY_STALE_THRESHOLD_SEC = '10';
process.env.DEADMAN_HEARTBEAT_URL = WATCHDOG_URL; // deprecated: must be ignored
process.env.DEADMAN_INTERVAL_SEC = '10';

const { initStore, db } = await import('../server/store.ts');
const { query, closePool, SCHEMA } = await import('../server/db.ts');
const { ingestAgentReport, recomputeDerived, startEngine, stopEngine } = await import('../server/engine.ts');
const { infraHeartbeat, serverHeartbeat } = await import('../server/heartbeat.ts');
const { evaluateAlerts } = await import('../server/alerts.ts');
const { config } = await import('../server/config.ts');
type ServerRecord = import('../server/store.ts').ServerRecord;
type Application = import('../src/types/index.ts').Application;

function mkServer(env: 'PRD' | 'DR', ip: string): ServerRecord {
  return {
    id: crypto.randomUUID(), hostname: `hb-${env.toLowerCase()}`, ip, applicationId: '', environment: env, provider: '', region: '', plan: '',
    cpuCores: 0, ramGb: 0, diskGb: 0, os: '', status: 'UNKNOWN', agentVersion: '', agentStatus: 'DISCONNECTED', uptimeDays: 0, lastSeen: '',
    telemetry: { cpuPercent: 0, ramPercent: 0, diskPercent: 0, loadAvg: [0, 0, 0], networkInKbps: 0, networkOutKbps: 0, observedAt: '', receivedAt: '' },
    processes: [], services: [], logs: [], agentToken: crypto.randomBytes(24).toString('hex'), createdAt: new Date().toISOString(),
  };
}
const inv = (port: number | null, dbEngine: 'mysql' | null = null) => ({ appPort: port, healthPath: '/health', webServer: null, processManager: null, routing: null, dbEngine, dbName: dbEngine ? 'app' : null, dbPort: null, replicationMaxLagSec: null, backupMaxAgeHours: null, notes: '' });
function mkApp(name: string, prd: string, dr: string, port: number, dbEngine: 'mysql' | null = null): Application {
  return {
    id: crypto.randomUUID(), name, codeName: name.toLowerCase(), description: '', tier: 'TIER_1', rtoTargetMin: 30, rpoTargetMin: 15,
    prdServerId: prd, drServerId: dr, prdUrl: '', drUrl: '', autoFailover: false, failoverState: 'PRD_ACTIVE',
    status: 'UNKNOWN', uptime24h: null, uptime7d: null, uptime30d: null, errorRatePercent: null, p50Ms: null, p95Ms: null, p99Ms: null,
    dependencies: [], currentReplicationLagSec: null, recentDeploymentVersion: '',
    environments: { PRD: inv(port, dbEngine), DR: inv(port, dbEngine) },
  } as unknown as Application;
}
const appCheck = (app: Application, port: number, status: 'HEALTHY' | 'DOWN', extra: Record<string, unknown> = {}) => ({
  applicationId: app.id, name: app.name, environment: 'PRD', port, path: '/health', listening: status === 'HEALTHY', status,
  statusCode: status === 'HEALTHY' ? 200 : null, latencyMs: status === 'HEALTHY' ? 4.5 : null, error: status === 'DOWN' ? 'nothing accepting connections' : null,
  checkedAt: new Date().toISOString(), ...extra,
});
const report = (extra: Record<string, unknown> = {}) => ({
  agentVersion: '3.3.0', observedAt: new Date().toISOString(), sentAt: new Date().toISOString(), lastReportRttMs: 30,
  cpuPercent: 10, ramPercent: 30, diskPercent: 40, load: [0.1, 0.1, 0.1], cpuCores: 2,
  services: [{ name: 'nginx', status: 'active', pid: 1, memoryMb: 20, since: '', restartCount: 0 }], ...extra,
});
const dbOk = { engine: 'mysql', name: 'app', available: true, latencyMs: 3, version: '8.0.36', sizeBytes: 1e9, connections: 10, maxConnections: 151, longRunningQueries: 0, replication: null, error: null };

let prd: ServerRecord, dr: ServerRecord, lms: Application, ops: Application;
const openInc = (fp: string) => db.incidents.filter(i => i.fingerprint === fp && i.status !== 'RESOLVED' && i.status !== 'CLOSED');

before(async () => {
  await initStore();
  prd = mkServer('PRD', '203.0.113.31');
  dr = mkServer('DR', '203.0.113.32');
  db.servers.push(prd, dr);
  lms = mkApp('LMS', prd.id, dr.id, 8080);
  ops = mkApp('Portal', prd.id, dr.id, 4100);
  db.applications.push(lms, ops);
});

after(async () => {
  stopEngine();
  watchdog.close();
  await query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  await closePool();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100).unref();
});

test('no servers reported yet: every server UNKNOWN, configured applications listed as not reported', () => {
  const hb = infraHeartbeat();
  assert.equal(hb.servers.length, 2);
  assert.deepEqual(hb.servers.map(s => s.environment), ['PRD', 'DR'], 'PRD first');
  assert.equal(hb.status, 'UNKNOWN', 'no data is never healthy');
  const p = hb.servers[0];
  assert.equal(p.server.state, 'UNKNOWN');
  assert.equal(p.applications.total, 2, 'both configured applications appear');
  assert.ok(p.applications.checks.every(c => c.state === 'UNKNOWN' && c.target?.startsWith('127.0.0.1:')));
});

test('healthy server heartbeat: freshness, delivery latency, real report interval; multiple servers', async () => {
  ingestAgentReport(prd, report({ appChecks: [appCheck(lms, 8080, 'HEALTHY'), appCheck(ops, 4100, 'HEALTHY')], databases: [dbOk] }));
  ingestAgentReport(dr, report({ appChecks: [appCheck(lms, 8080, 'HEALTHY'), appCheck(ops, 4100, 'HEALTHY')] }));
  await new Promise(r => setTimeout(r, 1100));
  ingestAgentReport(prd, report({ appChecks: [appCheck(lms, 8080, 'HEALTHY'), appCheck(ops, 4100, 'HEALTHY')], databases: [dbOk] }));
  recomputeDerived();
  const p = serverHeartbeat(prd);
  assert.equal(p.server.state, 'HEALTHY');
  assert.equal(p.server.latencyMs, 15, 'delivery latency = half the measured round trip');
  assert.ok(p.server.intervalSec! >= 1 && p.server.intervalSec! < 3, `interval ${p.server.intervalSec}`);
  assert.equal(p.server.toleranceSec, config.telemetryStaleSec);
  assert.equal(p.server.failures, 0);
  assert.equal(p.applications.state, 'HEALTHY');
  assert.equal(p.applications.healthy, 2);
  assert.equal(p.services.state, 'HEALTHY');
  assert.equal(p.databases.state, 'HEALTHY');
  assert.equal(p.state, 'HEALTHY');
  const hb = infraHeartbeat();
  assert.equal(hb.status, 'HEALTHY');
  assert.equal(hb.servers[1].state, 'HEALTHY', 'DR has no database probe: not counted against it');
  assert.equal(hb.servers[1].databases.total, 0);
});

test('application heartbeat: healthy → degraded (1st failure) → failing (repeated) → recovery; last success kept', () => {
  const firstOk = serverHeartbeat(prd).applications.checks.find(c => c.name === 'LMS')!.lastSuccessAt;
  assert.ok(firstOk);
  ingestAgentReport(prd, report({ appChecks: [appCheck(lms, 8080, 'DOWN'), appCheck(ops, 4100, 'HEALTHY')], databases: [dbOk] }));
  let c = serverHeartbeat(prd).applications.checks.find(x => x.name === 'LMS')!;
  assert.equal(c.state, 'DEGRADED');
  assert.equal(c.failures, 1);
  assert.equal(c.lastSuccessAt, firstOk, 'last success survives failures');
  assert.equal(c.httpStatus, null);
  ingestAgentReport(prd, report({ appChecks: [appCheck(lms, 8080, 'DOWN'), appCheck(ops, 4100, 'HEALTHY')], databases: [dbOk] }));
  c = serverHeartbeat(prd).applications.checks.find(x => x.name === 'LMS')!;
  assert.equal(c.state, 'FAILING');
  assert.equal(c.failures, 2);
  assert.equal(serverHeartbeat(prd).state, 'FAILING');
  evaluateAlerts(); evaluateAlerts();
  const fp = `telemetry:${prd.id}:app-health:${lms.id}:8080`;
  assert.equal(openInc(fp).length, 1, 'one incident for repeated failures');
  ingestAgentReport(prd, report({ appChecks: [appCheck(lms, 8080, 'HEALTHY'), appCheck(ops, 4100, 'HEALTHY')], databases: [dbOk] }));
  c = serverHeartbeat(prd).applications.checks.find(x => x.name === 'LMS')!;
  assert.equal(c.state, 'HEALTHY');
  assert.equal(c.failures, 0);
  assert.notEqual(c.lastSuccessAt, firstOk);
  evaluateAlerts();
  assert.equal(openInc(fp).length, 0, 'recovery resolves the incident');
  assert.equal(db.incidents.find(i => i.fingerprint === fp)!.status, 'RESOLVED');
});

test('service heartbeat: failed systemd service → FAILING + one incident; restart count; recovery', () => {
  ingestAgentReport(dr, report({ services: [{ name: 'nginx', status: 'failed', pid: 0, memoryMb: 0, since: '', restartCount: 7 }], appChecks: [appCheck(lms, 8080, 'HEALTHY'), appCheck(ops, 4100, 'HEALTHY')] }));
  const s = serverHeartbeat(dr).services.checks[0];
  assert.equal(s.state, 'FAILING');
  assert.equal(s.restartCount, 7);
  assert.ok(s.lastCheckAt);
  assert.equal(s.lastSuccessAt, null);
  evaluateAlerts(); evaluateAlerts();
  const fp = `telemetry:${dr.id}:systemd:nginx`;
  assert.equal(openInc(fp).length, 1);
  ingestAgentReport(dr, report({ appChecks: [appCheck(lms, 8080, 'HEALTHY'), appCheck(ops, 4100, 'HEALTHY')] }));
  assert.equal(serverHeartbeat(dr).services.state, 'HEALTHY');
  evaluateAlerts();
  assert.equal(openInc(fp).length, 0);
});

test('database heartbeat: failing probe counts failures, keeps last success; incident not duplicated with the app-level one', () => {
  ingestAgentReport(prd, report({ databases: [{ ...dbOk, available: false, latencyMs: null, error: 'connection refused' }] }));
  ingestAgentReport(prd, report({ databases: [{ ...dbOk, available: false, latencyMs: null, error: 'connection refused' }] }));
  const d = serverHeartbeat(prd).databases.checks[0];
  assert.equal(d.state, 'FAILING');
  assert.equal(d.failures, 2);
  assert.ok(d.lastSuccessAt, 'last success from the earlier healthy probes');
  evaluateAlerts(); evaluateAlerts();
  assert.equal(openInc(`telemetry:${prd.id}:db-down:mysql app`).length, 1, 'uncovered probe → its own incident');
  // Once an application declares this database, the per-application incident takes over (never both)
  lms.environments!.PRD!.dbEngine = 'mysql';
  evaluateAlerts();
  assert.equal(openInc(`telemetry:${prd.id}:db-down:mysql app`).length, 0);
  assert.equal(openInc(`db-down:${lms.id}:PRD`).length, 1);
  ingestAgentReport(prd, report({ databases: [dbOk] }));
  evaluateAlerts();
  assert.equal(openInc(`db-down:${lms.id}:PRD`).length, 0, 'recovered');
  assert.equal(serverHeartbeat(prd).databases.checks[0].failures, 0);
  lms.environments!.PRD!.dbEngine = null;
});

test('stale → disconnected server: one incident, escalated in place; components UNKNOWN while not live; recovery', () => {
  const fp = `agent-offline:${dr.id}`;
  dr.reportIntervalSec = 10; // the agent's real cadence (earlier tests report irregularly)
  dr.lastSeen = new Date(Date.now() - 30_000).toISOString(); recomputeDerived();
  let h = serverHeartbeat(dr);
  assert.equal(h.server.state, 'DEGRADED');
  assert.ok(h.server.failures! >= 1, 'missed reports counted');
  assert.equal(h.applications.state, 'UNKNOWN', 'last-known results are not live');
  evaluateAlerts(); evaluateAlerts();
  let inc = openInc(fp);
  assert.equal(inc.length, 1);
  assert.match(inc[0].title, /heartbeat stale/);
  assert.equal(inc[0].severity, 'WARNING');
  dr.lastSeen = new Date(Date.now() - 300_000).toISOString(); recomputeDerived();
  h = serverHeartbeat(dr);
  assert.equal(h.server.state, 'FAILING');
  assert.match(h.server.detail, /DISCONNECTED/);
  evaluateAlerts(); evaluateAlerts();
  inc = openInc(fp);
  assert.equal(inc.length, 1, 'escalated, not duplicated');
  assert.match(inc[0].title, /offline/);
  assert.ok(inc[0].timeline.some(e => /Escalated/.test(e.message)));
  assert.equal(infraHeartbeat().status, 'FAILING');
  ingestAgentReport(dr, report({ appChecks: [appCheck(lms, 8080, 'HEALTHY'), appCheck(ops, 4100, 'HEALTHY')] }));
  evaluateAlerts();
  assert.equal(openInc(fp).length, 0, 'reporting again resolves it');
  assert.equal(serverHeartbeat(dr).server.state, 'HEALTHY');
});

test('no external watchdog: deprecated variables are ignored, no outbound request, no URL anywhere', async () => {
  for (const k of ['DEADMAN_HEARTBEAT_URL', 'DEADMAN_INTERVAL_SEC']) assert.ok(config.deprecatedDeadManVars.includes(k), k);
  assert.equal('deadManHeartbeatUrl' in config, false);
  assert.equal(startEngine(), true);
  assert.equal(startEngine(), false, 'no duplicate workers');
  await new Promise(r => setTimeout(r, 1500));
  stopEngine();
  assert.equal(watchdogHits, 0, 'no request was sent to the configured URL');
  const json = JSON.stringify(infraHeartbeat());
  for (const s of ['old-secret-uuid', 'old-token', WATCHDOG_URL, prd.agentToken, dr.agentToken]) assert.equal(json.includes(s), false, `heartbeat exposes ${s.slice(0, 12)}…`);
});

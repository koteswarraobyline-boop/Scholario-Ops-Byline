/**
 * Agent 3.3 telemetry on the server (in-process, throw-away PostgreSQL schema): validation and
 * storage of the extended report, PM2 allow-listing, network / restart deltas, local health
 * failures, clock skew, agent version state, stale / disconnected agents, health summary,
 * warnings → incidents, DR capacity checks and metric rollups. No real infrastructure.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
process.env.DB_SCHEMA = `ops_teltest_${process.pid}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-teltest-'));
process.env.HOSTINGER_API_TOKEN = '';
process.env.CLOUDFLARE_API_TOKEN = '';
process.env.TELEMETRY_STALE_THRESHOLD_SEC = '10';

const { initStore, db, minuteMetrics, liveMetrics } = await import('../server/store.ts');
const { query, closePool, SCHEMA } = await import('../server/db.ts');
const { ingestAgentReport, publicServer, recomputeDerived } = await import('../server/engine.ts');
const { agentHealth, serverHealth, compareVersions, agentOutdated, sustained } = await import('../server/telemetryHealth.ts');
const { appChecksFor, parsePm2 } = await import('../server/telemetry.ts');
const { evaluateAlerts } = await import('../server/alerts.ts');
const { readiness } = await import('../server/readiness.ts');
const { AGENT_VERSION } = await import('../server/agent.ts');
type ServerRecord = import('../server/store.ts').ServerRecord;
type Application = import('../src/types/index.ts').Application;

function mkServer(env: 'PRD' | 'DR', ip: string): ServerRecord {
  return {
    id: crypto.randomUUID(), hostname: `tel-${env.toLowerCase()}-${ip.split('.').pop()}`, ip, applicationId: '', environment: env, provider: '', region: '', plan: '',
    cpuCores: 0, ramGb: 0, diskGb: 0, os: '', status: 'UNKNOWN', agentVersion: '', agentStatus: 'DISCONNECTED', uptimeDays: 0, lastSeen: '',
    telemetry: { cpuPercent: 0, ramPercent: 0, diskPercent: 0, loadAvg: [0, 0, 0], networkInKbps: 0, networkOutKbps: 0, observedAt: '', receivedAt: '' },
    processes: [], services: [], logs: [], agentToken: crypto.randomBytes(24).toString('hex'), createdAt: new Date().toISOString(),
  };
}
/** A report exactly as agent 3.2 sends it (no 3.3 sections) */
const v32 = (extra: Record<string, unknown> = {}) => ({
  agentVersion: '3.2.0', observedAt: new Date().toISOString(), cpuPercent: 10, ramPercent: 30, diskPercent: 40, load: [0.5, 0.4, 0.3],
  cpuCores: 4, memTotalMb: 8000, memUsedMb: 2400, memAvailableMb: 5600, diskTotalGb: 100, diskUsedGb: 40, diskFreeGb: 60, uptimeSec: 86400, ...extra,
});
/** A full agent 3.3 report */
const v33 = (extra: Record<string, unknown> = {}) => ({
  ...v32(), agentVersion: AGENT_VERSION,
  cpuIowaitPercent: 2.5, cpuStealPercent: 0.4, swapTotalMb: 2048, swapUsedMb: 512, swapFreeMb: 1536, swapPercent: 25,
  pressure: { cpu: 1.2, memory: 0.5, io: 3.1 },
  networkInterfaces: [{ name: 'eth0', rxBytesPerSec: 125000, txBytesPerSec: 62500, rxPacketsPerSec: 100, txPacketsPerSec: 80, rxErrors: 0, txErrors: 0, rxDrops: 5, txDrops: 0, operationalState: 'up', virtual: false }],
  diskIo: [{ device: 'vda', readBytesPerSec: 1000, writeBytesPerSec: 3000, readOpsPerSec: 2, writeOpsPerSec: 6, ioUtilizationPercent: 12.5, readLatencyMs: 0.8, writeLatencyMs: 1.6 }],
  filesystems: [
    { mountPoint: '/', filesystem: 'ext4', device: '/dev/vda1', totalGb: 100, usedGb: 40, freeGb: 60, usedPercent: 40, inodeTotal: 6000000, inodeUsed: 300000, inodeFree: 5700000, inodePercent: 5 },
  ],
  services: [{ name: 'nginx', status: 'active', activeState: 'active', subState: 'running', failed: false, restartCount: 0, pid: 10, memoryMb: 40, since: 'Mon 2026-10-05 10:00:00 UTC' }],
  failedUnits: { count: 0, units: [] },
  pm2: [{ id: 0, name: 'scholario-ops', status: 'online', pid: 1234, cpuPercent: 4.2, memoryMb: 180, uptimeSec: 7200, startedAt: new Date(Date.now() - 7_200_000).toISOString(), restartCount: 2, unstableRestarts: 0, nodeVersion: '22.11.0', interpreter: 'node', execMode: 'fork', instances: 1, version: '1.0.0', release: '20261008-101500-abc1234', gitRevision: 'abc1234def56', owner: 'root', ports: [4100] }],
  listeningPorts: [{ address: '127.0.0.1', port: 4100, process: 'node', pids: [1234], scope: 'loopback' }, { address: '0.0.0.0', port: 80, process: 'nginx', pids: [1], scope: 'all' }],
  appChecks: [{ applicationId: 'app-x', name: 'Ops', environment: 'PRD', port: 4100, path: '/api/health/live', listening: true, status: 'HEALTHY', statusCode: 200, latencyMs: 3.2, error: null, checkedAt: new Date().toISOString() }],
  ntp: { synchronized: true, ntpEnabled: true, service: 'chronyd', clockOffsetMs: -0.12, clockDriftPpm: -12.3 },
  system: { kernelVersion: '6.8.0-45-generic', architecture: 'x86_64', bootTime: '2026-10-01T08:00:00Z', timezone: 'Etc/UTC', osName: 'Ubuntu', osVersion: '24.04', nodeVersion: '22.11.0', npmVersion: '10.9.0' },
  sentAt: new Date().toISOString(), lastReportRttMs: 40,
  ...extra,
});

let app: Application;
let prd: ServerRecord;
let dr: ServerRecord;

before(async () => {
  await initStore();
  prd = mkServer('PRD', '203.0.113.10');
  dr = mkServer('DR', '203.0.113.20');
  db.servers.push(prd, dr);
  app = {
    id: crypto.randomUUID(), name: 'Ops', codeName: 'ops', description: '', tier: 'TIER_1', rtoTargetMin: 30, rpoTargetMin: 15,
    prdServerId: prd.id, drServerId: dr.id, prdUrl: '', drUrl: '', autoFailover: false, failoverState: 'PRD_ACTIVE',
    status: 'UNKNOWN', uptime24h: null, uptime7d: null, uptime30d: null, errorRatePercent: null, p50Ms: null, p95Ms: null, p99Ms: null,
    dependencies: [], currentReplicationLagSec: null, recentDeploymentVersion: '',
    environments: {
      PRD: { appPort: 4100, healthPath: '/api/health/live', webServer: null, processManager: 'pm2', routing: null, dbEngine: null, dbName: null, dbPort: null, replicationMaxLagSec: null, backupMaxAgeHours: null, notes: '' },
      DR: { appPort: 4100, healthPath: 'not a path', webServer: null, processManager: 'pm2', routing: null, dbEngine: null, dbName: null, dbPort: null, replicationMaxLagSec: null, backupMaxAgeHours: null, notes: '' },
    },
  } as unknown as Application;
  db.applications.push(app);
});

after(async () => {
  await query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  await closePool();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100).unref();
});

test('agent 3.2 report (backward compatibility): core fields stored, new sections absent, nothing invented', () => {
  ingestAgentReport(prd, v32());
  const t = prd.telemetry;
  assert.equal(t.cpuPercent, 10);
  assert.equal(t.memAvailableMb, 5600);
  assert.equal(t.cpuIowaitPercent, null, 'not reported → null, not 0');
  assert.equal(t.swapPercent, null);
  assert.equal(t.diskReadBytesPerSec, null);
  assert.equal(t.loadPerCore, 0.13, '0.5 load / 4 cores');
  assert.equal(prd.pm2, undefined);
  assert.equal(prd.filesystems, undefined);
  assert.equal(prd.agentTiming?.clockSkewMs, null, 'skew needs sentAt (agent 3.3)');
  const h = serverHealth(prd).health;
  assert.equal(h.find(x => x.key === 'pm2')!.level, 'UNKNOWN');
  assert.equal(h.find(x => x.key === 'swap')!.level, 'UNKNOWN');
  assert.equal(h.find(x => x.key === 'cpu')!.level, 'HEALTHY');
  assert.equal(agentHealth(prd).outdated, true, '3.2.0 < current');
});

test('agent 3.3 report: CPU / swap / pressure / filesystems / inodes / disk I/O / network / systemd / PM2 / ports / local health / NTP / system stored', () => {
  ingestAgentReport(prd, v33());
  const t = prd.telemetry;
  assert.equal(t.cpuIowaitPercent, 2.5);
  assert.equal(t.cpuStealPercent, 0.4);
  assert.deepEqual([t.swapTotalMb, t.swapUsedMb, t.swapFreeMb, t.swapPercent], [2048, 512, 1536, 25]);
  assert.deepEqual(t.pressure, { cpu: 1.2, memory: 0.5, io: 3.1 });
  assert.deepEqual([t.diskReadBytesPerSec, t.diskWriteBytesPerSec, t.diskUtilPercent], [1000, 3000, 12.5]);
  assert.equal(prd.filesystems![0].inodePercent, 5);
  assert.equal(prd.networkInterfaces![0].rxDrops, 5);
  assert.equal(prd.networkInterfaces![0].newDrops, null, 'first 3.3 report: no previous counters → unknown, not 0');
  assert.equal(prd.services[0].restartCount, 0);
  assert.equal(prd.services[0].subState, 'running');
  assert.equal(prd.pm2![0].nodeVersion, '22.11.0');
  assert.equal(prd.pm2![0].release, '20261008-101500-abc1234');
  assert.deepEqual(prd.pm2![0].ports, [4100]);
  assert.equal(prd.listeningPorts!.length, 2);
  assert.equal(prd.appHealth![0].status, 'HEALTHY');
  assert.equal(prd.appHealth![0].consecutiveFailures, 0);
  assert.equal(prd.ntp!.synchronized, true);
  assert.equal(prd.system!.kernelVersion, '6.8.0-45-generic');
  assert.equal(prd.agentTiming!.transportDelayMs, 20);
  assert.equal(agentHealth(prd).outdated, false);
  const h = serverHealth(prd);
  assert.ok(h.health.every(c => c.level === 'HEALTHY' || c.key === 'database'), JSON.stringify(h.health.filter(c => c.level !== 'HEALTHY')));
  assert.deepEqual(h.warnings, []);
});

test('network errors / drops: increase since the previous report; counter reset is not an increase', () => {
  ingestAgentReport(prd, v33());
  const base = v33().networkInterfaces as Array<Record<string, unknown>>;
  ingestAgentReport(prd, v33({ networkInterfaces: [{ ...base[0], rxErrors: 3, rxDrops: 9 }] }));
  assert.equal(prd.networkInterfaces![0].newErrors, 3);
  assert.equal(prd.networkInterfaces![0].newDrops, 4);
  assert.ok(serverHealth(prd).warnings.some(w => w.key === 'net-errors:eth0' && w.level === 'WARNING'));
  ingestAgentReport(prd, v33({ networkInterfaces: [{ ...base[0], rxErrors: 0, rxDrops: 0 }] }));
  assert.equal(prd.networkInterfaces![0].newErrors, null, 'reboot reset → unknown, not negative');
});

test('PM2: unknown fields are dropped (secret filtering), statuses validated, restart spike detected', () => {
  const secret = 'sk_live_server_side_secret';
  const apps = parsePm2([{ id: 1, name: 'api', status: 'online', restartCount: 5, env: { STRIPE: secret }, args: ['--token', secret], DB_PASSWORD: secret } as Record<string, unknown>], 'srv-x', Date.now());
  assert.equal(JSON.stringify(apps).includes(secret), false);
  assert.equal(Object.keys(apps[0]).includes('env'), false);
  assert.equal(parsePm2([{ name: 'x', status: 'hacked' }], 'srv-x', Date.now())[0].status, 'unknown');

  const pm2 = (restartCount: number, status = 'online') => [{ ...(v33().pm2 as Array<Record<string, unknown>>)[0], restartCount, status }];
  ingestAgentReport(dr, v33({ pm2: pm2(10) }));
  ingestAgentReport(dr, v33({ pm2: pm2(14) }));
  assert.equal(dr.pm2![0].recentRestarts, 4);
  assert.ok(serverHealth(dr).warnings.some(w => w.key === 'pm2-restarts:scholario-ops' && w.level === 'WARNING' && !w.alert));
  ingestAgentReport(dr, v33({ pm2: pm2(25) }));
  assert.ok(serverHealth(dr).warnings.some(w => w.key === 'pm2-restarts:scholario-ops' && w.level === 'CRITICAL' && w.alert));
  ingestAgentReport(dr, v33({ pm2: pm2(0, 'errored') }));
  assert.equal(dr.pm2![0].recentRestarts, 0, 'counter reset (pm2 reset) starts a new window');
  assert.ok(serverHealth(dr).warnings.some(w => w.key === 'pm2-errored:scholario-ops' && w.alert));
  ingestAgentReport(dr, v33({ pm2: null }));
  assert.equal(dr.pm2, null);
  assert.equal(serverHealth(dr).health.find(c => c.key === 'pm2')!.detail, 'PM2 not running on this server');
  ingestAgentReport(dr, v33({ pm2: undefined }));
  assert.equal(dr.pm2, null, 'section absent (light report) keeps the last value');
});

test('application port / local health: consecutive failures; only a repeated failure is critical; the server is not marked down', () => {
  const down = { ...(v33().appChecks as Array<Record<string, unknown>>)[0], listening: false, status: 'DOWN', statusCode: null, latencyMs: null, error: 'nothing accepting connections on 127.0.0.1:4100' };
  ingestAgentReport(prd, v33({ appChecks: [down] }));
  assert.equal(prd.appHealth![0].consecutiveFailures, 1);
  assert.ok(serverHealth(prd).warnings.some(w => w.category === 'apps' && w.level === 'WARNING' && !w.alert));
  ingestAgentReport(prd, v33({ appChecks: [down] }));
  assert.equal(prd.appHealth![0].consecutiveFailures, 2);
  assert.ok(serverHealth(prd).warnings.some(w => w.category === 'apps' && w.level === 'CRITICAL' && w.alert));
  assert.notEqual(prd.status, 'CRITICAL', 'a failing app check does not mark the VPS down');
  ingestAgentReport(prd, v33());
  assert.equal(prd.appHealth![0].consecutiveFailures, 0);
});

test('app checks sent to the agent come from the environment inventory; unsafe health paths fall back to /', () => {
  assert.deepEqual(appChecksFor(prd), [{ applicationId: app.id, name: 'Ops', environment: 'PRD', port: 4100, path: '/api/health/live' }]);
  assert.deepEqual(appChecksFor(dr), [{ applicationId: app.id, name: 'Ops', environment: 'DR', port: 4100, path: '/' }]);
});

test('validation: malformed values become null / are dropped, never trusted', () => {
  ingestAgentReport(dr, v33({
    cpuIowaitPercent: 150, swapPercent: 'lots', pressure: 'x',
    filesystems: [{ mountPoint: '/', usedPercent: 400, inodePercent: -1 }, { nothing: true }, 'junk'],
    diskIo: [{ device: 'vda', readBytesPerSec: -5, ioUtilizationPercent: 101 }],
    appChecks: [{ port: 99999, status: 'HEALTHY' }, { port: 8080, status: 'PWNED', statusCode: 42 }],
    listeningPorts: [{ port: 22, scope: 'internet' }],
    ntp: { synchronized: 'yes', clockOffsetMs: 'NaN' },
    pm2: [{ name: 'x'.repeat(500), pid: -3, cpuPercent: Infinity, ports: [80, 70000, 'a'] }],
    sentAt: 'yesterday',
  }));
  assert.equal(dr.telemetry.cpuIowaitPercent, null);
  assert.equal(dr.telemetry.swapPercent, null);
  assert.equal(dr.telemetry.pressure, null);
  assert.equal(dr.filesystems!.length, 1);
  assert.equal(dr.filesystems![0].usedPercent, null);
  assert.equal(dr.filesystems![0].inodePercent, null);
  assert.equal(dr.diskIo![0].readBytesPerSec, null);
  assert.equal(dr.diskIo![0].ioUtilizationPercent, null);
  assert.equal(dr.appHealth!.length, 1);
  assert.equal(dr.appHealth![0].status, 'UNKNOWN');
  assert.equal(dr.appHealth![0].statusCode, null);
  assert.equal(dr.listeningPorts![0].scope, 'address');
  assert.equal(dr.ntp!.synchronized, null);
  assert.equal(dr.pm2![0].name.length, 100);
  assert.equal(dr.pm2![0].pid, null);
  assert.equal(dr.pm2![0].cpuPercent, null);
  assert.deepEqual(dr.pm2![0].ports, [80]);
  assert.equal(dr.agentTiming!.sentAt, null);
});

test('clock skew and NTP: skew measured from sentAt; large skew / unsynchronised NTP are warnings', () => {
  ingestAgentReport(prd, v33({ sentAt: new Date(Date.now() - 40_000).toISOString(), lastReportRttMs: 100 }));
  const skew = prd.agentTiming!.clockSkewMs!;
  assert.ok(skew > 39_000 && skew < 41_000, String(skew));
  const w = serverHealth(prd).warnings.find(x => x.key === 'clock-skew')!;
  assert.equal(w.level, 'CRITICAL');
  assert.equal(w.alert, true);
  ingestAgentReport(prd, v33({ ntp: { synchronized: false, ntpEnabled: false, service: null, clockOffsetMs: null, clockDriftPpm: null } }));
  assert.ok(serverHealth(prd).warnings.some(x => x.key === 'ntp-unsynchronized'));
  assert.equal(serverHealth(prd).health.find(c => c.key === 'time')!.level, 'WARNING');
});

test('agent version state: one source of truth, numeric compare', () => {
  assert.ok(compareVersions('3.2.0', '3.3.0') < 0);
  assert.ok(compareVersions('3.10.0', '3.9.9') > 0);
  assert.equal(compareVersions('v3.3.0', '3.3'), 0);
  assert.equal(agentOutdated(''), null, 'never reported → unknown');
  assert.equal(agentOutdated(AGENT_VERSION), false);
  assert.equal(agentOutdated('2.4.1'), true);
  assert.equal(agentHealth(prd).expectedVersion, AGENT_VERSION);
});

test('stale and disconnected agents: health is UNKNOWN (never healthy), warnings name the agent state', () => {
  ingestAgentReport(dr, v33());
  dr.lastSeen = new Date(Date.now() - 30_000).toISOString(); recomputeDerived();
  assert.equal(agentHealth(dr).state, 'STALE');
  let h = serverHealth(dr);
  assert.equal(h.health.find(c => c.key === 'agent')!.level, 'WARNING');
  assert.ok(h.health.filter(c => c.key !== 'agent').every(c => c.level === 'UNKNOWN'));
  assert.deepEqual(h.warnings.map(w => w.key), ['agent-stale']);
  dr.lastSeen = new Date(Date.now() - 600_000).toISOString(); recomputeDerived();
  h = serverHealth(dr);
  assert.equal(agentHealth(dr).state, 'OFFLINE');
  assert.equal(h.health.find(c => c.key === 'agent')!.level, 'CRITICAL');
  const never = mkServer('DR', '203.0.113.99');
  assert.equal(agentHealth(never).state, 'NOT_CONNECTED');
  assert.ok(serverHealth(never).health.every(c => c.level === 'UNKNOWN'));
});

test('sustained thresholds: CPU needs every 1-minute rollup above the threshold (one spike never alerts)', () => {
  const id = prd.id;
  const now = Date.now();
  const pt = (minAgo: number, cpu: number) => ({ t: new Date(now - minAgo * 60_000).toISOString(), cpu, ram: 30, disk: 40, load1: 1, netIn: 0, netOut: 0 });
  // Ingest first: a report can complete a minute rollup, which must not interfere with the series below
  ingestAgentReport(prd, v33({ cpuPercent: 99 }));
  minuteMetrics[id] = [pt(5, 97), pt(4, 97), pt(3, 20), pt(2, 97), pt(1, 97)];
  assert.equal(sustained(id, 'cpu', 95, 5), false, 'a dip breaks the window');
  assert.equal(serverHealth(prd).warnings.some(w => w.key === 'cpu-high'), false, 'one high sample is not a warning');
  minuteMetrics[id] = [pt(5, 97), pt(4, 97), pt(3, 96), pt(2, 97), pt(1, 99)];
  assert.equal(sustained(id, 'cpu', 95, 5), true);
  assert.ok(serverHealth(prd).warnings.some(w => w.key === 'cpu-high' && w.level === 'CRITICAL' && w.alert));
  minuteMetrics[id] = [];
});

test('warnings → incidents: critical conditions open one deduplicated incident and resolve when cleared', () => {
  const before = db.incidents.length;
  ingestAgentReport(prd, v33({ services: [{ name: 'nginx', status: 'failed', activeState: 'failed', failed: true, restartCount: 3, pid: 0, memoryMb: 0, since: '' }] }));
  evaluateAlerts();
  evaluateAlerts();
  const inc = db.incidents.filter(i => i.fingerprint === `telemetry:${prd.id}:systemd:nginx`);
  assert.equal(inc.length, 1, 'deduplicated');
  assert.equal(inc[0].status, 'OPEN');
  assert.equal(inc[0].severity, 'HIGH', 'critical on PRD');
  assert.ok(db.incidents.length > before);
  ingestAgentReport(prd, v33());
  evaluateAlerts();
  assert.equal(db.incidents.find(i => i.fingerprint === `telemetry:${prd.id}:systemd:nginx`)!.status, 'RESOLVED');
  // Warning-only conditions (stopped PM2 app, outdated agent) never open incidents
  ingestAgentReport(prd, v33({ agentVersion: '3.2.0', pm2: [{ ...(v33().pm2 as Array<Record<string, unknown>>)[0], status: 'stopped' }] }));
  evaluateAlerts();
  assert.equal(db.incidents.some(i => i.fingerprint?.startsWith(`telemetry:${prd.id}:pm2-stopped`) || i.fingerprint?.startsWith(`telemetry:${prd.id}:agent-outdated`)), false);
});

test('full disk / inodes: per filesystem, critical opens an incident', () => {
  const fs0 = (v33().filesystems as Array<Record<string, unknown>>)[0];
  ingestAgentReport(prd, v33({ filesystems: [fs0, { ...fs0, mountPoint: '/var', usedPercent: 96, inodePercent: 90 }] }));
  const w = serverHealth(prd).warnings;
  assert.ok(w.some(x => x.key === 'disk:/var' && x.level === 'CRITICAL' && x.alert));
  assert.ok(w.some(x => x.key === 'inode:/var' && x.level === 'WARNING' && !x.alert));
  assert.equal(serverHealth(prd).health.find(c => c.key === 'disk')!.level, 'CRITICAL');
});

test('database telemetry: connection usage computed; DB issues reported', () => {
  ingestAgentReport(prd, v33({ databases: [{ engine: 'postgresql', name: 'app', available: true, latencyMs: 2, version: '16.4', sizeBytes: 1e9, connections: 85, maxConnections: 100, longRunningQueries: 1, replication: null, error: null }] }));
  assert.equal(prd.databases![0].connectionUsagePercent, 85);
  const w = serverHealth(prd).warnings;
  assert.ok(w.some(x => x.key === 'db-connections:postgresql app' && x.level === 'WARNING'));
  assert.ok(w.some(x => x.key === 'db-long-queries:postgresql app'));
});

test('DR capacity checks include PM2 / local health / time; READY is still decided by the core checks only', () => {
  ingestAgentReport(dr, v33());
  const r = readiness(app);
  const cap = r.checks.filter(c => c.group === 'capacity');
  assert.deepEqual(cap.map(c => c.key), ['telemetry', 'services', 'disk', 'memory', 'cpu', 'pm2', 'app_local', 'time']);
  assert.equal(cap.find(c => c.key === 'pm2')!.status, 'PASS');
  assert.equal(r.total, 11, 'no load balancer: the 2 Cloudflare pool / origin checks do not apply');
  assert.notEqual(r.overall, 'READY', 'a connected agent alone never makes DR READY');
});

test('publicServer: no agent token; computed agent / health / warnings; old fields unchanged', () => {
  const p = publicServer(prd) as unknown as Record<string, unknown>;
  assert.equal('agentToken' in p, false);
  assert.equal(JSON.stringify(p).includes(prd.agentToken), false);
  for (const k of ['id', 'hostname', 'ip', 'environment', 'status', 'agentStatus', 'agentVersion', 'lastSeen', 'telemetry', 'processes', 'services', 'logs']) assert.ok(k in p, k);
  assert.ok(Array.isArray(p.health) && Array.isArray(p.warnings) && typeof p.agent === 'object');
});

test('metric history: new series are averaged per minute; missing values stay null', () => {
  const id = dr.id;
  delete liveMetrics[id];
  ingestAgentReport(dr, v33({ swapPercent: 20, cpuIowaitPercent: 4 }));
  ingestAgentReport(dr, v32());
  const live = liveMetrics[id];
  assert.equal(live[0].swap, 20);
  assert.equal(live[0].iowait, 4);
  assert.equal(live[0].diskUtil, 12.5);
  assert.equal(live[1].swap, null, '3.2 report → null, not 0');
});

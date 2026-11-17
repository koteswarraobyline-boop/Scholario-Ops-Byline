/**
 * Go-live checks on sample data: both URLs answered, both agents CONNECTED, Cloudflare pools
 * and origins read for a Load Balancer application, and the DR score reviewed.
 * A failure is not recorded unless a defect is logged. A later green run is recorded after the fix.
 *   npm run test:local -- tests/go-live.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { pinTestDatabaseUrl, assertConnectedToTestDatabase, dropVerifiedTestSchema } from './helpers/test-db-guard.ts';

pinTestDatabaseUrl();
dotenv.config({ quiet: true });
process.env.DB_SCHEMA = `ops_golive_${process.pid}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-golive-'));
process.env.HOSTINGER_API_TOKEN = '';
process.env.CLOUDFLARE_API_TOKEN = '';

const { query, closePool, SCHEMA } = await import('../server/db.ts');
const { db, initStore, flush } = await import('../server/store.ts');
const { evaluateGoLive, recordGoLive } = await import('../server/golive.ts');
const { lbState } = await import('../server/loadbalancer.ts');
const { readiness } = await import('../server/readiness.ts');
type ServerRecord = import('../server/store.ts').ServerRecord;
type Application = import('../src/types/index.ts').Application;
type BackupRecord = import('../src/types/index.ts').BackupRecord;
type EnvironmentInventory = import('../src/types/index.ts').EnvironmentInventory;
type LbPool = import('../src/types/index.ts').LbPool;
type Monitor = import('../src/types/index.ts').Monitor;

const inventory = (): EnvironmentInventory => ({
  appPort: 443, healthPath: '/health', webServer: 'nginx', processManager: 'pm2', routing: null,
  dbEngine: 'mysql', dbName: 'app', dbPort: 3306, replicationMaxLagSec: 60, backupMaxAgeHours: 24, notes: '',
});

function monitor(appId: string, env: 'PRD' | 'DR', type: Monitor['type'], target: string, managedBy: string): Monitor {
  const at = new Date().toISOString();
  return {
    id: crypto.randomUUID(), name: `${env} ${type}`, type, target, applicationId: appId, environment: env,
    intervalSec: 30, timeoutSec: 5, retries: 1, warningThresholdMs: 2000, criticalThresholdMs: 10000,
    failureConfirmationThreshold: 3, recoveryConfirmationThreshold: 2, consecutiveFailures: 0, consecutiveRecoveries: 2,
    status: 'HEALTHY', lastCheck: at, lastSuccess: at, lastProbeStatus: 'UP', lastStatusCode: type === 'SSL' ? null : 200,
    responseTimeMs: 80, uptimePercent: 100, enabled: true, activeMaintenance: false, managedBy,
    history: [{ timestamp: at, status: 'HEALTHY', responseTimeMs: 80, statusCode: type === 'SSL' ? undefined : 200, detail: 'ok' }],
  } as Monitor;
}

function connect(server: ServerRecord, role: 'primary' | 'replica') {
  const at = new Date().toISOString();
  server.agentStatus = 'CONNECTED';
  server.lastSeen = at;
  server.databases = [{
    engine: 'mysql', name: 'app', available: true, latencyMs: 3, version: '8.0.36', sizeBytes: 1,
    connections: 4, maxConnections: 151, longRunningQueries: 0, error: null, observedAt: at,
    replication: role === 'replica'
      ? { role: 'replica', state: 'running', lagSec: 2, lastSuccessAt: at, error: null }
      : { role: 'primary', state: 'running', lagSec: null, lastSuccessAt: null, error: null },
  }];
}

function appOf(prdId: string, drId: string, extra: Partial<Application> = {}): Application {
  return {
    id: crypto.randomUUID(), name: 'Go Live App', codeName: 'golive', description: '', tier: 'TIER_1',
    rtoTargetMin: 30, rpoTargetMin: 15, prdServerId: prdId, drServerId: drId,
    prdUrl: 'https://app.example.com/health', drUrl: 'https://dr.example.com/health',
    autoFailover: false, failoverState: 'PRIMARY_ACTIVE', cloudflareZone: 'example.com', dnsRecordName: 'app.example.com',
    status: 'HEALTHY', uptime24h: null, uptime7d: null, uptime30d: null, errorRatePercent: null,
    p50Ms: null, p95Ms: null, p99Ms: null, dependencies: [], currentReplicationLagSec: 2, recentDeploymentVersion: '',
    environments: { PRD: inventory(), DR: inventory() },
    ...extra,
  } as Application;
}

function arm(app: Application, prdId: string) {
  db.applications.push(app);
  db.monitors.push(
    monitor(app.id, 'PRD', 'HTTPS', app.prdUrl!, 'app-url'),
    monitor(app.id, 'DR', 'HTTPS', app.drUrl!, 'app-url'),
    monitor(app.id, 'DR', 'SSL', 'dr.example.com', 'app-ssl'),
  );
  const backup: BackupRecord = {
    id: crypto.randomUUID(), applicationId: app.id, serverId: prdId, type: 'MYSQL_DUMP', sizeGb: 1,
    destination: 's3://backups', retentionDays: 7, encrypted: true, integrityVerified: true, integrityHash: 'abc',
    restoreTestedAt: '', restoreDurationMin: 0, restoreStatus: 'PENDING', status: 'SUCCESS', completedAt: new Date().toISOString(),
  };
  db.backups.unshift(backup);
}

function pool(id: string, appId: string, role: 'PRD' | 'DR', ip: string): LbPool {
  const at = new Date().toISOString();
  return {
    id, name: `${role} pool`, description: '', enabled: true, healthy: true, role, applicationId: appId,
    found: true, listFetchedAt: at, healthFetchedAt: at, healthError: null,
    origins: [{
      name: role, address: ip, enabled: true, weight: 1, healthy: true, failureReason: null,
      health: [{ pop: 'SIN', healthy: true, rttMs: 20, responseCode: 200, failureReason: null }],
    }],
  };
}

let prd: ServerRecord;
let dr: ServerRecord;
let verified = false;

before(async () => {
  await assertConnectedToTestDatabase({ query: sql => query(sql) });
  verified = true;
  await initStore();
  const at = new Date().toISOString();
  prd = {
    id: crypto.randomUUID(), hostname: 'golive-prd', ip: '203.0.113.51', applicationId: '', environment: 'PRD',
    provider: '', region: '', plan: '', cpuCores: 2, ramGb: 4, diskGb: 40, os: '', status: 'HEALTHY',
    agentVersion: '1', agentStatus: 'DISCONNECTED', uptimeDays: 1, lastSeen: '',
    telemetry: { cpuPercent: 0, ramPercent: 0, diskPercent: 0, loadAvg: [0, 0, 0], networkInKbps: 0, networkOutKbps: 0, observedAt: '', receivedAt: '' },
    processes: [], services: [], logs: [], agentToken: 'prd-token', createdAt: at,
  };
  dr = { ...prd, id: crypto.randomUUID(), hostname: 'golive-dr', ip: '203.0.113.52', environment: 'DR', agentToken: 'dr-token' };
  connect(prd, 'primary');
  connect(dr, 'replica');
  db.servers.push(prd, dr);
});

after(async () => {
  await dropVerifiedTestSchema(verified, () => query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {}));
  await closePool();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100).unref();
});

test('go-live records green only when the checks pass, and a failure needs a logged defect', async () => {
  const dns = appOf(prd.id, dr.id, { name: 'DNS sample' });
  arm(dns, prd.id);
  const score = readiness(dns);
  assert.equal(score.overall, 'READY', score.checks.filter(c => c.status !== 'PASS').map(c => `${c.key}:${c.status}:${c.detail}`).join(' | '));
  const preview = evaluateGoLive(dns);
  assert.equal(preview.overall, 'GREEN');
  for (const key of ['prd_url', 'dr_url', 'prd_agent', 'dr_agent', 'dr_score']) {
    assert.equal(preview.checks.find(c => c.key === key)!.status, 'PASS', key);
  }
  assert.equal(preview.checks.find(c => c.key === 'cf_pools')!.status, 'NOT_APPLICABLE');
  assert.equal(preview.checks.find(c => c.key === 'cf_origins')!.status, 'NOT_APPLICABLE');
  const run = recordGoLive(dns, 'qa@example.com', undefined);
  assert.equal(run.overall, 'GREEN');
  assert.equal(run.defect, null);
  assert.equal(await flush(), true);
  const saved = await query(`SELECT data FROM ${SCHEMA}.go_live_runs WHERE id = $1`, [run.id]);
  assert.equal(saved.rows[0].data.overall, 'GREEN');
  assert.equal(db.auditLogs.find(a => a.action === 'GO_LIVE_PASSED' && a.targetId === dns.id)?.operator, 'qa@example.com');

  dr.agentStatus = 'DISCONNECTED';
  const failed = evaluateGoLive(dns);
  assert.equal(failed.checks.find(c => c.key === 'dr_agent')!.status, 'FAIL');
  assert.equal(failed.checks.find(c => c.key === 'prd_agent')!.status, 'PASS');
  assert.equal(failed.overall, 'FAILED');
  const before = db.goLiveRuns.length;
  assert.throws(() => recordGoLive(dns, 'qa@example.com', '   '), /log a defect/);
  assert.equal(db.goLiveRuns.length, before);
  const logged = recordGoLive(dns, 'qa@example.com', 'DR agent disconnected — defect OPS-12');
  assert.equal(logged.overall, 'FAILED');
  assert.equal(logged.defect?.summary, 'DR agent disconnected — defect OPS-12');
  assert.equal(logged.defect?.loggedBy, 'qa@example.com');
  assert.ok(db.auditLogs.some(a => a.action === 'GO_LIVE_FAILED' && a.details.includes('OPS-12')));
  connect(dr, 'replica');
  const fixed = recordGoLive(dns, 'qa@example.com', undefined);
  assert.equal(fixed.overall, 'GREEN');
  assert.equal(fixed.defect, null);
  assert.equal(evaluateGoLive(dns).latest?.id, fixed.id);

  const lb = appOf(prd.id, dr.id, {
    name: 'LB sample',
    codeName: 'golive-lb',
    loadBalancer: { accountId: 'a'.repeat(32), hostname: 'lbapp.example.com', prdPoolId: 'b'.repeat(32), drPoolId: 'c'.repeat(32) },
  });
  arm(lb, prd.id);
  lbState.pools = [];
  const unread = evaluateGoLive(lb);
  assert.equal(unread.checks.find(c => c.key === 'cf_pools')!.status, 'FAIL');
  assert.equal(unread.checks.find(c => c.key === 'cf_origins')!.status, 'FAIL');
  assert.throws(() => recordGoLive(lb, 'qa@example.com', undefined), /not green/);
  const defect = recordGoLive(lb, 'qa@example.com', 'Cloudflare pools were not read before the window');
  assert.equal(defect.overall, 'FAILED');
  lbState.pools = [
    pool('b'.repeat(32), lb.id, 'PRD', prd.ip),
    pool('c'.repeat(32), lb.id, 'DR', dr.ip),
  ];
  const ready = evaluateGoLive(lb);
  assert.equal(ready.drOverall, 'READY', readiness(lb).checks.filter(c => c.status !== 'PASS').map(c => `${c.key}:${c.status}:${c.detail}`).join(' | '));
  assert.equal(ready.checks.find(c => c.key === 'cf_pools')!.status, 'PASS');
  assert.equal(ready.checks.find(c => c.key === 'cf_origins')!.status, 'PASS');
  const green = recordGoLive(lb, 'qa@example.com', 'leftover note is dropped once the checks pass');
  assert.equal(green.overall, 'GREEN');
  assert.equal(green.defect, null);
});

/**
 * Cloudflare Load Balancer handling, in-process, with Cloudflare's HTTP API replaced by
 * recorded response shapes (pools list + pool health). Uses a throw-away PostgreSQL schema.
 * Verifies: "Load pools" listing, pool/origin/RTT parsing, routing, readiness, origin incidents,
 * permission errors — and that configuration comes from the database, not code.
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
process.env.DB_SCHEMA = `ops_lbtest_${process.pid}`;
process.env.CLOUDFLARE_API_TOKEN = 'lb-test-fake-token';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-lbtest-'));

const ACC = '0123456789abcdef0123456789abcdef';
const PRD_POOL = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DR_POOL = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PRD_IP = '198.51.100.10';
const DR_IP = '198.51.100.20';
const POOLS = [
  { id: PRD_POOL, name: 'app-production', description: 'Production-Server', enabled: true, healthy: true, origins: [{ name: 'Production-Server', address: PRD_IP, enabled: true, weight: 1, healthy: true, failure_reason: 'No failures' }] },
  { id: DR_POOL, name: 'app-dr-standby', description: 'DR Standby Server', enabled: true, healthy: true, origins: [{ name: 'DR-Server', address: DR_IP, enabled: true, weight: 1, healthy: true, failure_reason: 'No failures' }] },
];
const health = (id: string, ip: string, rtt: string) => ({ pool_id: id, pop_health: { SAS: { healthy: true, origins: [{ [ip]: { healthy: true, rtt, failure_reason: 'No failures', response_code: 200 } }] } } });
let mode: 'ok' | 'down' | 'perm' = 'ok';
let zonesVisible = true;
let accountLb: 'denied' | 'found' | 'empty' = 'denied';
let lbPayload: Record<string, unknown> = {
  id: 'lb1', name: 'app.example.com', enabled: true, proxied: true,
  steering_policy: 'off', default_pools: [PRD_POOL, DR_POOL], fallback_pool: DR_POOL,
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = String(input);
  if (!u.startsWith('https://api.cloudflare.com/')) return realFetch(input, init);
  const env = (result: unknown, status = 200, errors: unknown[] = []) => new Response(JSON.stringify({ success: status === 200, errors, result }), { status });
  if (mode === 'perm') return env(null, 403, [{ code: 10000, message: 'Authentication error' }]);
  if (u.includes('/load_balancers/pools/') && u.endsWith('/health')) {
    const h = u.includes(PRD_POOL) ? health(PRD_POOL, PRD_IP, '23ms') : health(DR_POOL, DR_IP, '16.1ms');
    if (mode === 'down' && u.includes(PRD_POOL)) Object.assign(h.pop_health.SAS.origins[0][PRD_IP], { healthy: false, failure_reason: 'HTTP timeout occurred', response_code: null, rtt: null });
    return env(h);
  }
  if (u.includes(`/accounts/${ACC}/load_balancers/pools`)) return env(POOLS);
  if (u.includes(`/accounts/${ACC}/load_balancers`)) {
    if (accountLb === 'found') return env([lbPayload]);
    if (accountLb === 'empty') return env([]);
    return env(null, 403, [{ code: 10000, message: 'Authentication error' }]);
  }
  if (u.includes('/zones?name=')) return env(zonesVisible ? [{ id: 'zone1', name: 'example.com' }] : []);
  if (u.includes('/zones/zone1/load_balancers')) return env([lbPayload]);
  return env(null, 404, [{ code: 7003, message: 'not found' }]);
}) as typeof fetch;

const { initStore, db, flush, persist } = await import('../server/store.ts');
const { query, closePool, SCHEMA } = await import('../server/db.ts');
const { syncLoadBalancers } = await import('../server/loadbalancer.ts');
const { listLoadBalancerPools } = await import('../server/cloudflare.ts');
const { readiness } = await import('../server/readiness.ts');
const { startEngine } = await import('../server/engine.ts');

let appId = '';
let verified = false;
before(async () => {
  await assertConnectedToTestDatabase({ query: sql => query(sql) });
  verified = true;
  await initStore();
  startEngine();
  const mk = (env: 'PRD' | 'DR', ip: string) => ({
    id: crypto.randomUUID(), hostname: `lb-${env.toLowerCase()}`, ip, applicationId: '', environment: env, provider: '', region: '', plan: '',
    cpuCores: 0, ramGb: 0, diskGb: 0, os: '', status: 'UNKNOWN' as const, agentVersion: '', agentStatus: 'DISCONNECTED' as const, uptimeDays: 0, lastSeen: '',
    telemetry: { cpuPercent: 0, ramPercent: 0, diskPercent: 0, loadAvg: [0, 0, 0] as [number, number, number], networkInKbps: 0, networkOutKbps: 0, observedAt: '', receivedAt: '' },
    processes: [], services: [], logs: [], agentToken: crypto.randomBytes(24).toString('hex'), createdAt: new Date().toISOString(),
  });
  const prd = mk('PRD', PRD_IP), dr = mk('DR', DR_IP);
  db.servers.push(prd, dr);
  appId = crypto.randomUUID();
  db.applications.push({
    id: appId, name: 'LB App', codeName: 'lb-app', description: '', tier: 'TIER_1', status: 'UNKNOWN', uptime24h: null, uptime7d: null, uptime30d: null,
    rtoTargetMin: 30, rpoTargetMin: 15, currentReplicationLagSec: null, prdServerId: prd.id, drServerId: dr.id, failoverState: 'PRIMARY_ACTIVE',
    p50Ms: null, p95Ms: null, p99Ms: null, errorRatePercent: null, lastChecked: '', cloudflareZone: 'example.com', autoFailover: false, dependencies: [],
    loadBalancer: { accountId: ACC, hostname: 'app.example.com', prdPoolId: PRD_POOL, drPoolId: DR_POOL },
  });
  persist();
  assert.equal(await flush(), true);
});

after(async () => {
  await dropVerifiedTestSchema(verified, () => query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {}));
  await closePool();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100).unref();
});

test('"Load pools" lists pools from the Cloudflare API (server-side)', async () => {
  const pools = await listLoadBalancerPools(ACC);
  assert.deepEqual(pools.map(p => [p.id, p.name, p.origins[0].address]), [[PRD_POOL, 'app-production', PRD_IP], [DR_POOL, 'app-dr-standby', DR_IP]]);
});

test('mapping is read from PostgreSQL and pool health is parsed', async () => {
  const row = (await query(`SELECT prd_pool_id FROM ${SCHEMA}.application_load_balancers WHERE application_id = $1`, [appId])).rows[0];
  assert.equal(row.prd_pool_id, PRD_POOL);
  const s = await syncLoadBalancers('manual');
  assert.equal(s.status, 'OK', s.lastError ?? '');
  const prd = s.pools.find(p => p.role === 'PRD')!;
  const dr = s.pools.find(p => p.role === 'DR')!;
  assert.equal(prd.name, 'app-production');
  assert.equal(prd.origins[0].health[0].rttMs, 23);
  assert.equal(prd.origins[0].health[0].responseCode, 200);
  assert.equal(dr.origins[0].health[0].rttMs, 16.1);
  assert.equal(s.routing[0].activePoolId, PRD_POOL);
  assert.deepEqual(s.routing[0].traffic, [{ poolId: PRD_POOL, percent: 100 }]);
  const r = readiness(db.applications.find(a => a.id === appId)!);
  for (const k of ['dr_pool', 'dr_origin']) assert.equal(r.checks.find(c => c.key === k)!.status, 'PASS', k);
});

test('origin failure → routing to DR, incident raised, then recovered', async () => {
  mode = 'down';
  let s = await syncLoadBalancers();
  assert.equal(s.routing[0].activePoolId, DR_POOL);
  assert.deepEqual(s.routing[0].traffic, [{ poolId: DR_POOL, percent: 100 }]);
  const inc = db.incidents.find(i => i.fingerprint === `cf-origin:${PRD_POOL}:${PRD_IP}`);
  assert.equal(inc?.status, 'OPEN');
  mode = 'ok';
  s = await syncLoadBalancers();
  assert.equal(db.incidents.find(i => i.id === inc!.id)?.status, 'RESOLVED');
  assert.equal(s.routing[0].activePoolId, PRD_POOL);
});

test('a sync requested while another is running waits and reflects the latest configuration', async () => {
  const app = db.applications.find(a => a.id === appId)!;
  const saved = app.loadBalancer;
  app.loadBalancer = undefined;
  const first = syncLoadBalancers();           // starts with "no mapping"
  app.loadBalancer = saved;                    // admin saves the mapping meanwhile
  const second = await syncLoadBalancers('manual');
  await first;
  assert.equal(second.status, 'OK', 'must not return the stale state of the running sync');
  assert.ok(second.pools.some(p => p.id === PRD_POOL && p.found));
});

test('random weights split traffic across healthy pools; one healthy pool takes 100%', async () => {
  const saved = { ...lbPayload };
  try {
    lbPayload = {
      ...saved, steering_policy: 'random',
      random_steering: { default_weight: 1, pool_weights: { [PRD_POOL]: 0.7, [DR_POOL]: 0.3 } },
    };
    let s = await syncLoadBalancers();
    assert.equal(s.routing[0].activePoolId, null);
    assert.deepEqual(s.routing[0].traffic.map(t => [t.poolId, t.percent]), [[PRD_POOL, 70], [DR_POOL, 30]]);
    assert.equal(db.applications.find(a => a.id === appId)!.failoverState, 'PRIMARY_ACTIVE');

    mode = 'down';
    s = await syncLoadBalancers();
    assert.equal(s.routing[0].activePoolId, DR_POOL);
    assert.deepEqual(s.routing[0].traffic, [{ poolId: DR_POOL, percent: 100 }]);
    mode = 'ok';

    lbPayload = { ...saved, steering_policy: 'dynamic_latency' };
    s = await syncLoadBalancers();
    assert.equal(s.routing[0].activePoolId, null);
    assert.equal(s.routing[0].traffic.length, 2);
    assert.ok(s.routing[0].traffic.every(t => t.percent === null));
  } finally {
    mode = 'ok';
    lbPayload = saved;
    await syncLoadBalancers();
  }
});

test('routing is read from the account when the zone is not visible', async () => {
  zonesVisible = false;
  accountLb = 'found';
  try {
    const s = await syncLoadBalancers();
    assert.equal(s.routing[0].found, true, s.routing[0].error ?? '');
    assert.equal(s.routing[0].activePoolId, PRD_POOL);
    assert.deepEqual(s.routing[0].traffic, [{ poolId: PRD_POOL, percent: 100 }]);
    assert.equal(s.status, 'OK', s.lastError ?? '');
  } finally {
    zonesVisible = true;
    accountLb = 'denied';
  }
});

test('an empty zone list is not a healthy route: the error says the token cannot list zones', async () => {
  zonesVisible = false;
  accountLb = 'empty';
  try {
    const s = await syncLoadBalancers();
    assert.equal(s.routing[0].found, false);
    assert.equal(s.routing[0].activePoolId, null);
    assert.equal(s.routing[0].traffic.length, 0);
    assert.match(s.routing[0].error ?? '', /cannot list zones/);
    assert.equal(s.status, 'ERROR');
    assert.match(s.lastError ?? '', /cannot list zones/);
    assert.equal(s.pools.find(p => p.role === 'PRD')?.found, true, 'pool health is still reported');
  } finally {
    zonesVisible = true;
    accountLb = 'denied';
    await syncLoadBalancers();
  }
});

test('missing permission → PERMISSION_REQUIRED and no stale "healthy"', async () => {
  mode = 'perm';
  const s = await syncLoadBalancers();
  assert.equal(s.status, 'PERMISSION_REQUIRED');
  assert.ok(s.pools.every(p => p.healthy === null && p.origins.length === 0));
  mode = 'ok';
});

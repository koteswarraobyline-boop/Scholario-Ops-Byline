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
  if (u.includes('/zones?name=')) return env([{ id: 'zone1', name: 'example.com' }]);
  if (u.includes('/zones/zone1/load_balancers')) return env([{ id: 'lb1', name: 'app.example.com', enabled: true, proxied: true, steering_policy: 'off', default_pools: [PRD_POOL, DR_POOL], fallback_pool: DR_POOL }]);
  return env(null, 404, [{ code: 7003, message: 'not found' }]);
}) as typeof fetch;

const { initStore, db, flush, persist } = await import('../server/store.ts');
const { query, closePool, SCHEMA } = await import('../server/db.ts');
const { syncLoadBalancers } = await import('../server/loadbalancer.ts');
const { listLoadBalancerPools } = await import('../server/cloudflare.ts');
const { readiness } = await import('../server/readiness.ts');
const { startEngine } = await import('../server/engine.ts');

let appId = '';
before(async () => {
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
  await query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
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
  const r = readiness(db.applications.find(a => a.id === appId)!);
  for (const k of ['dr_pool', 'dr_origin']) assert.equal(r.checks.find(c => c.key === k)!.status, 'PASS', k);
});

test('origin failure → routing to DR, incident raised, then recovered', async () => {
  mode = 'down';
  let s = await syncLoadBalancers();
  assert.equal(s.routing[0].activePoolId, DR_POOL);
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

test('missing permission → PERMISSION_REQUIRED and no stale "healthy"', async () => {
  mode = 'perm';
  const s = await syncLoadBalancers();
  assert.equal(s.status, 'PERMISSION_REQUIRED');
  assert.ok(s.pools.every(p => p.healthy === null && p.origins.length === 0));
  mode = 'ok';
});

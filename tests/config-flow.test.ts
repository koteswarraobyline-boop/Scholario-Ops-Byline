/**
 * End-to-end test of the configuration architecture:
 *   admin enters config → API → PostgreSQL → monitoring uses it.
 *
 * Runs a real Scholario Ops server against a throw-away PostgreSQL schema (ops_test_<pid>)
 * in the database from DATABASE_URL, and drops the schema afterwards. Needs PostgreSQL.
 *   npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const SCHEMA = `ops_test_${process.pid}`;
const PORT = 3900 + (process.pid % 90);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'e2e-admin@example.com', password: 'E2eTestPassw0rd!' };
const FAKE_CF_TOKEN = 'e2e-fake-cloudflare-token-must-never-leak-4f1c';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-e2e-'));

let server: ChildProcess | null = null;
let token = '';
const pgc = new pg.Client({ connectionString: DATABASE_URL });

async function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: {
      ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR, NODE_ENV: 'production',
      ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, CLOUDFLARE_API_TOKEN: FAKE_CF_TOKEN, HOSTINGER_API_TOKEN: '', DEADMAN_HEARTBEAT_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout?.on('data', d => { log += d; });
  server.stderr?.on('data', d => { log += d; });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`server did not start:\n${log}`);
}

async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>(resolve => { s.once('exit', () => resolve()); s.kill('SIGTERM'); setTimeout(() => { s.kill('SIGKILL'); resolve(); }, 8000); });
}

async function api<T = any>(method: string, p: string, body?: unknown): Promise<{ status: number; body: T; raw: string }> {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null, raw };
}

async function login() {
  const r = await api('POST', '/api/auth/login', ADMIN);
  assert.equal(r.status, 200, r.raw);
  token = r.body.data.tokens.accessToken;
}

const one = async (sql: string, params: unknown[] = []) => (await pgc.query(sql, params)).rows[0];
const waitFor = async <T>(fn: () => Promise<T | undefined | null | false>, ms = 20_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise(r => setTimeout(r, 500));
  }
};

before(async () => {
  assert.ok(DATABASE_URL, 'DATABASE_URL must be set (in .env) to run the tests');
  await pgc.connect();
  await startServer();
  await login();
});

after(async () => {
  await stopServer();
  await pgc.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  await pgc.end().catch(() => {});
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const ids: Record<string, string> = {};

test('migrations create the schema in PostgreSQL', async () => {
  const r = await one(`select count(*)::int n from information_schema.tables where table_schema = $1`, [SCHEMA]);
  assert.ok(r.n >= 18, `expected tables in ${SCHEMA}, found ${r.n}`);
  assert.equal((await one(`select name from ${SCHEMA}.schema_migrations where name = '001_init.sql'`))?.name, '001_init.sql');
});

test('server: create with capacity → stored in PostgreSQL columns', async () => {
  const r = await api('POST', '/api/v1/servers', { hostname: 'e2e-prd', ip: '192.0.2.10', environment: 'PRD', provider: 'TestProvider', region: 'Test-1', plan: 'KVM 8', planCpuCores: 8, planRamGb: 32, planDiskGb: 400, notes: 'primary' });
  assert.equal(r.status, 201, r.raw);
  ids.prd = r.body.data.id;
  assert.equal(r.raw.includes('agentToken'), false, 'agent token must not be returned');
  const row = await one(`select * from ${SCHEMA}.servers where id = $1`, [ids.prd]);
  assert.equal(row.ip, '192.0.2.10');
  assert.equal(row.environment, 'PRD');
  assert.equal(row.plan_cpu_cores, 8);
  assert.equal(Number(row.plan_ram_gb), 32);
  assert.equal(Number(row.plan_disk_gb), 400);
  assert.equal(row.plan_source, 'manual');
  const dr = await api('POST', '/api/v1/servers', { hostname: 'e2e-dr', ip: '192.0.2.20', environment: 'DR', plan: 'KVM 2', planCpuCores: 2, planRamGb: 8, planDiskGb: 100 });
  assert.equal(dr.status, 201, dr.raw);
  ids.dr = dr.body.data.id;
});

test('server: validation rejects bad input', async () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ hostname: 'bad-ip', ip: '999.1.1.1', environment: 'PRD' }, /IP address/],
    [{ hostname: 'neg-cpu', ip: '192.0.2.30', environment: 'PRD', planCpuCores: -2, planRamGb: 8, planDiskGb: 10 }, /CPU cores/],
    [{ hostname: 'zero-ram', ip: '192.0.2.31', environment: 'PRD', planCpuCores: 2, planRamGb: 0, planDiskGb: 10 }, /RAM/],
    [{ hostname: 'partial', ip: '192.0.2.32', environment: 'PRD', planCpuCores: 2 }, /together/],
    [{ hostname: 'dup-ip', ip: '192.0.2.10', environment: 'PRD' }, /already registered/],
  ];
  for (const [body, msg] of cases) {
    const r = await api('POST', '/api/v1/servers', body);
    assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.raw}`);
    assert.match(r.body.message, msg);
  }
});

test('server: edit persists to PostgreSQL', async () => {
  const r = await api('PATCH', `/api/v1/servers/${ids.prd}`, { ip: '192.0.2.11', planCpuCores: 16, planRamGb: 64, planDiskGb: 800, region: 'Test-2' });
  assert.equal(r.status, 200, r.raw);
  await waitFor(async () => (await one(`select ip from ${SCHEMA}.servers where id = $1`, [ids.prd]))?.ip === '192.0.2.11');
  const row = await one(`select * from ${SCHEMA}.servers where id = $1`, [ids.prd]);
  assert.equal(row.plan_cpu_cores, 16);
  assert.equal(row.region, 'Test-2');
});

test('application: create with URLs, Cloudflare LB and health check → PostgreSQL + managed monitors', async () => {
  const r = await api('POST', '/api/v1/applications', {
    name: 'E2E App', codeName: 'e2e-app', tier: 'TIER_1', rtoTargetMin: 45, rpoTargetMin: 10, description: 'test',
    prdServerId: ids.prd, drServerId: ids.dr,
    prdUrl: `${BASE}/health`, drUrl: `${BASE}/api/health`,
    loadBalancer: { accountId: 'a'.repeat(32), hostname: 'e2e.example.com', prdPoolId: 'b'.repeat(32), drPoolId: 'c'.repeat(32) },
    healthCheck: { expectedStatus: 200, intervalSec: 10, timeoutSec: 5, sslMonitoring: true },
    cloudflareZone: 'example.com',
  });
  assert.equal(r.status, 201, r.raw);
  ids.app = r.body.data.id;
  assert.equal(r.body.data.autoFailover, false, 'automatic failover must stay off');
  await waitFor(async () => (await one(`select 1 x from ${SCHEMA}.application_load_balancers where application_id = $1`, [ids.app]))?.x);
  const app = await one(`select * from ${SCHEMA}.applications where id = $1`, [ids.app]);
  assert.equal(app.prd_url, `${BASE}/health`);
  assert.equal(app.rto_target_min, 45);
  assert.equal(app.hc_expected_status, 200);
  assert.equal(app.auto_failover, false);
  const lb = await one(`select * from ${SCHEMA}.application_load_balancers where application_id = $1`, [ids.app]);
  assert.deepEqual([lb.account_id, lb.hostname, lb.prd_pool_id, lb.dr_pool_id], ['a'.repeat(32), 'e2e.example.com', 'b'.repeat(32), 'c'.repeat(32)]);
  const mons = (await pgc.query(`select type, target, environment, managed_by, interval_sec, expected_status_code from ${SCHEMA}.monitors where application_id = $1 order by environment desc`, [ids.app])).rows;
  const prdUrlMon = mons.find(m => m.environment === 'PRD' && m.managed_by === 'app-url');
  assert.equal(prdUrlMon?.target, `${BASE}/health`);
  assert.equal(prdUrlMon?.interval_sec, 10);
  assert.equal(prdUrlMon?.expected_status_code, 200);
  assert.equal(mons.filter(m => m.managed_by === 'app-ssl').length, 0, 'no TLS monitor for http:// URLs');
});

test('application: validation rejects bad input', async () => {
  const base = { name: 'Bad', codeName: 'bad-app', prdServerId: ids.prd, drServerId: ids.dr };
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ ...base, prdUrl: 'not a url' }, /PRD URL/],
    [{ ...base, prdUrl: 'ftp://x.example.com' }, /https:\/\//],
    [{ ...base, loadBalancer: { accountId: 'xyz', hostname: 'a.example.com', prdPoolId: 'b'.repeat(32), drPoolId: 'c'.repeat(32) } }, /Account ID/],
    [{ ...base, loadBalancer: { accountId: 'd'.repeat(32), hostname: 'a.example.com', prdPoolId: '', drPoolId: 'c'.repeat(32) } }, /PRD pool/],
    [{ ...base, loadBalancer: { accountId: 'd'.repeat(32), hostname: 'a.example.com', prdPoolId: 'e'.repeat(32), drPoolId: 'e'.repeat(32) } }, /different/],
    [{ ...base, loadBalancer: { accountId: 'd'.repeat(32), hostname: 'e2e.example.com', prdPoolId: 'f'.repeat(32), drPoolId: '1'.repeat(32) } }, /already mapped/],
    [{ ...base, loadBalancer: { accountId: 'd'.repeat(32), hostname: 'z.example.com', prdPoolId: '2'.repeat(32), drPoolId: '3'.repeat(32) }, autoFailover: true }, /not available/],
    [{ ...base, rtoTargetMin: 0 }, /RTO/],
    [{ ...base, prdServerId: '00000000-0000-0000-0000-000000000000' }, /PRD server does not exist/],
    [{ ...base, drServerId: ids.prd }, /different servers/],
    [{ ...base, codeName: 'e2e-app' }, /already used/],
    [{ ...base, healthCheck: { intervalSec: 10, timeoutSec: 20 } }, /timeout/i],
  ];
  for (const [body, msg] of cases) {
    const r = await api('POST', '/api/v1/applications', body);
    assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.raw}`);
    assert.match(r.body.message, msg);
  }
});

test('monitoring reads the configured URL from the database and follows edits', async () => {
  // First cycle checks the original PRD URL
  await waitFor(async () => (await one(`select 1 x from ${SCHEMA}.check_results where target = $1 and ok`, [`${BASE}/health`]))?.x);
  const r = await api('PATCH', `/api/v1/applications/${ids.app}`, { prdUrl: `${BASE}/api/health?changed=1` });
  assert.equal(r.status, 200, r.raw);
  const mon = await waitFor(async () => (await one(`select id, target from ${SCHEMA}.monitors where application_id = $1 and environment = 'PRD' and managed_by = 'app-url'`, [ids.app])) as { id: string; target: string } | undefined);
  await waitFor(async () => (await one(`select target from ${SCHEMA}.monitors where id = $1`, [mon.id]))?.target === `${BASE}/api/health?changed=1`);
  // The next monitoring cycle uses the new URL
  const rec = await waitFor(async () => one(`select target, ok, status_code from ${SCHEMA}.check_results where monitor_id = $1 and target = $2 order by t desc limit 1`, [mon.id, `${BASE}/api/health?changed=1`]));
  assert.equal(rec.ok, true);
  assert.equal(rec.status_code, 200);
  assert.equal((await one(`select prd_url from ${SCHEMA}.applications where id = $1`, [ids.app])).prd_url, `${BASE}/api/health?changed=1`);
});

test('application: edit Cloudflare pools persists', async () => {
  const r = await api('PATCH', `/api/v1/applications/${ids.app}`, { loadBalancer: { accountId: 'a'.repeat(32), hostname: 'e2e.example.com', prdPoolId: '4'.repeat(32), drPoolId: '5'.repeat(32) } });
  assert.equal(r.status, 200, r.raw);
  await waitFor(async () => (await one(`select prd_pool_id from ${SCHEMA}.application_load_balancers where application_id = $1`, [ids.app]))?.prd_pool_id === '4'.repeat(32));
  // The Load Balancer poller uses the new mapping
  const lb = await waitFor(async () => { const s = (await api('GET', '/api/v1/loadbalancers')).body.data; return s.pools.some((p: { id: string }) => p.id === '4'.repeat(32)) ? s : null; });
  assert.ok(lb.pools.some((p: { id: string; role: string }) => p.id === '5'.repeat(32) && p.role === 'DR'));
});

test('Cloudflare token never reaches the browser', async () => {
  const pools = await api('GET', `/api/v1/cloudflare/lb-pools?accountId=${'a'.repeat(32)}`);
  assert.notEqual(pools.status, 200, 'fake token cannot list pools');
  const responses = [pools.raw, (await api('GET', '/api/v1/bootstrap')).raw, (await api('GET', '/api/v1/integrations')).raw, (await api('GET', '/api/v1/loadbalancers')).raw, (await api('GET', '/api/v1/audit?pageSize=500')).raw];
  for (const raw of responses) assert.equal(raw.includes(FAKE_CF_TOKEN), false, 'Cloudflare token leaked in an API response');
  const auditRow = await one(`select count(*)::int n from ${SCHEMA}.audit_logs where details like $1`, [`%${FAKE_CF_TOKEN}%`]);
  assert.equal(auditRow.n, 0);
  const anyDb = await one(`select count(*)::int n from ${SCHEMA}.meta where value like $1`, [`%${FAKE_CF_TOKEN}%`]);
  assert.equal(anyDb.n, 0);
  const unauth = await fetch(`${BASE}/api/v1/cloudflare/lb-pools?accountId=${'a'.repeat(32)}`);
  assert.equal(unauth.status, 401);
});

test('restart (browser refresh / server restart): configuration is reloaded from PostgreSQL', async () => {
  await new Promise(r => setTimeout(r, 1500)); // let the write-behind flush
  await stopServer();
  await startServer();
  await login();
  const boot = (await api('GET', '/api/v1/bootstrap')).body.data;
  const app = boot.applications.find((a: { id: string }) => a.id === ids.app);
  assert.equal(app.prdUrl, `${BASE}/api/health?changed=1`);
  assert.equal(app.loadBalancer.prdPoolId, '4'.repeat(32));
  assert.equal(app.rtoTargetMin, 45);
  assert.equal(app.autoFailover, false);
  const srv = boot.servers.find((s: { id: string }) => s.id === ids.prd);
  assert.equal(srv.ip, '192.0.2.11');
  assert.deepEqual([srv.planSpec.cpuCores, srv.planSpec.ramGb, srv.planSpec.diskGb], [16, 64, 800]);
  assert.equal(srv.agentStatus, 'DISCONNECTED', 'no agent → no telemetry is invented');
  assert.equal(srv.lastSeen, '');
});

test('removing a URL removes its managed monitor; deleting the app removes its LB mapping', async () => {
  const r = await api('PATCH', `/api/v1/applications/${ids.app}`, { drUrl: '' });
  assert.equal(r.status, 200, r.raw);
  await waitFor(async () => (await one(`select count(*)::int n from ${SCHEMA}.monitors where application_id = $1 and environment = 'DR' and managed_by is not null`, [ids.app])).n === 0);
  assert.equal((await api('DELETE', `/api/v1/applications/${ids.app}`)).status, 200);
  await waitFor(async () => (await one(`select count(*)::int n from ${SCHEMA}.application_load_balancers where application_id = $1`, [ids.app])).n === 0);
  assert.equal((await one(`select count(*)::int n from ${SCHEMA}.applications where id = $1`, [ids.app])).n, 0);
});

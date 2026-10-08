/**
 * Production-behaviour tests (NODE_ENV=production, real PostgreSQL, throw-away schema):
 * health endpoints, startup without a database, auth / RBAC / lockout, realtime tickets,
 * agent telemetry ingestion, the incident engine, headers, and secrets never reaching logs.
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
const SCHEMA = `ops_prodtest_${process.pid}`;
const PORT = 3990 + (process.pid % 9);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'prod-admin@example.com', password: 'ProdTestPassw0rd!' };
const SECRETS = { cf: 'prodtest-fake-cloudflare-token-9d2e', jwt: 'x'.repeat(16) + 'prodtest-jwt-secret-value-0123456789' };
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-prodtest-'));
const pgc = new pg.Client({ connectionString: DATABASE_URL });
let server: ChildProcess | null = null;
let logs = '';
let token = '';

function spawnServer(extraEnv: Record<string, string> = {}, port = PORT) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR,
      ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, CLOUDFLARE_API_TOKEN: SECRETS.cf, JWT_SECRET: SECRETS.jwt,
      PUBLIC_URL: 'https://ops.test.invalid', HOSTINGER_API_TOKEN: '', DEADMAN_HEARTBEAT_URL: '', LOG_FORMAT: 'json', ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', d => { logs += d; });
  child.stderr?.on('data', d => { logs += d; });
  return child;
}

async function waitReady(base = BASE, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(`${base}/api/health/ready`)).status === 200) return; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`not ready:\n${logs.slice(-2000)}`);
}

async function api<T = any>(method: string, p: string, body?: unknown, auth = token): Promise<{ status: number; body: T; raw: string; headers: Headers }> {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await res.text();
  let parsed: any = null; try { parsed = JSON.parse(raw); } catch { /* not json */ }
  return { status: res.status, body: parsed, raw, headers: res.headers };
}

const one = async (sql: string, params: unknown[] = []) => (await pgc.query(sql, params)).rows[0];
const waitFor = async <T>(fn: () => Promise<T | undefined | null | false>, ms = 20_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 400)); }
};

before(async () => {
  assert.ok(DATABASE_URL, 'DATABASE_URL must be set');
  await pgc.connect();
  server = spawnServer();
  await waitReady();
  const r = await api('POST', '/api/auth/login', ADMIN, '');
  assert.equal(r.status, 200, r.raw);
  token = r.body.data.tokens.accessToken;
});

after(async () => {
  server?.kill();
  await new Promise(r => setTimeout(r, 500));
  await pgc.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  await pgc.end().catch(() => {});
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('health: liveness and readiness', async () => {
  const live = await fetch(`${BASE}/api/health/live`);
  assert.equal(live.status, 200);
  const ready = await (await fetch(`${BASE}/api/health/ready`)).json();
  assert.equal(ready.status, 'ready');
  assert.match(ready.checks.database, /^ok/);
});

test('startup with the database unavailable: process stays up, readiness 503, API 503 (no crash loop)', async () => {
  const port = PORT + 50;
  const child = spawnServer({ DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/none' }, port);
  try {
    let live = 0;
    // Up to 30 s: a freshly spawned tsx process occasionally needs > 10 s to start on a busy machine (flaky before at 10 s)
    for (let i = 0; i < 120 && live !== 200; i++) { try { live = (await fetch(`http://127.0.0.1:${port}/api/health/live`)).status; } catch { /* starting */ } await new Promise(r => setTimeout(r, 250)); }
    assert.equal(live, 200, 'liveness must answer while the database is down');
    const ready = await fetch(`http://127.0.0.1:${port}/api/health/ready`);
    assert.equal(ready.status, 503);
    const apiRes = await fetch(`http://127.0.0.1:${port}/api/v1/bootstrap`);
    assert.equal(apiRes.status, 503);
    await new Promise(r => setTimeout(r, 3000));
    assert.equal(child.exitCode, null, 'process must keep running and retry');
  } finally {
    child.kill();
  }
});

test('auth: bad password rejected, lockout after repeated failures, RBAC enforced', async () => {
  assert.equal((await api('POST', '/api/auth/login', { email: ADMIN.email, password: 'wrong-password' }, '')).status, 401);
  assert.equal((await api('GET', '/api/v1/servers', undefined, '')).status, 401);
  assert.equal((await api('GET', '/api/v1/servers', undefined, 'not-a-token')).status, 401);
  // viewer
  const v = await api('POST', '/api/v1/users', { email: 'viewer@example.com', password: 'ViewerPassw0rd!', fullName: 'Viewer', roleName: 'viewer' });
  assert.equal(v.status, 201, v.raw);
  assert.equal(v.raw.includes('passwordHash'), false);
  const vt = (await api('POST', '/api/auth/login', { email: 'viewer@example.com', password: 'ViewerPassw0rd!' }, '')).body.data.tokens.accessToken;
  assert.equal((await api('GET', '/api/v1/servers', undefined, vt)).status, 200);
  assert.equal((await api('POST', '/api/v1/servers', { hostname: 'x', ip: '192.0.2.99', environment: 'PRD' }, vt)).status, 403);
  assert.equal((await api('GET', '/api/v1/cloudflare/accounts', undefined, vt)).status, 403);
  // lockout (10 failures per account per 15 min)
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await api('POST', '/api/auth/login', { email: 'viewer@example.com', password: 'nope' }, '')).status;
  assert.equal(last, 429);
});

test('realtime: stream needs a one-time ticket; access tokens in the URL are refused', async () => {
  assert.equal((await fetch(`${BASE}/api/v1/realtime/stream`)).status, 401);
  assert.equal((await fetch(`${BASE}/api/v1/realtime/stream?token=${token}`)).status, 401, 'access token in URL must not work');
  const ticket = (await api('POST', '/api/v1/realtime/ticket', {})).body.data.ticket;
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/v1/realtime/stream?ticket=${ticket}`, { signal: ctrl.signal });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: connected/);
  ctrl.abort();
  assert.equal((await fetch(`${BASE}/api/v1/realtime/stream?ticket=${ticket}`)).status, 401, 'tickets are single-use');
});

test('telemetry: only an authenticated agent report updates a server, values are stored as sent', async () => {
  const srv = await api('POST', '/api/v1/servers', { hostname: 'telemetry-test', ip: '192.0.2.50', environment: 'DR' });
  assert.equal(srv.status, 201, srv.raw);
  const id = srv.body.data.id;
  const agentToken = (await one(`select agent_token from ${SCHEMA}.servers where id = $1`, [id])).agent_token as string;
  const report = { observedAt: new Date().toISOString(), cpuPercent: 12.5, ramPercent: 40.2, diskPercent: 55.1, load: [0.5, 0.4, 0.3], memTotalMb: 8000, memUsedMb: 3216, memAvailableMb: 4784, diskTotalGb: 100, diskUsedGb: 55.1, diskFreeGb: 44.9, uptimeSec: 86400, hostname: 'dr-host' };
  const bad = await fetch(`${BASE}/api/v1/agent/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' }, body: JSON.stringify(report) });
  assert.equal(bad.status, 401);
  const malformed = await fetch(`${BASE}/api/v1/agent/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken}` }, body: JSON.stringify({ ...report, cpuPercent: 'lots' }) });
  assert.equal(malformed.status, 400);
  const good = await fetch(`${BASE}/api/v1/agent/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken}` }, body: JSON.stringify(report) });
  assert.equal(good.status, 200);
  const s = (await api('GET', `/api/v1/servers/${id}`)).body.data;
  assert.equal(s.agentStatus, 'CONNECTED');
  assert.equal(s.telemetry.cpuPercent, 12.5);
  assert.equal(s.telemetry.memAvailableMb, 4784);
  assert.equal(s.reportedHostname, 'dr-host');
  assert.equal(JSON.stringify(s).includes(agentToken), false, 'agent token must not be returned');
  await waitFor(async () => (await one(`select state->'telemetry'->>'cpuPercent' c from ${SCHEMA}.servers where id = $1`, [id]))?.c === '12.5');
});

test('telemetry API (agent 3.3): backward-compatible responses, new sections, fleet summaries, validation, no secrets', async () => {
  const cols = (await pgc.query(`select column_name from information_schema.columns where table_schema = $1 and table_name = 'server_metrics'`, [SCHEMA])).rows.map(r => r.column_name);
  for (const c of ['cpu', 'ram', 'disk', 'load1', 'net_in', 'net_out', 'swap', 'iowait', 'steal', 'disk_read', 'disk_write', 'disk_util']) assert.ok(cols.includes(c), `server_metrics.${c}`);

  const srv = await api('POST', '/api/v1/servers', { hostname: 'telemetry33-test', ip: '192.0.2.51', environment: 'PRD' });
  assert.equal(srv.status, 201, srv.raw);
  const id = srv.body.data.id;
  const agentToken = (await one(`select agent_token from ${SCHEMA}.servers where id = $1`, [id])).agent_token as string;
  const secret = 'pm2-env-secret-value-7f3a';
  const report = {
    agentVersion: '3.3.0', observedAt: new Date().toISOString(), sentAt: new Date().toISOString(), lastReportRttMs: 30,
    cpuPercent: 20, ramPercent: 50, diskPercent: 60, load: [1, 1, 1], cpuCores: 2, cpuIowaitPercent: 3, cpuStealPercent: 1,
    swapTotalMb: 1024, swapUsedMb: 100, swapFreeMb: 924, swapPercent: 9.8, pressure: { cpu: 1, memory: 0, io: 2 },
    filesystems: [{ mountPoint: '/', filesystem: 'ext4', device: '/dev/vda1', totalGb: 50, usedGb: 30, freeGb: 20, usedPercent: 60, inodeTotal: 100, inodeUsed: 10, inodeFree: 90, inodePercent: 10 }],
    networkInterfaces: [{ name: 'eth0', rxBytesPerSec: 1, txBytesPerSec: 2, rxPacketsPerSec: 1, txPacketsPerSec: 1, rxErrors: 0, txErrors: 0, rxDrops: 0, txDrops: 0, operationalState: 'up', virtual: false }],
    diskIo: [{ device: 'vda', readBytesPerSec: 10, writeBytesPerSec: 20, readOpsPerSec: 1, writeOpsPerSec: 2, ioUtilizationPercent: 5, readLatencyMs: 1, writeLatencyMs: 1 }],
    pm2: [{ id: 0, name: 'app', status: 'online', pid: 5, cpuPercent: 1, memoryMb: 50, restartCount: 0, ports: [4100], env: { TOKEN: secret }, DB_PASSWORD: secret }],
    listeningPorts: [], appChecks: [], failedUnits: { count: 0, units: [] },
    ntp: { synchronized: true, ntpEnabled: true, service: 'systemd-timesyncd', clockOffsetMs: 1.5, clockDriftPpm: null },
    system: { kernelVersion: '6.8.0', architecture: 'x86_64', bootTime: '2026-10-01T00:00:00Z', timezone: 'UTC', osName: 'Ubuntu', osVersion: '24.04', nodeVersion: '22.11.0', npmVersion: '10.9.0' },
  };
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${BASE}/api/v1/agent/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken}`, ...headers }, body: JSON.stringify(body) });

  const good = await post(report);
  assert.equal(good.status, 200);
  const ack = await good.json() as { data: { accepted: boolean; serverId: string; appChecks: unknown[] } };
  assert.equal(ack.data.accepted, true);
  assert.ok(Array.isArray(ack.data.appChecks), 'ingest response lists the local health checks for the agent');

  // Malformed sections are rejected, oversized reports refused, clock skew still enforced
  assert.equal((await post({ ...report, pm2: 'everything' })).status, 400);
  assert.equal((await post({ ...report, ntp: ['x'] })).status, 400);
  assert.equal((await post({ ...report, filesystems: { '/': 1 } })).status, 400);
  assert.equal((await post({ ...report, pm2: null, listeningPorts: null, ntp: null, failedUnits: null })).status, 200, 'null = source not available');
  assert.equal((await post({ ...report, logs: [{ message: 'x'.repeat(600 * 1024) }] })).status, 413);
  const skewed = await post({ ...report, observedAt: new Date(Date.now() - 3600_000).toISOString() });
  assert.equal(skewed.status, 400);
  assert.match(await skewed.text(), /NTP/);
  assert.equal((await post(report)).status, 200);

  const s = await api('GET', `/api/v1/servers/${id}`);
  const d = s.body.data;
  for (const k of ['id', 'hostname', 'ip', 'environment', 'status', 'agentStatus', 'agentVersion', 'lastSeen', 'telemetry', 'processes', 'services', 'logs']) assert.ok(k in d, k);
  for (const k of ['cpuPercent', 'ramPercent', 'diskPercent', 'loadAvg', 'networkInKbps', 'networkOutKbps', 'observedAt', 'receivedAt']) assert.ok(k in d.telemetry, `telemetry.${k}`);
  assert.equal(d.telemetry.swapPercent, 9.8);
  assert.equal(d.telemetry.cpuIowaitPercent, 3);
  assert.equal(d.filesystems[0].inodePercent, 10);
  assert.equal(d.system.kernelVersion, '6.8.0');
  assert.equal(d.ntp.service, 'systemd-timesyncd');
  assert.equal(d.pm2[0].name, 'app');
  assert.equal('env' in d.pm2[0], false);
  assert.equal(s.raw.includes(secret), false, 'PM2 environment never reaches the API');
  assert.equal(s.raw.includes(agentToken), false);
  assert.equal(d.agent.expectedVersion, '3.3.0');
  assert.equal(d.agent.outdated, false);
  assert.ok(Array.isArray(d.health) && d.health.length >= 10);
  assert.ok(Array.isArray(d.warnings));

  const list = await api('GET', '/api/v1/servers');
  assert.ok(Array.isArray(list.body.data) && list.body.data.some((x: { id: string }) => x.id === id));

  const agents = await api('GET', '/api/v1/health/agents');
  assert.ok(Array.isArray(agents.body.data), 'data keeps its list shape');
  const row = agents.body.data.find((r: { serverId: string }) => r.serverId === id);
  for (const k of ['serverId', 'hostname', 'ip', 'environment', 'state', 'version', 'lastSeen', 'startedAt', 'restartCount', 'errors']) assert.ok(k in row, k);
  assert.equal(row.state, 'ONLINE');
  assert.equal(row.outdated, false);
  assert.equal(agents.body.summary.expectedVersion, '3.3.0');
  assert.ok(agents.body.summary.total >= 1 && agents.body.summary.connected >= 1);

  const dbs = await api('GET', '/api/v1/health/databases');
  assert.ok(Array.isArray(dbs.body.data));
  for (const k of ['total', 'healthy', 'warning', 'critical', 'unavailable', 'notConfigured']) assert.equal(typeof dbs.body.summary[k], 'number', k);

  const metrics = await api('GET', `/api/v1/servers/${id}/metrics?range=1h`);
  assert.ok(metrics.body.data.length >= 1);
  assert.equal(metrics.body.data.at(-1).swap, 9.8);
  assert.equal(metrics.body.data.at(-1).diskUtil, 5);
});

test('incident engine: a real failing check opens an incident in PostgreSQL and recovery resolves it', async () => {
  const m = await api('POST', '/api/v1/monitors', { name: 'prodtest status', type: 'HTTP', target: `${BASE}/api/health/live`, environment: 'PRD', intervalSec: 600, timeoutSec: 5, retries: 1, failureConfirmationThreshold: 2, recoveryConfirmationThreshold: 1, expectedStatusCode: 418 });
  assert.equal(m.status, 201, m.raw);
  const id = m.body.data.id;
  await new Promise(r => setTimeout(r, 1500));
  for (let i = 0; i < 3; i++) await api('POST', `/api/v1/monitors/${id}/probe`, {});
  const inc = await waitFor(async () => one(`select id, status, details->'context'->>'probeStatus' p, details->'context'->>'responseCode' code from ${SCHEMA}.incidents where fingerprint = $1`, [`monitor:${id}`]));
  assert.equal(inc.status, 'OPEN');
  assert.equal(inc.p, 'DOWN');
  assert.equal(inc.code, '200');
  await api('PATCH', `/api/v1/monitors/${id}`, { expectedStatusCode: 200 });
  await new Promise(r => setTimeout(r, 1000));
  for (let i = 0; i < 2; i++) await api('POST', `/api/v1/monitors/${id}/probe`, {});
  await waitFor(async () => (await one(`select status from ${SCHEMA}.incidents where id = $1`, [inc.id]))?.status === 'RESOLVED');
});

test('production headers, no stack traces, unknown routes', async () => {
  const page = await fetch(`${BASE}/`);
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal((await api('GET', '/api/v1/servers')).headers.get('cache-control'), 'no-store');
  const badJson = await fetch(`${BASE}/api/v1/servers`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{not json' });
  const text = await badJson.text();
  assert.equal(badJson.status, 400);
  assert.equal(/\bat \w+ \(/.test(text), false, 'no stack trace in responses');
  assert.equal((await api('GET', '/api/v1/does-not-exist')).status, 404);
});

test('rate limiting: API requests above the per-IP limit get 429', async () => {
  const port = PORT + 70;
  const child = spawnServer({ API_RATE_LIMIT_PER_MIN: '10' }, port);
  try {
    await waitReady(`http://127.0.0.1:${port}`);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await fetch(`http://127.0.0.1:${port}/api/v1/servers`)).status);
    assert.ok(statuses.slice(0, 10).every(s => s === 401), 'first requests reach auth');
    assert.equal(statuses[11], 429);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health/live`)).status, 200, 'health endpoints are not rate limited');
  } finally {
    child.kill();
  }
});

test('graceful shutdown: pending data saved, connections closed, exit code 0', async () => {
  const port = PORT + 60;
  let out = '';
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR, JWT_SECRET: SECRETS.jwt, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, LOG_FORMAT: 'json', CLOUDFLARE_API_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout?.on('data', d => { out += d; });
  child.stderr?.on('data', d => { out += d; });
  await waitReady(`http://127.0.0.1:${port}`);
  const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
  child.send('shutdown'); // what PM2 sends with shutdown_with_message (SIGINT/SIGTERM take the same path)
  const code = await Promise.race([exited, new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 10_000))]);
  assert.equal(code, 0, `expected clean exit, got ${code}\n${out.slice(-1500)}`);
  assert.match(out, /shutdown complete/);
});

test('dead-man heartbeat end-to-end: real pings, HEALTHY status via API, URL never in API / logs, clean shutdown', async () => {
  let hits = 0;
  const wd = (await import('node:http')).createServer((_q, r) => { hits++; r.end('OK'); });
  await new Promise<void>(r => wd.listen(0, '127.0.0.1', () => r()));
  const secretPath = 'ping/7a6b5c4d-e2e-secret-uuid-0042';
  const secretQs = 'e2e-heartbeat-token-value';
  const url = `http://127.0.0.1:${(wd.address() as { port: number }).port}/${secretPath}?token=${secretQs}`;
  const port = PORT + 70;
  let out = '';
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR, JWT_SECRET: SECRETS.jwt, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, LOG_FORMAT: 'json', CLOUDFLARE_API_TOKEN: '', DEADMAN_HEARTBEAT_URL: url, DEADMAN_INTERVAL_SEC: '10', DEADMAN_TOLERANCE_SEC: '30' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout?.on('data', d => { out += d; });
  child.stderr?.on('data', d => { out += d; });
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitReady(base);
    const login = await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN) })).json() as { data: { tokens: { accessToken: string } } };
    const get = async (p: string) => { const r = await fetch(base + p, { headers: { Authorization: `Bearer ${login.data.tokens.accessToken}` } }); return { status: r.status, raw: await r.text() }; };
    const st = await waitFor(async () => {
      const r = await get('/api/v1/deadman/status');
      const d = JSON.parse(r.raw).data;
      return d.status === 'HEALTHY' ? d : null;
    });
    assert.ok(hits >= 1, 'the watchdog received a ping');
    assert.equal(st.configured, true);
    assert.equal(st.workerRunning, true);
    assert.equal(st.intervalSec, 10);
    assert.equal(st.toleranceSec, 30);
    assert.equal(st.consecutiveFailures, 0);
    assert.equal(typeof st.lastLatencyMs, 'number');
    assert.ok(st.lastSuccessAt && st.lastAttemptAt);
    for (const p of ['/api/v1/deadman/status', '/api/v1/bootstrap', '/api/v1/integrations', '/api/v1/system/summary', '/api/health', '/api/v1/reports/daily']) {
      const r = await get(p);
      assert.ok(r.status < 500, `${p} → ${r.status}`);
      for (const s of [secretPath, secretQs, url]) assert.equal(r.raw.includes(s), false, `${p} exposes the heartbeat URL`);
    }
    const integ = JSON.parse((await get('/api/v1/integrations')).raw).data.deadMan;
    assert.deepEqual(Object.keys(integ).sort(), ['configError', 'configured', 'intervalSec', 'toleranceSec']);
    const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
    child.send('shutdown');
    const code = await Promise.race([exited, new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 10_000))]);
    assert.equal(code, 0, `clean exit expected, got ${code}`);
    for (const s of [secretPath, secretQs, url]) assert.equal(out.includes(s), false, 'heartbeat URL in the logs');
    assert.match(out, /heartbeat to 127\.0\.0\.1 every 10s/);
  } finally {
    if (child.exitCode === null) child.kill();
    wd.close();
  }
});

test('logs are structured JSON and contain no secrets', async () => {
  await new Promise(r => setTimeout(r, 500));
  const lines = logs.split('\n').filter(l => l.startsWith('{'));
  assert.ok(lines.length > 3, 'expected JSON log lines');
  for (const l of lines.slice(0, 50)) { const j = JSON.parse(l); assert.ok(j.ts && j.level && j.service === 'scholario-ops' && j.msg); }
  for (const secret of [ADMIN.password, 'ViewerPassw0rd!', SECRETS.cf, SECRETS.jwt, token]) assert.equal(logs.includes(secret), false, 'a secret appeared in the logs');
  const agentTokens = (await pgc.query(`select agent_token from ${SCHEMA}.servers`)).rows.map(r => r.agent_token as string);
  for (const t of agentTokens) assert.equal(logs.includes(t), false, 'an agent token appeared in the logs');
});

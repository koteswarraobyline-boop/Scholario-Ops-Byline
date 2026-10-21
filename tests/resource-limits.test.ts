/**
 * Resource limits against a throw-away schema in scholario_ops_ui_test.
 *   npm run test:local -- tests/resource-limits.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { pinTestDatabaseUrl, assertConnectedToTestDatabase, dropVerifiedTestSchema } from './helpers/test-db-guard.ts';

const DATABASE_URL = pinTestDatabaseUrl();
const SCHEMA = `ops_res_${process.pid}`;
const PORT = 4600 + (process.pid % 80);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'res-admin@example.com', password: 'ResTestPassw0rd!' };
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-res-'));

let server: ChildProcess | null = null;
let token = '';
const pgc = new pg.Client({ connectionString: DATABASE_URL });

async function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: {
      ...process.env, DATABASE_URL, PORT: String(PORT), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR,
      NODE_ENV: 'production', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password,
      CLOUDFLARE_API_TOKEN: '', HOSTINGER_API_TOKEN: '', DEADMAN_HEARTBEAT_URL: '', RESOURCE_STALE_SEC: '1',
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

async function api(method: string, p: string, body?: unknown, bearer = token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null, raw };
}

const one = async (sql: string, params: unknown[] = []) => (await pgc.query(sql, params)).rows[0];

let verified = false;
before(async () => {
  await pgc.connect();
  await assertConnectedToTestDatabase(pgc);
  verified = true;
  await startServer();
  const login = await api('POST', '/api/auth/login', ADMIN, '');
  assert.equal(login.status, 200, login.raw);
  token = login.body.data.tokens.accessToken;
});

after(async () => {
  await stopServer();
  await dropVerifiedTestSchema(verified, () => pgc.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {}));
  await pgc.end().catch(() => {});
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('migration stores the resource table and a server plan becomes three limits with no invented usage', async () => {
  const table = await one(`select to_regclass($1) as name`, [`${SCHEMA}.resource_limits`]);
  assert.ok(table.name);
  const srv = await api('POST', '/api/v1/servers', { hostname: 'cap-prd', ip: '192.0.2.40', environment: 'PRD', plan: 'KVM 4', planCpuCores: 4, planRamGb: 16, planDiskGb: 200 });
  assert.equal(srv.status, 201, srv.raw);
  const listed = await api('GET', '/api/v1/resources?serverId=' + srv.body.data.id);
  assert.equal(listed.status, 200, listed.raw);
  const rows = listed.body.data as Array<{ kind: string; capacity: number; unit: string; source: string; usage: number | null; evaluation: { state: string } }>;
  assert.deepEqual(rows.map(r => r.kind).sort(), ['CPU', 'MEMORY', 'SERVER_DISK']);
  assert.equal(rows.every(r => r.usage === null && r.evaluation.state === 'UNKNOWN' && r.source === 'manual'), true);
  const disk = rows.find(r => r.kind === 'SERVER_DISK')!;
  assert.equal(disk.capacity, 200);
  assert.equal(disk.unit, 'GB');
  const stored = await one(`select count(*)::int n from ${SCHEMA}.resource_limits where server_id = $1 and usage is null`, [srv.body.data.id]);
  assert.equal(stored.n, 3);
});

test('a registry user count does not become a seat limit', async () => {
  const reg = await api('POST', '/api/v1/registry', { kind: 'APPLICATION', name: 'Seat check', owner: 'Academic IT', tier: 'TIER_2', userCount: 80 });
  assert.equal(reg.status, 201, reg.raw);
  const seats = await api('GET', '/api/v1/resources?kind=SEATS');
  assert.equal(seats.body.data.length, 0);
  assert.equal(seats.body.pagination.total, 0);
});

test('seats, storage boundaries, idempotent measure, auth, and recovery', async () => {
  assert.equal((await api('POST', '/api/v1/resources', { kind: 'SEATS', name: 'x', owner: 'x', unit: 'seats', capacity: 10 }, '')).status, 401);
  const viewer = await api('POST', '/api/v1/users', { email: 'res-viewer@example.com', password: 'ViewerPassw0rd!', fullName: 'Viewer', roleName: 'viewer' });
  assert.equal(viewer.status, 201, viewer.raw);
  const vLogin = await api('POST', '/api/auth/login', { email: 'res-viewer@example.com', password: 'ViewerPassw0rd!' }, '');
  const viewerToken = vLogin.body.data.tokens.accessToken as string;
  assert.equal((await api('POST', '/api/v1/resources', { kind: 'SEATS', name: 'Nope', owner: 'x', unit: 'seats', capacity: 10 }, viewerToken)).status, 403);
  assert.equal((await api('GET', '/api/v1/resources', undefined, viewerToken)).status, 200);

  const bad = await api('POST', '/api/v1/resources', { kind: 'STORAGE', name: 'Bad', owner: 'Ops', unit: 'seats', capacity: 10 });
  assert.equal(bad.status, 400, bad.raw);
  const zero = await api('POST', '/api/v1/resources', { kind: 'STORAGE', name: 'Zero', owner: 'Ops', unit: 'GiB', capacity: 0 });
  assert.equal(zero.status, 400, zero.raw);

  const storage = await api('POST', '/api/v1/resources', {
    kind: 'STORAGE', name: 'Course media', owner: 'Academic IT', unit: 'GiB', capacity: 100,
    warningValue: 85, criticalValue: 95, source: 'manual',
  });
  assert.equal(storage.status, 201, storage.raw);
  const id = storage.body.data.id as string;
  const measure = (usage: number, extra: Record<string, unknown> = {}) => api('POST', `/api/v1/resources/${id}/measure`, { usage, ...extra });
  assert.equal((await measure(80)).body.data.evaluation.state, 'NORMAL');
  assert.equal((await measure(85)).body.data.evaluation.state, 'WARNING');
  assert.equal((await measure(84)).body.data.evaluation.state, 'WARNING');
  assert.equal((await measure(82)).body.data.evaluation.state, 'NORMAL');
  assert.equal((await measure(95)).body.data.evaluation.state, 'CRITICAL');
  assert.equal((await measure(101)).body.data.evaluation.state, 'EXCEEDED');
  const again = await measure(101, { measurementId: 'same-sample' });
  const replay = await measure(101, { measurementId: 'same-sample' });
  assert.equal(replay.body.data.idempotent, true);
  assert.equal(replay.body.data.updatedAt, again.body.data.updatedAt);
  const old = await measure(50, { measuredAt: '2020-01-01T00:00:00.000Z' });
  assert.equal(old.status, 409, old.raw);

  const open = await api('GET', '/api/v1/incidents?pageSize=100');
  const firing = (open.body.data as Array<{ fingerprint: string; status: string; severity: string; owner: string }>).find(i => i.fingerprint === `resource-limit:${id}` && i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  assert.ok(firing, 'one open capacity incident');
  assert.equal(firing!.severity, 'CRITICAL');
  assert.equal(firing!.owner, 'Academic IT');

  assert.equal((await measure(10)).body.data.evaluation.state, 'NORMAL');
  const after = await api('GET', `/api/v1/resources/${id}`);
  const resolved = (after.body.data.alerts as Array<{ status: string }>).some(i => i.status === 'RESOLVED');
  assert.equal(resolved, true);

  const quota = await api('POST', '/api/v1/resources', {
    kind: 'API_QUOTA', name: 'Public API', owner: 'Platform', unit: 'requests', capacity: 10000, quotaWindow: 'hour', warningValue: 80, criticalValue: 100,
  });
  assert.equal(quota.status, 201, quota.raw);
  const wrongWindow = await api('POST', `/api/v1/resources/${quota.body.data.id}/measure`, { usage: 100, window: 'day' });
  assert.equal(wrongWindow.status, 400, wrongWindow.raw);
  assert.match(wrongWindow.body.message, /hour/);
});

test('a server infrastructure monitor override yields to a resource threshold', async () => {
  const srv = await api('POST', '/api/v1/servers', { hostname: 'cap-override', ip: '192.0.2.41', environment: 'PRD', plan: 'KVM 2', planCpuCores: 2, planRamGb: 8, planDiskGb: 100 });
  assert.equal(srv.status, 201, srv.raw);
  const mon = await api('POST', '/api/v1/monitors', {
    name: 'cpu override', type: 'INFRA_CPU', serverId: srv.body.data.id, environment: 'PRD', intervalSec: 60, timeoutSec: 10,
    warningThresholdMs: 95, criticalThresholdMs: 99,
  });
  assert.equal(mon.status, 201, mon.raw);
  const list = await api('GET', '/api/v1/resources?serverId=' + srv.body.data.id + '&kind=CPU');
  const cpu = list.body.data[0];
  const measured = await api('POST', `/api/v1/resources/${cpu.id}/measure`, { usage: 1.8 });
  assert.equal(measured.status, 200, measured.raw);
  assert.equal(measured.body.data.evaluation.thresholdFrom, 'monitor');
  assert.equal(measured.body.data.evaluation.state, 'NORMAL');
  const patched = await api('PATCH', `/api/v1/resources/${cpu.id}`, { warningValue: 80, criticalValue: 90 });
  assert.equal(patched.status, 200, patched.raw);
  assert.equal(patched.body.data.evaluation.thresholdFrom, 'resource');
  assert.equal(patched.body.data.evaluation.state, 'CRITICAL');
});

test('a stale measurement does not clear an open capacity incident or become zero', async () => {
  const created = await api('POST', '/api/v1/resources', {
    kind: 'DATABASE_CONNECTIONS', name: 'LMS connections', owner: 'DBA', unit: 'connections', capacity: 100, warningValue: 80, criticalValue: 90,
  });
  assert.equal(created.status, 201, created.raw);
  const id = created.body.data.id as string;
  const hot = await api('POST', `/api/v1/resources/${id}/measure`, { usage: 96 });
  assert.equal(hot.body.data.evaluation.state, 'CRITICAL');
  await new Promise(r => setTimeout(r, 1200));
  const evaluated = await api('POST', '/api/v1/resources/evaluate');
  const row = (evaluated.body.data as Array<{ id: string; usage: number; evaluation: { state: string } }>).find(r => r.id === id);
  assert.equal(row?.usage, 96);
  assert.equal(row?.evaluation.state, 'STALE');
  const detail = await api('GET', `/api/v1/resources/${id}`);
  const stillOpen = (detail.body.data.alerts as Array<{ status: string }>).some(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  assert.equal(stillOpen, true);
});

test('severity steps down on one incident, disable resolves, delete closes, and measurements are stored once', async () => {
  const history = await one(`select to_regclass($1) as name`, [`${SCHEMA}.resource_measurements`]);
  assert.ok(history.name);

  const viewer = await api('POST', '/api/v1/users', { email: 'res-viewer2@example.com', password: 'ViewerPassw0rd!', fullName: 'Viewer Two', roleName: 'viewer' });
  assert.equal(viewer.status, 201, viewer.raw);
  const viewerToken = (await api('POST', '/api/auth/login', { email: 'res-viewer2@example.com', password: 'ViewerPassw0rd!' }, '')).body.data.tokens.accessToken as string;
  const operator = await api('POST', '/api/v1/users', { email: 'res-operator@example.com', password: 'OperatorPassw0rd!', fullName: 'Operator', roleName: 'operator' });
  assert.equal(operator.status, 201, operator.raw);
  const operatorToken = (await api('POST', '/api/auth/login', { email: 'res-operator@example.com', password: 'OperatorPassw0rd!' }, '')).body.data.tokens.accessToken as string;

  const created = await api('POST', '/api/v1/resources', {
    kind: 'STORAGE', name: 'Lifecycle disk', owner: 'Platform', unit: 'GB', capacity: 100,
    warningValue: 85, criticalValue: 95, source: 'manual',
  });
  assert.equal(created.status, 201, created.raw);
  const id = created.body.data.id as string;
  const measure = (usage: number, extra: Record<string, unknown> = {}) => api('POST', `/api/v1/resources/${id}/measure`, { usage, ...extra });

  assert.equal((await measure(-1)).status, 400);
  assert.equal((await api('POST', `/api/v1/resources/${id}/measure`, { usage: 'nope' })).status, 400);
  assert.equal((await measure(10)).status, 200);
  assert.equal((await api('POST', `/api/v1/resources/${id}/measure`, { usage: 10 }, viewerToken)).status, 403);

  const openOf = async () => {
    const list = await api('GET', '/api/v1/incidents?pageSize=500');
    return (list.body.data as Array<{ id: string; fingerprint: string; status: string; severity: string; timeline: Array<{ message: string }> }>)
      .filter(i => i.fingerprint === `resource-limit:${id}` && i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  };

  assert.equal((await measure(96)).body.data.evaluation.state, 'CRITICAL');
  let open = await openOf();
  assert.equal(open.length, 1);
  assert.equal(open[0].severity, 'HIGH');
  const incidentId = open[0].id;
  const timelineBefore = open[0].timeline.length;
  await api('POST', '/api/v1/resources/evaluate');
  await api('POST', '/api/v1/resources/evaluate');
  open = await openOf();
  assert.equal(open.length, 1);
  assert.equal(open[0].id, incidentId);
  assert.equal(open[0].timeline.length, timelineBefore);

  assert.equal((await measure(101)).body.data.evaluation.state, 'EXCEEDED');
  open = await openOf();
  assert.equal(open.length, 1);
  assert.equal(open[0].id, incidentId);
  assert.equal(open[0].severity, 'CRITICAL');

  assert.equal((await measure(96)).body.data.evaluation.state, 'CRITICAL');
  open = await openOf();
  assert.equal(open.length, 1);
  assert.equal(open[0].id, incidentId);
  assert.equal(open[0].severity, 'HIGH');
  assert.equal(open[0].timeline.some(e => e.message.startsWith('Reduced to HIGH')), true);

  assert.equal((await measure(90)).body.data.evaluation.state, 'WARNING');
  open = await openOf();
  assert.equal(open.length, 1);
  assert.equal(open[0].severity, 'WARNING');
  assert.equal(open[0].timeline.some(e => e.message.startsWith('Reduced to WARNING')), true);

  const off = await api('PATCH', `/api/v1/resources/${id}`, { enabled: false });
  assert.equal(off.status, 200, off.raw);
  assert.equal((await openOf()).length, 0);
  const resolved = await api('GET', `/api/v1/incidents/${incidentId}`);
  assert.equal(resolved.body.data.status, 'RESOLVED');

  const sample = await api('POST', '/api/v1/resources', {
    kind: 'STORAGE', name: 'History disk', owner: 'Platform', unit: 'GB', capacity: 100, warningValue: 85, criticalValue: 95,
  });
  const sampleId = sample.body.data.id as string;
  assert.equal((await api('POST', `/api/v1/resources/${sampleId}/measure`, { usage: 40, measuredAt: '2026-10-21T10:00:00.000Z', measurementId: 'hist-1' })).status, 200);
  assert.equal((await api('POST', `/api/v1/resources/${sampleId}/measure`, { usage: 50, measuredAt: '2026-10-21T10:05:00.000Z', measurementId: 'hist-2' })).status, 200);
  const replay = await api('POST', `/api/v1/resources/${sampleId}/measure`, { usage: 80, measuredAt: '2026-10-21T10:10:00.000Z', measurementId: 'hist-2' });
  assert.equal(replay.body.data.idempotent, true);
  const detail = await api('GET', `/api/v1/resources/${sampleId}`);
  const points = detail.body.data.measurements as Array<{ usage: number; alertState: string }>;
  assert.deepEqual(points.map(p => p.usage), [50, 40]);
  const stored = await one(`select count(*)::int n from ${SCHEMA}.resource_measurements where resource_id = $1`, [sampleId]);
  assert.equal(stored.n, 2);

  const doomed = await api('POST', '/api/v1/resources', {
    kind: 'SEATS', name: 'Licence', owner: 'Academic IT', unit: 'seats', capacity: 10, warningValue: 90, criticalValue: 100,
  });
  const doomedId = doomed.body.data.id as string;
  assert.equal((await api('POST', `/api/v1/resources/${doomedId}/measure`, { usage: 11 })).body.data.evaluation.state, 'EXCEEDED');
  assert.equal((await api('DELETE', `/api/v1/resources/${doomedId}`, undefined, operatorToken)).status, 403);
  assert.equal((await api('DELETE', `/api/v1/resources/${doomedId}`, undefined, viewerToken)).status, 403);
  const removed = await api('DELETE', `/api/v1/resources/${doomedId}`);
  assert.equal(removed.status, 200, removed.raw);
  const closed = await api('GET', '/api/v1/incidents?pageSize=500');
  const gone = (closed.body.data as Array<{ fingerprint: string; status: string }>).find(i => i.fingerprint === `resource-limit:${doomedId}`);
  assert.equal(gone?.status, 'CLOSED');
  const leftover = await one(`select count(*)::int n from ${SCHEMA}.resource_measurements where resource_id = $1`, [doomedId]);
  assert.equal(leftover.n, 0);
});

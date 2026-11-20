/**
 * Dependency API: create, retrieve, update, delete, Hard and Soft classification,
 * invalid application references, duplicate relationships, authorization, and errors.
 *
 * Throw-away schema in scholario_ops_ui_test only. Dropped afterwards.
 *   npm run test:local -- tests/dependency-api.test.ts
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
const SCHEMA = `ops_depapi_${process.pid}`;
const PORT = 4700 + (process.pid % 70);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'dep-admin@example.com', password: 'DepTestPassw0rd!' };
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-depapi-'));

let server: ChildProcess | null = null;
let token = '';
let serverLog = '';
const pgc = new pg.Client({ connectionString: DATABASE_URL });

async function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: {
      ...process.env, DATABASE_URL, PORT: String(PORT), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR, NODE_ENV: 'production',
      ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, CLOUDFLARE_API_TOKEN: '', HOSTINGER_API_TOKEN: '', DEADMAN_HEARTBEAT_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverLog = '';
  server.stdout?.on('data', d => { serverLog += d; });
  server.stderr?.on('data', d => { serverLog += d; });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`server did not start:\n${serverLog}`);
}

async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>(resolve => { s.once('exit', () => resolve()); s.kill('SIGTERM'); setTimeout(() => { s.kill('SIGKILL'); resolve(); }, 8000); });
}

async function api<T = any>(method: string, p: string, body?: unknown, as = token): Promise<{ status: number; body: T; raw: string }> {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: `Bearer ${as}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null, raw };
}

async function loginAs(cred: { email: string; password: string }) {
  const r = await api('POST', '/api/auth/login', cred, '');
  assert.equal(r.status, 200, r.raw);
  return r.body.data.tokens.accessToken as string;
}

const rows = async (sql: string, params: unknown[] = []) => (await pgc.query(sql, params)).rows;
const waitFor = async (fn: () => Promise<boolean>, what: string, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn().catch(() => false)) return; await new Promise(r => setTimeout(r, 300)); }
  throw new Error(`timed out: ${what}`);
};

const id: Record<string, string> = {};
const upper = (value: string) => value.toUpperCase();

let verified = false;
before(async () => {
  await pgc.connect();
  await assertConnectedToTestDatabase(pgc);
  verified = true;
  await startServer();
  token = await loginAs(ADMIN);
});

after(async () => {
  await stopServer();
  await dropVerifiedTestSchema(verified, () => pgc.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {}));
  await pgc.end().catch(() => {});
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('dependency creation, retrieval, update, deletion, classification, and errors', { timeout: 120_000 }, async (t) => {
  const expectError = async (method: string, path: string, body: unknown, status: number, message: RegExp, as = token) => {
    const r = await api(method, path, body, as);
    assert.equal(r.status, status, `${method} ${path} ${JSON.stringify(body)} → ${r.raw}`);
    assert.equal(r.body.success, false);
    assert.equal(r.body.code, status === 409 ? 'CONFLICT' : status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : status === 401 ? 'UNAUTHORIZED' : 'VALIDATION');
    assert.match(r.body.message, message);
    assert.equal(r.body.data, undefined);
    return r;
  };

  await t.test('creates a Hard link and a Soft link and returns them', async () => {
    const prd = await api('POST', '/api/v1/servers', { hostname: 'dep-prd', ip: '192.0.2.70', environment: 'PRD' });
    assert.equal(prd.status, 201, prd.raw);
    id.srv = prd.body.data.id;
    const app = await api('POST', '/api/v1/applications', { name: 'Portal', codeName: 'dep-portal', tier: 'TIER_1', prdServerId: id.srv });
    assert.equal(app.status, 201, app.raw);
    id.app = app.body.data.id;
    const other = await api('POST', '/api/v1/applications', { name: 'Exams', codeName: 'dep-exams', tier: 'TIER_2' });
    assert.equal(other.status, 201, other.raw);
    id.otherApp = other.body.data.id;

    const component = async (key: string, body: Record<string, unknown>) => {
      const r = await api('POST', '/api/v1/registry', body);
      assert.equal(r.status, 201, `${key}: ${r.raw}`);
      id[key] = r.body.data.id;
    };
    await component('portal', { kind: 'APPLICATION', name: 'Portal', owner: 'Academic IT', tier: 'TIER_1', applicationId: id.app });
    await component('exams', { kind: 'APPLICATION', name: 'Exams', owner: 'Exam office', tier: 'TIER_2', applicationId: id.otherApp });
    await component('tutor', { kind: 'BUSINESS_FEATURE', name: 'AI Tutor', owner: 'Product', tier: 'TIER_2', applicationId: id.app, userCount: 40 });
    await component('otherFeature', { kind: 'BUSINESS_FEATURE', name: 'Marking', owner: 'Exam office', tier: 'TIER_2', applicationId: id.otherApp });
    await component('db', { kind: 'DATABASE', name: 'Portal DB', owner: 'DBA', tier: 'TIER_1' });
    await component('media', { kind: 'STORAGE', name: 'Course media', owner: 'Academic IT', tier: 'TIER_2' });
    await component('openai', { kind: 'THIRD_PARTY_API', name: 'OpenAI', owner: 'Product', tier: 'TIER_3' });
    await component('host', { kind: 'SERVER', name: 'dep-prd', owner: 'Infrastructure', tier: 'TIER_1', serverId: id.srv });

    const hard = await api('POST', '/api/v1/dependency-links', {
      fromId: `  ${upper(id.portal)}  `, toId: upper(id.db), type: 'HARD', method: ' DATABASE ',
      criticality: ' HIGH ', failureBehaviour: ' Sign-in stops ', owner: ' DBA ', notes: ' Login needs the database ',
    });
    assert.equal(hard.status, 201, hard.raw);
    assert.equal(hard.body.success, true);
    assert.equal(hard.body.data.fromId, id.portal);
    assert.equal(hard.body.data.toId, id.db);
    assert.equal(hard.body.data.type, 'HARD');
    assert.equal(hard.body.data.method, 'DATABASE');
    assert.equal(hard.body.data.criticality, 'HIGH');
    assert.equal(hard.body.data.failureBehaviour, 'Sign-in stops');
    assert.equal(hard.body.data.notes, 'Login needs the database');
    assert.equal(hard.body.data.featureId, null);
    assert.equal(hard.body.data.createdAt, hard.body.data.updatedAt);
    id.hard = hard.body.data.id;

    const soft = await api('POST', '/api/v1/dependency-links', {
      fromId: id.portal, toId: id.media, type: 'SOFT', notes: 'Lessons still open without media',
    });
    assert.equal(soft.status, 201, soft.raw);
    assert.equal(soft.body.data.type, 'SOFT');
    assert.equal(soft.body.data.method, null);
    id.soft = soft.body.data.id;

    const featured = await api('POST', '/api/v1/dependency-links', {
      fromId: id.portal, toId: id.openai, type: 'SOFT', featureId: id.tutor, method: 'API', notes: 'Tutor calls the API',
    });
    assert.equal(featured.status, 201, featured.raw);
    assert.equal(featured.body.data.type, 'SOFT');
    assert.equal(featured.body.data.featureId, id.tutor);
    id.featured = featured.body.data.id;

    const reverse = await api('POST', '/api/v1/dependency-links', { fromId: id.db, toId: id.portal, type: 'SOFT' });
    assert.equal(reverse.status, 201, reverse.raw);
    id.reverse = reverse.body.data.id;

    const sameEndsOtherFeature = await api('POST', '/api/v1/dependency-links', {
      fromId: id.portal, toId: id.db, type: 'SOFT', featureId: id.tutor,
    });
    assert.equal(sameEndsOtherFeature.status, 201, sameEndsOtherFeature.raw);
    id.byFeature = sameEndsOtherFeature.body.data.id;

    const listed = await api('GET', '/api/v1/dependency-links');
    assert.equal(listed.status, 200, listed.raw);
    assert.equal(listed.body.success, true);
    const ids = (listed.body.data as Array<{ id: string }>).map(row => row.id);
    assert.ok(ids.includes(id.hard));
    assert.ok(ids.includes(id.soft));
    assert.ok(ids.includes(id.featured));

    const one = await api('GET', `/api/v1/dependency-links/${upper(id.hard)}`);
    assert.equal(one.status, 200, one.raw);
    assert.equal(one.body.data.id, id.hard);
    assert.equal(one.body.data.type, 'HARD');
    assert.equal(one.body.data.fromId, id.portal);

    const detail = await api('GET', `/api/v1/applications/${id.app}`);
    assert.equal(detail.status, 200, detail.raw);
    const outgoing = detail.body.data.serviceDependencies.outgoing as Array<{ id: string; type: string; otherApplicationId: string | null; featureName: string | null }>;
    assert.equal(outgoing.find(l => l.id === id.hard)?.type, 'HARD');
    assert.equal(outgoing.find(l => l.id === id.soft)?.type, 'SOFT');
    assert.equal(outgoing.find(l => l.id === id.featured)?.featureName, 'AI Tutor');
    const incoming = detail.body.data.serviceDependencies.incoming as Array<{ id: string }>;
    assert.ok(incoming.some(l => l.id === id.reverse));
    const applicationLevel = detail.body.data.serviceDependencies.applicationLevel as Array<{ id: string }>;
    assert.deepEqual(applicationLevel.map(l => l.id), [id.hard, id.soft]);
    assert.equal(detail.body.data.dependencies.some((d: { id: string }) => d.id === id.hard), false);

    const list = (await api('GET', '/api/v1/applications')).body.data as Array<{ id: string; serviceDependencies?: unknown }>;
    assert.equal(list.find(a => a.id === id.app)?.serviceDependencies, undefined);

    await waitFor(async () => (await rows(`select link_type from ${SCHEMA}.dependency_links where id = $1`, [id.hard]))[0]?.link_type === 'HARD', 'hard link stored');
    assert.equal((await rows(`select link_type from ${SCHEMA}.dependency_links where id = $1`, [id.soft]))[0].link_type, 'SOFT');
  });

  await t.test('updates classification and detail fields and rejects a blank end', async () => {
    const before = (await api('GET', `/api/v1/dependency-links/${id.soft}`)).body.data;
    await new Promise(r => setTimeout(r, 5));
    const edited = await api('PATCH', `/api/v1/dependency-links/${upper(id.soft)}`, {
      type: 'HARD', method: 'EMBED', notes: 'Lessons fail without media', criticality: 'MEDIUM',
      failureBehaviour: 'The player shows an error', recoveryExpectation: 'Restore the bucket',
    });
    assert.equal(edited.status, 200, edited.raw);
    assert.equal(edited.body.success, true);
    assert.equal(edited.body.data.type, 'HARD');
    assert.equal(edited.body.data.method, 'EMBED');
    assert.equal(edited.body.data.notes, 'Lessons fail without media');
    assert.equal(edited.body.data.criticality, 'MEDIUM');
    assert.equal(edited.body.data.failureBehaviour, 'The player shows an error');
    assert.equal(edited.body.data.recoveryExpectation, 'Restore the bucket');
    assert.equal(edited.body.data.fromId, id.portal);
    assert.equal(edited.body.data.toId, id.media);
    assert.equal(edited.body.data.createdAt, before.createdAt);
    assert.notEqual(edited.body.data.updatedAt, before.updatedAt);

    const kept = await api('PATCH', `/api/v1/dependency-links/${id.soft}`, { type: 'SOFT' });
    assert.equal(kept.status, 200, kept.raw);
    assert.equal(kept.body.data.type, 'SOFT');
    assert.equal(kept.body.data.notes, 'Lessons fail without media');
    assert.equal(kept.body.data.method, 'EMBED');
    assert.equal(kept.body.data.createdAt, before.createdAt);

    const cleared = await api('PATCH', `/api/v1/dependency-links/${id.soft}`, { method: '   ' });
    assert.equal(cleared.status, 200, cleared.raw);
    assert.equal(cleared.body.data.method, null);
    assert.equal(cleared.body.data.type, 'SOFT');

    await expectError('PATCH', `/api/v1/dependency-links/${id.soft}`, { fromId: '   ', type: 'HARD' }, 400, /Choose what depends/);
    await expectError('PATCH', `/api/v1/dependency-links/${id.soft}`, { toId: null, notes: 'should not save' }, 400, /Choose what it depends on/);
    const unchanged = (await api('GET', `/api/v1/dependency-links/${id.soft}`)).body.data;
    assert.equal(unchanged.type, 'SOFT');
    assert.equal(unchanged.fromId, id.portal);
    assert.equal(unchanged.toId, id.media);
    assert.equal(unchanged.notes, 'Lessons fail without media');

    await expectError('PATCH', `/api/v1/dependency-links/${id.hard}`, { type: 'MAYBE' }, 400, /Type must be one of/);
    await expectError('PATCH', `/api/v1/dependency-links/${id.hard}`, { type: 'hard' }, 400, /Type must be one of/);
    assert.equal((await api('GET', `/api/v1/dependency-links/${id.hard}`)).body.data.type, 'HARD');
  });

  await t.test('rejects invalid application references and duplicate relationships', async () => {
    const before = (await api('GET', '/api/v1/dependency-links')).body.data.length as number;
    const cases: Array<[Record<string, unknown>, number, RegExp]> = [
      [{ fromId: id.app, toId: id.db, type: 'HARD' }, 400, /application's register entry/],
      [{ fromId: upper(id.app), toId: id.db, type: 'HARD' }, 400, /application's register entry/],
      [{ fromId: id.portal, toId: id.srv, type: 'HARD' }, 400, /server's register entry/],
      [{ fromId: id.portal, toId: id.portal, type: 'HARD' }, 400, /cannot depend on itself/],
      [{ fromId: id.portal, toId: '00000000-0000-4000-8000-000000000000', type: 'HARD' }, 400, /not in the register/],
      [{ fromId: id.portal, toId: id.host, type: 'HARD' }, 400, /Hosting is recorded on the application/],
      [{ fromId: id.portal, toId: id.media, type: 'SOFT', featureId: id.app }, 400, /That id is an application/],
      [{ fromId: id.portal, toId: id.media, type: 'SOFT', featureId: id.otherFeature }, 400, /belong to the consumer application/],
      [{ fromId: id.portal, toId: id.db, type: 'SOFT' }, 409, /already depends on/],
      [{ fromId: upper(id.portal), toId: upper(id.db), type: 'SOFT', method: 'HTTP' }, 409, /already depends on/],
      [{ fromId: id.portal, toId: id.db, type: 'HARD', criticality: 'LOW' }, 409, /already depends on/],
      [{ toId: id.db, type: 'HARD' }, 400, /Choose what depends/],
      [{ fromId: id.portal, type: 'SOFT' }, 400, /Choose what it depends on/],
      [{ fromId: id.portal, toId: id.media, type: 'soft' }, 400, /Type must be one of/],
      [{ fromId: 12, toId: id.db, type: 'HARD' }, 400, /must be an id/],
      [{ fromId: id.portal, toId: id.openai, type: 'HARD', notes: 'password=hunter2' }, 400, /password or token/],
      [{ fromId: id.portal, toId: id.openai, type: 'HARD', failureBehaviour: 'x'.repeat(501) }, 400, /at most 500/],
      [{ fromId: id.portal, toId: id.openai, type: 'HARD', applicationId: id.app }, 400, /does not take an application id/],
    ];
    for (const [body, status, message] of cases) {
      await expectError('POST', '/api/v1/dependency-links', body, status, message);
    }
    const badShape = await api('POST', '/api/v1/dependency-links', ['not-an-object']);
    assert.equal(badShape.status, 400, badShape.raw);
    assert.equal(badShape.body.code, 'VALIDATION');
    assert.match(badShape.body.message, /JSON object/);
    const invalidJson = await fetch(`${BASE}/api/v1/dependency-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: '{',
    });
    const invalidBody = await invalidJson.json();
    assert.equal(invalidJson.status, 400);
    assert.equal(invalidBody.code, 'VALIDATION');
    assert.match(invalidBody.message, /not valid JSON/);
    assert.equal((await api('GET', '/api/v1/dependency-links')).body.data.length, before);

    const moved = await api('PATCH', `/api/v1/dependency-links/${id.reverse}`, { toId: id.db });
    assert.equal(moved.status, 400, moved.raw);
    assert.match(moved.body.message, /cannot depend on itself/);
    assert.equal((await api('GET', `/api/v1/dependency-links/${id.reverse}`)).body.data.toId, id.portal);
    assert.equal((await api('GET', `/api/v1/dependency-links/${id.reverse}`)).body.data.fromId, id.db);
    const clash = await api('PATCH', `/api/v1/dependency-links/${id.soft}`, { toId: id.db, featureId: null });
    assert.equal(clash.status, 409, clash.raw);
    assert.match(clash.body.message, /already depends on/);
    assert.equal((await api('GET', `/api/v1/dependency-links/${id.soft}`)).body.data.toId, id.media);
  });

  await t.test('classifies Hard as a stop and Soft as degraded, including after an update', async () => {
    const impact = async (componentId: string) => {
      const r = await api('GET', `/api/v1/registry/${componentId}/impact`);
      assert.equal(r.status, 200, r.raw);
      return Object.fromEntries((r.body.data.affected as Array<{ id: string; via: string }>).map(row => [row.id, row.via]));
    };
    assert.equal((await impact(id.db))[id.portal], 'HARD');
    assert.equal((await impact(id.media))[id.portal], 'SOFT');

    const stopped = await api('PATCH', `/api/v1/dependency-links/${id.soft}`, { type: 'HARD' });
    assert.equal(stopped.status, 200, stopped.raw);
    assert.equal((await impact(id.media))[id.portal], 'HARD');
    const degraded = await api('PATCH', `/api/v1/dependency-links/${id.soft}`, { type: 'SOFT' });
    assert.equal(degraded.status, 200, degraded.raw);
    assert.equal((await impact(id.media))[id.portal], 'SOFT');

    const featureHit = await impact(id.openai);
    assert.equal(featureHit[id.tutor], 'HARD');
    assert.equal(featureHit[id.portal], undefined);

    await waitFor(async () => (await rows(`select link_type from ${SCHEMA}.dependency_links where id = $1`, [id.soft]))[0]?.link_type === 'SOFT', 'soft classification stored');
    assert.equal((await rows(`select link_type from ${SCHEMA}.dependency_links where id = $1`, [id.hard]))[0].link_type, 'HARD');
  });

  await t.test('a deleted application leaves the link and clears the application reference', async () => {
    const removed = await api('DELETE', `/api/v1/applications/${id.otherApp}`);
    assert.equal(removed.status, 200, removed.raw);
    const gone = await api('GET', `/api/v1/applications/${id.otherApp}`);
    assert.equal(gone.status, 404, gone.raw);
    assert.equal(gone.body.code, 'NOT_FOUND');
    const exams = (await api('GET', '/api/v1/registry')).body.data.components.find((c: { id: string }) => c.id === id.exams);
    assert.equal(exams.applicationId, null);
    const still = await api('POST', '/api/v1/dependency-links', { fromId: id.portal, toId: id.exams, type: 'SOFT' });
    assert.equal(still.status, 201, still.raw);
    id.unbound = still.body.data.id;
    const view = (await api('GET', `/api/v1/applications/${id.app}`)).body.data.serviceDependencies.outgoing as Array<{ id: string; otherApplicationId: string | null }>;
    assert.equal(view.find(l => l.id === id.unbound)?.otherApplicationId, null);
    const read = await api('GET', `/api/v1/dependency-links/${id.unbound}`);
    assert.equal(read.status, 200, read.raw);
    assert.equal(read.body.data.toId, id.exams);
  });

  await t.test('authorization follows the platform roles', async () => {
    const anon = await api('GET', '/api/v1/dependency-links', undefined, '');
    assert.equal(anon.status, 401, anon.raw);
    assert.equal(anon.body.code, 'UNAUTHORIZED');
    assert.match(anon.body.message, /Authentication required/);
    const bad = await api('GET', `/api/v1/dependency-links/${id.hard}`, undefined, 'not-a-token');
    assert.equal(bad.status, 401, bad.raw);
    assert.equal(bad.body.code, 'UNAUTHORIZED');
    await expectError('POST', '/api/v1/dependency-links', { fromId: id.portal, toId: id.media, type: 'HARD' }, 401, /Authentication required/, '');

    const viewerUser = await api('POST', '/api/v1/users', { email: 'dep-viewer@example.com', password: 'DepViewerPassw0rd!', fullName: 'Dep Viewer', roleName: 'viewer' });
    assert.equal(viewerUser.status, 201, viewerUser.raw);
    const viewer = await loginAs({ email: 'dep-viewer@example.com', password: 'DepViewerPassw0rd!' });
    assert.equal((await api('GET', '/api/v1/dependency-links', undefined, viewer)).status, 200);
    assert.equal((await api('GET', `/api/v1/dependency-links/${id.hard}`, undefined, viewer)).status, 200);
    assert.equal((await api('GET', `/api/v1/applications/${id.app}`, undefined, viewer)).status, 200);
    assert.equal((await api('GET', `/api/v1/dependency-links/${id.app}`, undefined, viewer)).status, 404);
    await expectError('POST', '/api/v1/dependency-links', { fromId: id.portal, toId: id.media, type: 'HARD' }, 403, /it_administrator/, viewer);
    await expectError('PATCH', `/api/v1/dependency-links/${id.hard}`, { type: 'SOFT' }, 403, /it_administrator/, viewer);
    await expectError('DELETE', `/api/v1/dependency-links/${id.hard}`, undefined, 403, /it_administrator/, viewer);
    assert.equal((await api('GET', `/api/v1/dependency-links/${id.hard}`)).body.data.type, 'HARD');

    const operatorUser = await api('POST', '/api/v1/users', { email: 'dep-operator@example.com', password: 'DepOperatorPassw0rd!', fullName: 'Dep Operator', roleName: 'operator' });
    assert.equal(operatorUser.status, 201, operatorUser.raw);
    const operator = await loginAs({ email: 'dep-operator@example.com', password: 'DepOperatorPassw0rd!' });
    assert.equal((await api('GET', '/api/v1/dependency-links', undefined, operator)).status, 200);
    const opWrite = await api('POST', '/api/v1/dependency-links', { fromId: id.portal, toId: id.openai, type: 'HARD' }, operator);
    assert.equal(opWrite.status, 403, opWrite.raw);
    assert.equal(opWrite.body.code, 'FORBIDDEN');
    assert.match(opWrite.body.message, /it_administrator/);
    assert.equal((await api('DELETE', `/api/v1/dependency-links/${id.soft}`, undefined, operator)).status, 403);

    const itUser = await api('POST', '/api/v1/users', { email: 'dep-it@example.com', password: 'DepItAdminPassw0rd!', fullName: 'Dep IT', roleName: 'it_administrator' });
    assert.equal(itUser.status, 201, itUser.raw);
    const it = await loginAs({ email: 'dep-it@example.com', password: 'DepItAdminPassw0rd!' });
    const created = await api('POST', '/api/v1/dependency-links', { fromId: id.exams, toId: id.db, type: 'HARD', method: 'DATABASE' }, it);
    assert.equal(created.status, 201, created.raw);
    id.itLink = created.body.data.id;
    const edited = await api('PATCH', `/api/v1/dependency-links/${id.itLink}`, { type: 'SOFT', notes: 'Exams can wait' }, it);
    assert.equal(edited.status, 200, edited.raw);
    assert.equal(edited.body.data.type, 'SOFT');
    assert.equal(edited.body.data.method, 'DATABASE');
    const removed = await api('DELETE', `/api/v1/dependency-links/${upper(id.itLink)}`, undefined, it);
    assert.equal(removed.status, 200, removed.raw);
    assert.equal(removed.body.data.deleted, true);
    assert.equal((await api('GET', `/api/v1/dependency-links/${id.itLink}`, undefined, it)).status, 404);
  });

  await t.test('deletes one relationship and leaves the others', async () => {
    const missing = await api('DELETE', '/api/v1/dependency-links/00000000-0000-4000-8000-000000000000');
    assert.equal(missing.status, 404, missing.raw);
    assert.equal(missing.body.code, 'NOT_FOUND');
    assert.match(missing.body.message, /Dependency link not found/);
    assert.equal((await api('GET', '/api/v1/dependency-links/00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await api('PATCH', '/api/v1/dependency-links/00000000-0000-4000-8000-000000000000', { type: 'SOFT' })).status, 404);

    const before = (await api('GET', '/api/v1/dependency-links')).body.data as Array<{ id: string }>;
    const del = await api('DELETE', `/api/v1/dependency-links/${upper(id.soft)}`);
    assert.equal(del.status, 200, del.raw);
    assert.equal(del.body.success, true);
    assert.equal(del.body.data.deleted, true);
    const gone = await api('GET', `/api/v1/dependency-links/${id.soft}`);
    assert.equal(gone.status, 404, gone.raw);
    const after = (await api('GET', '/api/v1/dependency-links')).body.data as Array<{ id: string }>;
    assert.equal(after.length, before.length - 1);
    assert.ok(!after.some(row => row.id === id.soft));
    assert.ok(after.some(row => row.id === id.hard));
    const portal = (await api('GET', '/api/v1/registry')).body.data.components.find((c: { id: string }) => c.id === id.portal);
    assert.equal(portal.name, 'Portal');
    assert.equal((await api('GET', `/api/v1/applications/${id.app}`)).status, 200);
    await waitFor(async () => (await rows(`select count(*)::int n from ${SCHEMA}.dependency_links where id = $1`, [id.soft]))[0].n === 0, 'soft link removed');
    assert.equal((await rows(`select count(*)::int n from ${SCHEMA}.dependency_links where id = $1`, [id.hard]))[0].n, 1);
    assert.equal((await rows(`select count(*)::int n from ${SCHEMA}.applications where id = $1`, [id.app]))[0].n, 1);
  });
});

/**
 * Dependency register end to end on sample data: components (applications, servers, databases,
 * storage, third-party APIs, providers, business features) with owner and tier, "A depends on B"
 * links (hard/soft, the feature that needs it), who is affected, PostgreSQL storage and reload.
 *
 * Runs a real server against a throw-away schema (ops_regtest_<pid>) in scholario_ops_ui_test
 * only (tests/helpers/test-db-guard.ts refuses anything else) and drops it afterwards.
 *   npm run test:local -- tests/dependency-register.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { pinTestDatabaseUrl, assertConnectedToTestDatabase, dropVerifiedTestSchema } from './helpers/test-db-guard.ts';

// Before anything else: no .env fallback, nothing but scholario_ops_ui_test
const DATABASE_URL = pinTestDatabaseUrl();
const SCHEMA = `ops_regtest_${process.pid}`;
const PORT = 4400 + (process.pid % 90);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'reg-admin@example.com', password: 'RegTestPassw0rd!' };
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-regtest-'));

let server: ChildProcess | null = null;
let token = '';
/** Output of the current server process */
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
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: `Bearer ${as}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null, raw };
}

async function loginAs(cred: { email: string; password: string }) {
  const r = await api('POST', '/api/auth/login', cred, '');
  assert.equal(r.status, 200, r.raw);
  return r.body.data.tokens.accessToken as string;
}

const rows = async (sql: string, params: unknown[] = []) => (await pgc.query(sql, params)).rows;
const by = (impact: { affected: Array<{ id: string; via: string }> }) => Object.fromEntries(impact.affected.map(a => [a.id, a.via]));
const impactOf = async (cid: string) => {
  const r = await api('GET', `/api/v1/registry/${cid}/impact`);
  assert.equal(r.status, 200, r.raw);
  return r.body.data;
};
const waitFor = async (fn: () => Promise<boolean>, what: string, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn().catch(() => false)) return; await new Promise(r => setTimeout(r, 300)); }
  throw new Error(`timed out: ${what}`);
};

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

const id: Record<string, string> = {};
const create = async (key: string, body: Record<string, unknown>) => {
  const r = await api('POST', '/api/v1/registry', body);
  assert.equal(r.status, 201, `${key}: ${r.raw}`);
  id[key] = r.body.data.id;
  return r.body.data;
};
const link = async (key: string, body: Record<string, unknown>) => {
  const r = await api('POST', '/api/v1/dependency-links', body);
  assert.equal(r.status, 201, `${key}: ${r.raw}`);
  id[key] = r.body.data.id;
  return r.body.data;
};

test('migration 007 creates the register tables', async () => {
  const t = await rows(`select table_name from information_schema.tables where table_schema = $1 and table_name in ('registry_components', 'dependency_links') order by 1`, [SCHEMA]);
  assert.deepEqual(t.map(r => r.table_name), ['dependency_links', 'registry_components']);
  assert.equal((await rows(`select 1 from ${SCHEMA}.schema_migrations where name = '007_dependency_register.sql'`)).length, 1);
});

test('every kind can be registered with an owner and a tier', async () => {
  const prd = await api('POST', '/api/v1/servers', { hostname: 'reg-prd', ip: '192.0.2.40', environment: 'PRD' });
  const dr = await api('POST', '/api/v1/servers', { hostname: 'reg-dr', ip: '192.0.2.41', environment: 'DR' });
  assert.equal(prd.status, 201, prd.raw); assert.equal(dr.status, 201, dr.raw);
  id.srvPrd = prd.body.data.id; id.srvDr = dr.body.data.id;
  const app = await api('POST', '/api/v1/applications', { name: 'Learning Platform', codeName: 'lms', tier: 'TIER_1', prdServerId: id.srvPrd, drServerId: id.srvDr });
  assert.equal(app.status, 201, app.raw);
  id.appRecord = app.body.data.id;

  const lp = await create('lp', { kind: 'APPLICATION', name: 'Learning Platform', owner: 'Academic IT', tier: 'TIER_1', applicationId: id.appRecord, userCount: 1200, served: ['Students', 'Teachers', ' students ', ''] });
  assert.deepEqual(lp.served, ['Students', 'Teachers'], 'trimmed, blanks and case-insensitive duplicates dropped');
  assert.equal(lp.applicationId, id.appRecord);
  await create('tutor', { kind: 'BUSINESS_FEATURE', name: 'AI Tutor', owner: 'Product', tier: 'TIER_2', applicationId: id.appRecord, userCount: 300, served: ['Students'] });
  await create('exams', { kind: 'BUSINESS_FEATURE', name: 'Online exams', owner: 'Exam office', tier: 'TIER_1', userCount: 900, served: ['Students', 'Exam office'] });
  await create('db', { kind: 'DATABASE', name: 'LMS Postgres', owner: 'DBA team', tier: 'TIER_1', description: 'Primary database' });
  await create('media', { kind: 'STORAGE', name: 'Course media bucket', owner: 'Academic IT', tier: 'TIER_2' });
  await create('openai', { kind: 'THIRD_PARTY_API', name: 'OpenAI API', owner: 'Product', tier: 'TIER_3' });
  await create('cf', { kind: 'PROVIDER', name: 'Cloudflare', owner: 'Infrastructure', tier: 'TIER_1' });
  const srv = await create('srv', { kind: 'SERVER', name: 'reg-prd', owner: 'Infrastructure', tier: 'TIER_1', serverId: id.srvPrd });
  assert.equal(srv.serverId, id.srvPrd);
  assert.equal(srv.userCount, null);
  assert.deepEqual(srv.served, []);

  const list = (await api('GET', '/api/v1/registry')).body.data;
  assert.equal(list.components.length, 8);
  assert.deepEqual([...new Set(list.components.map((c: { kind: string }) => c.kind))].sort(),
    ['APPLICATION', 'BUSINESS_FEATURE', 'DATABASE', 'PROVIDER', 'SERVER', 'STORAGE', 'THIRD_PARTY_API']);
});

test('invalid register entries are refused with a clear message', async () => {
  const cases: Array<[Record<string, unknown>, number, RegExp]> = [
    [{ kind: 'DATABASE', name: 'No owner', tier: 'TIER_1' }, 400, /Owner is required/],
    [{ kind: 'DATABASE', name: 'Bad tier', owner: 'x', tier: 'GOLD' }, 400, /Tier must be one of/],
    [{ kind: 'QUEUE', name: 'Bad kind', owner: 'x', tier: 'TIER_1' }, 400, /Kind must be one of/],
    [{ kind: 'DATABASE', name: 'Counted db', owner: 'x', tier: 'TIER_1', userCount: 5 }, 400, /User counts are recorded for applications and business features only/],
    [{ kind: 'PROVIDER', name: 'Served provider', owner: 'x', tier: 'TIER_1', served: ['Students'] }, 400, /Teams or customers served/],
    [{ kind: 'APPLICATION', name: 'Negative', owner: 'x', tier: 'TIER_1', userCount: -1 }, 400, /User count must be a whole number/],
    [{ kind: 'SERVER', name: 'ghost', owner: 'x', tier: 'TIER_1', serverId: '00000000-0000-4000-8000-000000000000' }, 400, /Server not found/],
    [{ kind: 'APPLICATION', name: 'Ghost app', owner: 'x', tier: 'TIER_1', applicationId: '00000000-0000-4000-8000-000000000000' }, 400, /Application not found/],
    [{ kind: 'APPLICATION', name: 'Server as app', owner: 'x', tier: 'TIER_1', applicationId: id.srvPrd }, 400, /That id is a server/],
    [{ kind: 'DATABASE', name: 'db with app', owner: 'x', tier: 'TIER_1', applicationId: id.appRecord }, 400, /Only applications and business features/],
    [{ kind: 'DATABASE', name: 'linked db', owner: 'x', tier: 'TIER_1', serverId: id.srvPrd }, 400, /Only servers can be linked/],
    [{ kind: 'DATABASE', name: 'lms postgres', owner: 'x', tier: 'TIER_1' }, 409, /already registered/],
    [{ kind: 'APPLICATION', name: 'Second LP entry', owner: 'x', tier: 'TIER_1', applicationId: id.appRecord }, 409, /application is already in the register/],
  ];
  for (const [body, status, msg] of cases) {
    const r = await api('POST', '/api/v1/registry', body);
    assert.equal(r.status, status, `${JSON.stringify(body)} → ${r.raw}`);
    assert.match(r.body.message, msg);
  }
  // The same name under another kind is a different thing
  await create('cfApi', { kind: 'THIRD_PARTY_API', name: 'Cloudflare', owner: 'Infrastructure', tier: 'TIER_2' });
  const kindChange = await api('PATCH', `/api/v1/registry/${id.db}`, { kind: 'STORAGE' });
  assert.equal(kindChange.status, 400, kindChange.raw);
  assert.match(kindChange.body.message, /Kind cannot be changed/);
});

test('"A depends on B" links with type and the feature that needs it', async () => {
  await link('lpDb', { fromId: id.lp, toId: id.db, type: 'HARD' });
  const hosting = await api('POST', '/api/v1/dependency-links', { fromId: id.lp, toId: id.srv, type: 'HARD' });
  assert.equal(hosting.status, 400, hosting.raw);
  assert.match(hosting.body.message, /Hosting is recorded on the application/);
  assert.match(hosting.body.message, /production server/);
  const featureHosting = await api('POST', '/api/v1/dependency-links', { fromId: id.tutor, toId: id.srv, type: 'SOFT' });
  assert.equal(featureHosting.status, 400, featureHosting.raw);
  assert.match(featureHosting.body.message, /Hosting is recorded on the application/);
  const drComp = await api('POST', '/api/v1/registry', { kind: 'SERVER', name: 'reg-dr', owner: 'Infrastructure', tier: 'TIER_2', serverId: id.srvDr });
  assert.equal(drComp.status, 201, drComp.raw);
  const drHosting = await api('POST', '/api/v1/dependency-links', { fromId: id.lp, toId: drComp.body.data.id, type: 'SOFT' });
  assert.equal(drHosting.status, 400, drHosting.raw);
  assert.match(drHosting.body.message, /recovery server/);
  assert.equal((await api('DELETE', `/api/v1/registry/${drComp.body.data.id}`)).status, 200);
  await link('dbSrv', { fromId: id.db, toId: id.srv, type: 'HARD', notes: 'Database runs on the PRD VPS' });
  await link('lpCf', { fromId: id.lp, toId: id.cf, type: 'HARD' });
  await link('lpMedia', { fromId: id.lp, toId: id.media, type: 'SOFT' });
  const l = await link('lpAi', { fromId: id.lp, toId: id.openai, type: 'SOFT', featureId: id.tutor, method: ' API ', notes: 'Tutor calls the API' });
  assert.equal(l.featureId, id.tutor);
  assert.equal(l.fromId, id.lp);
  assert.equal(l.toId, id.openai);
  assert.equal(l.type, 'SOFT');
  assert.equal(l.method, 'API');
  assert.equal(l.notes, 'Tutor calls the API');
  assert.equal(l.createdAt, l.updatedAt);

  const listed = await api('GET', '/api/v1/dependency-links');
  assert.equal(listed.status, 200, listed.raw);
  assert.equal(listed.body.success, true);
  assert.ok(listed.body.data.some((row: { id: string }) => row.id === id.lpAi));

  const one = await api('GET', `/api/v1/dependency-links/${id.lpAi}`);
  assert.equal(one.status, 200, one.raw);
  assert.equal(one.body.success, true);
  assert.equal(one.body.data.id, id.lpAi);
  assert.equal(one.body.data.fromId, id.lp);
  assert.equal(one.body.data.toId, id.openai);
  assert.equal(one.body.data.type, 'SOFT');
  assert.equal(one.body.data.featureId, id.tutor);

  const missing = await api('GET', '/api/v1/dependency-links/00000000-0000-4000-8000-000000000000');
  assert.equal(missing.status, 404, missing.raw);
  assert.equal(missing.body.success, false);
  assert.match(missing.body.message, /Dependency link not found/);
  const anon = await api('GET', '/api/v1/dependency-links', undefined, '');
  assert.equal(anon.status, 401, anon.raw);
  assert.equal(anon.body.success, false);
  assert.equal(anon.body.code, 'UNAUTHORIZED');
  assert.match(anon.body.message, /Authentication required/);
  await link('examsDb', { fromId: id.exams, toId: id.db, type: 'HARD' });
  await link('tutorAi', { fromId: id.tutor, toId: id.openai, type: 'HARD' });

  const cases: Array<[Record<string, unknown>, number, RegExp]> = [
    [{ fromId: id.lp, toId: id.lp, type: 'HARD' }, 400, /cannot depend on itself/],
    [{ fromId: id.lp, toId: '00000000-0000-4000-8000-000000000000', type: 'HARD' }, 400, /not in the register/],
    [{ fromId: id.appRecord, toId: id.db, type: 'HARD' }, 400, /application's register entry/],
    [{ fromId: id.lp, toId: id.srvPrd, type: 'HARD' }, 400, /server's register entry/],
    [{ fromId: id.lp, toId: id.db, type: 'MAYBE' }, 400, /Type must be one of/],
    [{ fromId: id.lp, toId: id.db, type: 'HARD', featureId: id.db }, 400, /must be a business feature/],
    [{ fromId: id.lp, toId: id.media, type: 'SOFT', featureId: id.appRecord }, 400, /That id is an application/],
    [{ fromId: id.lp, toId: id.media, type: 'SOFT', featureId: id.srvPrd }, 400, /That id is a server/],
    [{ fromId: id.lp, toId: id.media, type: 'SOFT', featureId: id.exams }, 400, /belong to the consumer application/],
    [{ fromId: id.db, toId: id.media, type: 'SOFT', featureId: id.tutor }, 400, /belong to the consumer application/],
    [{ fromId: id.lp, toId: id.media, type: 'SOFT', notes: 'x'.repeat(501) }, 400, /Notes must be at most 500/],
    [{ fromId: id.lp, toId: id.media, type: 'SOFT', notes: 'password=hunter2' }, 400, /password or token/],
    [{ fromId: id.lp, toId: id.media, type: 'SOFT', applicationId: id.appRecord }, 400, /does not take an application id/],
    [{ fromId: id.tutor, toId: id.db, type: 'SOFT', featureId: id.tutor }, 400, /cannot be A itself/],
    [{ fromId: id.lp, toId: id.tutor, type: 'SOFT', featureId: id.tutor }, 400, /cannot be B itself/],
    [{ fromId: id.lp, toId: id.db, type: 'SOFT' }, 409, /already depends on/],
    [{ fromId: id.lp, toId: id.db, type: 'HARD', method: 'DATABASE' }, 409, /already depends on/],
    [{ fromId: id.exams, toId: id.media, type: 'SOFT', method: 'FTP' }, 400, /Method must be one of/],
    [{ toId: id.db, type: 'HARD' }, 400, /Choose what depends/],
    [{ fromId: id.db, type: 'HARD' }, 400, /Choose what it depends on/],
  ];
  for (const [body, status, msg] of cases) {
    const r = await api('POST', '/api/v1/dependency-links', body);
    assert.equal(r.status, status, `${JSON.stringify(body)} → ${r.raw}`);
    assert.equal(r.body.success, false);
    assert.equal(r.body.code, status === 409 ? 'CONFLICT' : 'VALIDATION');
    assert.match(r.body.message, msg);
    assert.equal(r.body.data, undefined);
  }
  const badShape = await api('POST', '/api/v1/dependency-links', ['not-an-object']);
  assert.equal(badShape.status, 400, badShape.raw);
  assert.equal(badShape.body.code, 'VALIDATION');
  assert.match(badShape.body.message, /JSON object/);

  // Editable: a soft link becomes hard, notes change
  const e = await api('PATCH', `/api/v1/dependency-links/${id.lpMedia}`, { type: 'HARD', notes: 'Lessons fail without media' });
  assert.equal(e.status, 200, e.raw);
  assert.equal(e.body.data.type, 'HARD');
  const back = await api('PATCH', `/api/v1/dependency-links/${id.lpMedia}`, { type: 'SOFT' });
  assert.equal(back.body.data.type, 'SOFT');
  assert.equal(back.body.data.notes, 'Lessons fail without media', 'fields not sent are kept');
  assert.equal(e.body.success, true);

  const missingWrite = await api('PATCH', '/api/v1/dependency-links/00000000-0000-4000-8000-000000000000', { type: 'HARD' });
  assert.equal(missingWrite.status, 404, missingWrite.raw);
  assert.equal(missingWrite.body.success, false);
  assert.equal(missingWrite.body.code, 'NOT_FOUND');
  assert.match(missingWrite.body.message, /Dependency link not found/);
  const missingDelete = await api('DELETE', '/api/v1/dependency-links/00000000-0000-4000-8000-000000000000');
  assert.equal(missingDelete.status, 404, missingDelete.raw);
  assert.equal(missingDelete.body.success, false);

  const beforeMethod = (await api('GET', `/api/v1/dependency-links/${id.lpMedia}`)).body.data;
  await new Promise(r => setTimeout(r, 5));
  const withMethod = await api('PATCH', `/api/v1/dependency-links/${id.lpMedia}`, { method: ' EMBED ' });
  assert.equal(withMethod.status, 200, withMethod.raw);
  assert.equal(withMethod.body.data.method, 'EMBED');
  assert.equal(withMethod.body.data.createdAt, beforeMethod.createdAt);
  assert.notEqual(withMethod.body.data.updatedAt, beforeMethod.updatedAt);
  const cleared = await api('PATCH', `/api/v1/dependency-links/${id.lpMedia}`, { method: '   ' });
  assert.equal(cleared.status, 200, cleared.raw);
  assert.equal(cleared.body.data.method, null);
  assert.equal(cleared.body.data.createdAt, beforeMethod.createdAt);
  const moved = await api('PATCH', `/api/v1/dependency-links/${id.lpCf}`, { toId: id.db });
  assert.equal(moved.status, 409, moved.raw);
  assert.match(moved.body.message, /already depends on/);
  assert.equal((await api('GET', `/api/v1/dependency-links/${id.lpCf}`)).body.data.toId, id.cf);
  const movedHost = await api('PATCH', `/api/v1/dependency-links/${id.lpCf}`, { toId: id.srv });
  assert.equal(movedHost.status, 400, movedHost.raw);
  assert.match(movedHost.body.message, /Hosting is recorded on the application/);
  assert.equal((await api('GET', `/api/v1/dependency-links/${id.lpCf}`)).body.data.toId, id.cf);

  const other = await api('POST', '/api/v1/applications', { name: 'Other Portal', codeName: 'other-portal', tier: 'TIER_2' });
  assert.equal(other.status, 201, other.raw);
  const otherFeature = await api('POST', '/api/v1/registry', { kind: 'BUSINESS_FEATURE', name: 'Other uploads', owner: 'x', tier: 'TIER_2', applicationId: other.body.data.id });
  assert.equal(otherFeature.status, 201, otherFeature.raw);
  const wrongFeature = await api('POST', '/api/v1/dependency-links', { fromId: id.lp, toId: id.media, type: 'SOFT', featureId: otherFeature.body.data.id });
  assert.equal(wrongFeature.status, 400, wrongFeature.raw);
  assert.equal(wrongFeature.body.success, false);
  assert.match(wrongFeature.body.message, /belong to the consumer application/);
  assert.equal((await api('DELETE', `/api/v1/registry/${otherFeature.body.data.id}`)).status, 200);
  assert.equal((await api('DELETE', `/api/v1/applications/${other.body.data.id}`)).status, 200);
});

test('an application record exposes the register dependencies that reference it', async () => {
  const got = await api('GET', `/api/v1/applications/${id.appRecord}`);
  assert.equal(got.status, 200, got.raw);
  assert.equal(got.body.success, true);
  const view = got.body.data.serviceDependencies;
  assert.equal(view.applicationId, id.appRecord);
  assert.equal(view.componentId, id.lp);
  const outgoing = view.outgoing as Array<{ id: string; type: string; method: string | null; otherId: string; otherKind: string; otherApplicationId: string | null; featureId: string | null; featureName: string | null }>;
  const dbLink = outgoing.find(l => l.id === id.lpDb);
  assert.ok(dbLink, 'outgoing hard link to the database');
  assert.equal(dbLink.type, 'HARD');
  assert.equal(dbLink.otherId, id.db);
  assert.equal(dbLink.otherKind, 'DATABASE');
  assert.equal(dbLink.otherApplicationId, null);
  const ai = outgoing.find(l => l.id === id.lpAi);
  assert.equal(ai?.method, 'API');
  assert.equal(ai?.featureId, id.tutor);
  assert.equal(ai?.featureName, 'AI Tutor');
  assert.equal(view.incoming.length, 0);
  const applicationLevel = view.applicationLevel as Array<{ id: string }>;
  assert.deepEqual(applicationLevel.map(l => l.id), [id.lpDb, id.lpCf, id.lpMedia, id.tutorAi]);
  assert.equal(got.body.data.dependencies.some((d: { id: string }) => d.id === id.lpDb), false, 'register links stay out of the monitor dependency list');
  const listed = (await api('GET', '/api/v1/applications')).body.data as Array<{ id: string; serviceDependencies?: unknown }>;
  assert.equal(listed.find(a => a.id === id.appRecord)?.serviceDependencies, undefined, 'the list stays the stored application rows');
  const missing = await api('GET', '/api/v1/applications/00000000-0000-4000-8000-000000000000');
  assert.equal(missing.status, 404, missing.raw);

  const labelled = await api('PATCH', `/api/v1/registry/${id.lp}`, { name: 'Register label' });
  assert.equal(labelled.status, 200, labelled.raw);
  const described = await api('PATCH', `/api/v1/applications/${id.appRecord}`, { description: 'Catalog text only' });
  assert.equal(described.status, 200, described.raw);
  let lp = (await api('GET', '/api/v1/registry')).body.data.components.find((c: { id: string }) => c.id === id.lp);
  assert.equal(lp.name, 'Register label', 'a description edit does not rewrite the register name');
  assert.equal(lp.owner, 'Academic IT');

  const occupied = await api('POST', '/api/v1/registry', { kind: 'APPLICATION', name: 'Occupied Name', owner: 'x', tier: 'TIER_3' });
  assert.equal(occupied.status, 201, occupied.raw);
  const clash = await api('PATCH', `/api/v1/applications/${id.appRecord}`, { name: 'occupied name' });
  assert.equal(clash.status, 409, clash.raw);
  assert.match(clash.body.message, /already in the register/);
  assert.equal((await api('GET', `/api/v1/applications/${id.appRecord}`)).body.data.name, 'Learning Platform');
  assert.equal((await api('DELETE', `/api/v1/registry/${occupied.body.data.id}`)).status, 200);

  const renamed = await api('PATCH', `/api/v1/applications/${id.appRecord}`, { name: 'Learning Platform West', tier: 'TIER_2' });
  assert.equal(renamed.status, 200, renamed.raw);
  lp = (await api('GET', '/api/v1/registry')).body.data.components.find((c: { id: string }) => c.id === id.lp);
  assert.equal(lp.name, 'Learning Platform West');
  assert.equal(lp.tier, 'TIER_2');
  assert.equal(lp.owner, 'Academic IT', 'owner stays on the register');
  const restored = await api('PATCH', `/api/v1/applications/${id.appRecord}`, { name: 'Learning Platform', tier: 'TIER_1', description: '' });
  assert.equal(restored.status, 200, restored.raw);
  lp = (await api('GET', '/api/v1/registry')).body.data.components.find((c: { id: string }) => c.id === id.lp);
  assert.equal(lp.name, 'Learning Platform');
  assert.equal(lp.tier, 'TIER_1');
});

test('who is affected: dependents, hard vs degraded, user counts and teams served', async () => {
  // The PRD server takes down the database, everything on it, the exam feature that needs the
  // database, and AI Tutor, which inherits the outage of the platform that provides it
  const s = (await api('GET', `/api/v1/registry/${id.srv}/impact`)).body.data;
  assert.deepEqual(by(s), { [id.lp]: 'HARD', [id.db]: 'HARD', [id.tutor]: 'HARD', [id.exams]: 'HARD' });
  assert.equal(s.largestUserCountStopped, 1200, 'largest single count (1200, 300 and 900 overlap), not their sum');
  assert.equal(s.largestUserCountAffected, 1200);
  assert.deepEqual(s.served, ['Students', 'Teachers', 'Exam office']);

  // OpenAI is a soft link named on AI Tutor: that feature stops, the platform does not
  const ai = (await api('GET', `/api/v1/registry/${id.openai}/impact`)).body.data;
  assert.deepEqual(by(ai), { [id.tutor]: 'HARD' });
  assert.equal(ai.largestUserCountStopped, 300);
  assert.equal(ai.largestUserCountAffected, 300);

  // Storage degrades the platform, and with it the feature it provides
  const media = (await api('GET', `/api/v1/registry/${id.media}/impact`)).body.data;
  assert.deepEqual(by(media), { [id.lp]: 'SOFT', [id.tutor]: 'SOFT' });
  assert.equal(media.largestUserCountStopped, null, 'nothing that stops has a user count — not reported as 0');
  assert.equal(media.largestUserCountAffected, 1200);
  // Online exams is not provided by a registered application: it inherits nothing
  const exams = (await api('GET', `/api/v1/registry/${id.exams}/impact`)).body.data;
  assert.deepEqual(exams.affected, []);
  assert.equal(exams.largestUserCountStopped, 900, 'its own users');
  assert.equal((await api('GET', '/api/v1/registry/nope/impact')).status, 404);
});

test('stored in PostgreSQL columns, in bootstrap and in the audit log', async () => {
  await waitFor(async () => (await rows(`select count(*)::int n from ${SCHEMA}.dependency_links`))[0].n === 7, 'links flushed');
  const lp = (await rows(`select * from ${SCHEMA}.registry_components where id = $1`, [id.lp]))[0];
  assert.equal(lp.kind, 'APPLICATION');
  assert.equal(lp.owner, 'Academic IT');
  assert.equal(lp.tier, 'TIER_1');
  assert.equal(lp.user_count, 1200);
  assert.deepEqual(lp.served, ['Students', 'Teachers']);
  assert.equal(lp.application_id, id.appRecord);
  const ai = (await rows(`select * from ${SCHEMA}.dependency_links where id = $1`, [id.lpAi]))[0];
  assert.equal(ai.link_type, 'SOFT');
  assert.equal(ai.feature_id, id.tutor);
  // The database refuses what the API refuses
  await assert.rejects(pgc.query(`insert into ${SCHEMA}.dependency_links (id, from_id, to_id, link_type, created_at) values (gen_random_uuid(), $1, $1, 'HARD', now())`, [id.lp]));
  await assert.rejects(pgc.query(`insert into ${SCHEMA}.registry_components (id, kind, name, owner, tier, user_count, created_at, updated_at) values (gen_random_uuid(), 'DATABASE', 'x', 'y', 'TIER_1', 5, now(), now())`));

  const boot = (await api('GET', '/api/v1/bootstrap')).body.data;
  assert.equal(boot.registry.length, 9);
  assert.equal(boot.dependencyLinks.length, 7);
  const audit = (await api('GET', '/api/v1/audit?category=REGISTRY&pageSize=100')).body.data as Array<{ action: string; details: string }>;
  assert.ok(audit.some(a => a.action === 'REGISTRY_COMPONENT_CREATED' && a.details.includes('Learning Platform') && a.details.includes('Academic IT')));
  assert.ok(audit.some(a => a.action === 'DEPENDENCY_LINK_CREATED' && a.details === 'Learning Platform → OpenAI API (SOFT) for AI Tutor'));
  assert.ok(audit.some(a => a.action === 'DEPENDENCY_LINK_UPDATED'));
});

test('dependency writes follow the platform roles: viewer and operator read, IT administrator writes', async () => {
  const u = await api('POST', '/api/v1/users', { email: 'reg-viewer@example.com', password: 'RegViewerPassw0rd!', fullName: 'Reg Viewer', roleName: 'viewer' });
  assert.equal(u.status, 201, u.raw);
  const viewer = await loginAs({ email: 'reg-viewer@example.com', password: 'RegViewerPassw0rd!' });
  assert.equal((await api('GET', '/api/v1/registry', undefined, viewer)).status, 200);
  assert.equal((await api('GET', '/api/v1/dependency-links', undefined, viewer)).status, 200);
  assert.equal((await api('GET', `/api/v1/dependency-links/${id.lpDb}`, undefined, viewer)).status, 200);
  assert.equal((await api('GET', `/api/v1/applications/${id.appRecord}`, undefined, viewer)).status, 200);
  const anonApp = await api('GET', `/api/v1/applications/${id.appRecord}`, undefined, '');
  assert.equal(anonApp.status, 401, anonApp.raw);
  assert.equal(anonApp.body.code, 'UNAUTHORIZED');
  assert.equal(anonApp.body.data, undefined);
  const registerAsApp = await api('GET', `/api/v1/applications/${id.lp}`, undefined, viewer);
  assert.equal(registerAsApp.status, 404, registerAsApp.raw);
  assert.equal(registerAsApp.body.code, 'NOT_FOUND');
  assert.equal(registerAsApp.body.data, undefined);
  const codeAsApp = await api('GET', '/api/v1/applications/lms', undefined, viewer);
  assert.equal(codeAsApp.status, 404, codeAsApp.raw);
  assert.equal(codeAsApp.body.code, 'NOT_FOUND');
  const serverAsApp = await api('GET', `/api/v1/applications/${id.srvPrd}`, undefined, viewer);
  assert.equal(serverAsApp.status, 404, serverAsApp.raw);
  const linkAsApp = await api('GET', `/api/v1/dependency-links/${id.appRecord}`, undefined, viewer);
  assert.equal(linkAsApp.status, 404, linkAsApp.raw);
  assert.equal(linkAsApp.body.code, 'NOT_FOUND');
  const previewCode = await api('GET', '/api/v1/impact/preview?applicationId=lms', undefined, viewer);
  assert.equal(previewCode.status, 404, previewCode.raw);
  assert.equal(previewCode.body.code, 'NOT_FOUND');
  const viewerAppWrite = await api('PATCH', `/api/v1/applications/${id.appRecord}`, { description: 'no' }, viewer);
  assert.equal(viewerAppWrite.status, 403, viewerAppWrite.raw);
  assert.equal(viewerAppWrite.body.code, 'FORBIDDEN');
  assert.equal((await api('POST', '/api/v1/registry', { kind: 'DATABASE', name: 'v', owner: 'v', tier: 'TIER_1' }, viewer)).status, 403);
  assert.equal((await api('PATCH', `/api/v1/registry/${id.db}`, { owner: 'v' }, viewer)).status, 403);
  assert.equal((await api('POST', '/api/v1/dependency-links', { fromId: id.lp, toId: id.db, type: 'SOFT' }, viewer)).status, 403);
  assert.equal((await api('PATCH', `/api/v1/dependency-links/${id.lpDb}`, { type: 'SOFT' }, viewer)).status, 403);
  assert.equal((await api('DELETE', `/api/v1/dependency-links/${id.lpDb}`, undefined, viewer)).status, 403);

  const op = await api('POST', '/api/v1/users', { email: 'reg-operator@example.com', password: 'RegOperatorPassw0rd!', fullName: 'Reg Operator', roleName: 'operator' });
  assert.equal(op.status, 201, op.raw);
  const operator = await loginAs({ email: 'reg-operator@example.com', password: 'RegOperatorPassw0rd!' });
  assert.equal((await api('GET', '/api/v1/dependency-links', undefined, operator)).status, 200);
  const opWrite = await api('POST', '/api/v1/dependency-links', { fromId: id.lp, toId: id.media, type: 'HARD', featureId: id.tutor }, operator);
  assert.equal(opWrite.status, 403, opWrite.raw);
  assert.match(opWrite.body.message, /it_administrator/);
  assert.equal((await api('PATCH', `/api/v1/dependency-links/${id.lpDb}`, { type: 'SOFT' }, operator)).status, 403);
  assert.equal((await api('DELETE', `/api/v1/dependency-links/${id.lpDb}`, undefined, operator)).status, 403);
  assert.equal((await api('POST', '/api/v1/registry', { kind: 'DATABASE', name: 'op', owner: 'op', tier: 'TIER_1' }, operator)).status, 403);
  const opDeleteApp = await api('DELETE', `/api/v1/applications/${id.appRecord}`, undefined, operator);
  assert.equal(opDeleteApp.status, 403, opDeleteApp.raw);
  assert.equal(opDeleteApp.body.code, 'FORBIDDEN');
  assert.equal((await api('GET', `/api/v1/applications/${id.appRecord}`, undefined, operator)).status, 200);

  const admin = await api('POST', '/api/v1/users', { email: 'reg-it@example.com', password: 'RegItAdminPassw0rd!', fullName: 'Reg IT', roleName: 'it_administrator' });
  assert.equal(admin.status, 201, admin.raw);
  const it = await loginAs({ email: 'reg-it@example.com', password: 'RegItAdminPassw0rd!' });
  const badMethod = await api('POST', '/api/v1/dependency-links', { fromId: id.lp, toId: id.cf, type: 'SOFT', method: 'ftp' }, it);
  assert.equal(badMethod.status, 400, badMethod.raw);
  assert.match(badMethod.body.message, /Method must be one of/);
  const duplicate = await api('POST', '/api/v1/dependency-links', { fromId: id.lp, toId: id.db, type: 'SOFT', method: 'DATABASE' }, it);
  assert.equal(duplicate.status, 409, duplicate.raw);
  assert.match(duplicate.body.message, /already depends on/);
  const created = await api('POST', '/api/v1/dependency-links', { fromId: id.lp, toId: id.db, type: 'SOFT', featureId: id.tutor, method: 'DATABASE', notes: 'exams path stays separate' }, it);
  assert.equal(created.status, 201, created.raw);
  const read = await api('GET', `/api/v1/dependency-links/${created.body.data.id}`, undefined, it);
  assert.equal(read.status, 200, read.raw);
  assert.equal(read.body.data.featureId, id.tutor);
  const edited = await api('PATCH', `/api/v1/dependency-links/${created.body.data.id}`, { notes: 'kept for the role check' }, it);
  assert.equal(edited.status, 200, edited.raw);
  assert.equal(edited.body.data.notes, 'kept for the role check');
  assert.equal(edited.body.data.method, 'DATABASE');
  const removed = await api('DELETE', `/api/v1/dependency-links/${created.body.data.id}`, undefined, it);
  assert.equal(removed.status, 200, removed.raw);
  assert.equal(removed.body.data.deleted, true);
  assert.equal((await api('GET', '/api/v1/dependency-links')).body.data.length, 7);
});

test('edits and the register survive a server restart (loaded from PostgreSQL)', async () => {
  const e = await api('PATCH', `/api/v1/registry/${id.lp}`, { userCount: 1500, served: ['Students', 'Teachers', 'Parents'], owner: 'Digital Learning' });
  assert.equal(e.status, 200, e.raw);
  assert.equal(e.body.data.tier, 'TIER_1', 'tier kept');
  await waitFor(async () => (await rows(`select user_count from ${SCHEMA}.registry_components where id = $1`, [id.lp]))[0].user_count === 1500, 'edit flushed');
  await stopServer();
  await startServer();
  token = await loginAs(ADMIN);
  const r = (await api('GET', '/api/v1/registry')).body.data;
  assert.equal(r.components.length, 9);
  assert.equal(r.links.length, 7);
  const lp = r.components.find((c: { id: string }) => c.id === id.lp);
  assert.equal(lp.owner, 'Digital Learning');
  assert.deepEqual(lp.served, ['Students', 'Teachers', 'Parents']);
  assert.equal(r.links.find((l: { id: string }) => l.id === id.lpAi).featureId, id.tutor);
});

test('deleting: entries take their links along; features and registered apps/servers are unlinked, not deleted', async () => {
  // A second Learning Platform → media link for the exam feature; when the feature goes it would duplicate the plain one.
  // The feature has to belong to the consumer application before that link is accepted.
  const bound = await api('PATCH', `/api/v1/registry/${id.exams}`, { applicationId: id.appRecord });
  assert.equal(bound.status, 200, bound.raw);
  assert.equal(bound.body.data.applicationId, id.appRecord);
  await link('lpMediaExams', { fromId: id.lp, toId: id.media, type: 'SOFT', featureId: id.exams });
  const del = await api('DELETE', `/api/v1/registry/${id.exams}`);
  assert.equal(del.status, 200, del.raw);
  assert.equal(del.body.data.linksRemoved, 1, 'exams → database');
  let r = (await api('GET', '/api/v1/registry')).body.data;
  assert.equal(r.links.filter((l: { fromId: string; toId: string }) => l.fromId === id.lp && l.toId === id.media).length, 1, 'no duplicate left behind');
  assert.ok(!r.links.some((l: { featureId: string | null }) => l.featureId === id.exams));

  const delAi = await api('DELETE', `/api/v1/registry/${id.openai}`);
  assert.equal(delAi.body.data.linksRemoved, 2);
  r = (await api('GET', '/api/v1/registry')).body.data;
  assert.ok(r.components.some((c: { id: string }) => c.id === id.tutor), 'the feature stays');

  const dl = await api('DELETE', `/api/v1/dependency-links/${id.lpCf}`);
  assert.equal(dl.status, 200, dl.raw);
  assert.equal(dl.body.success, true);
  assert.equal(dl.body.data.deleted, true);
  const gone = await api('GET', `/api/v1/dependency-links/${id.lpCf}`);
  assert.equal(gone.status, 404, gone.raw);
  assert.equal(gone.body.success, false);
  const remaining = await api('GET', '/api/v1/dependency-links');
  assert.equal(remaining.body.success, true);
  assert.ok(!remaining.body.data.some((row: { id: string }) => row.id === id.lpCf));

  // Deleting the registered application / server keeps the register entries, without the reference
  assert.equal((await api('DELETE', `/api/v1/applications/${id.appRecord}`)).status, 200);
  assert.equal((await api('DELETE', `/api/v1/servers/${id.srvPrd}`)).status, 200);
  r = (await api('GET', '/api/v1/registry')).body.data;
  const get = (k: string) => r.components.find((c: { id: string }) => c.id === id[k]);
  assert.equal(get('lp').applicationId, null);
  assert.equal(get('tutor').applicationId, null);
  assert.equal(get('srv').serverId, null);
  await waitFor(async () => (await rows(`select server_id from ${SCHEMA}.registry_components where id = $1`, [id.srv]))[0].server_id === null, 'flushed');
  assert.equal((await rows(`select count(*)::int n from ${SCHEMA}.dependency_links`))[0].n, r.links.length);
  assert.equal((await api('DELETE', `/api/v1/registry/${id.exams}`)).status, 404);
  // Learning Platform no longer points at a registered application: AI Tutor no longer inherits from it
  assert.ok(!(id.tutor in by(await impactOf(id.srv))), 'inheritance only through a registered application');
});

test('propagation: a named feature stops when its dependency path is hard and degrades when it is soft; cycles end', async () => {
  await create('pApp', { kind: 'APPLICATION', name: 'Prop Portal', owner: 'x', tier: 'TIER_1', userCount: 500 });
  await create('pFeat', { kind: 'BUSINESS_FEATURE', name: 'Prop Uploads', owner: 'x', tier: 'TIER_2', userCount: 50 });
  await create('pStore', { kind: 'STORAGE', name: 'Prop Bucket', owner: 'x', tier: 'TIER_2' });
  await create('pCdn', { kind: 'PROVIDER', name: 'Prop CDN', owner: 'x', tier: 'TIER_2' });
  await create('pDns', { kind: 'PROVIDER', name: 'Prop DNS', owner: 'x', tier: 'TIER_1' });
  // The portal works without the bucket (soft) — except uploads, which need it
  await link('pAppStore', { fromId: id.pApp, toId: id.pStore, type: 'SOFT', featureId: id.pFeat });
  await link('pStoreCdn', { fromId: id.pStore, toId: id.pCdn, type: 'SOFT' });
  await link('pStoreDns', { fromId: id.pStore, toId: id.pDns, type: 'HARD' });
  await link('pCdnApp', { fromId: id.pCdn, toId: id.pApp, type: 'HARD', notes: 'cycle' });

  // Bucket down: uploads stop. The portal is not degraded, so the CDN behind the portal is not reached.
  let i = await impactOf(id.pStore);
  assert.deepEqual(by(i), { [id.pFeat]: 'HARD' });
  assert.equal(i.largestUserCountStopped, 50);
  assert.equal(i.largestUserCountAffected, 50);
  // DNS down: hard path to the bucket, so the bucket and uploads stop. The portal stays up.
  i = await impactOf(id.pDns);
  assert.deepEqual(by(i), { [id.pStore]: 'HARD', [id.pFeat]: 'HARD' });
  assert.ok(!(id.pDns in by(i)), 'the failed component is not listed as affected by itself');
  // CDN down: only a soft path reaches the bucket, so uploads degrade rather than stop
  i = await impactOf(id.pCdn);
  assert.deepEqual(by(i), { [id.pStore]: 'SOFT', [id.pFeat]: 'SOFT' });
  assert.equal(i.largestUserCountStopped, null);
  // …until that link is hard
  assert.equal((await api('PATCH', `/api/v1/dependency-links/${id.pStoreCdn}`, { type: 'HARD' })).status, 200);
  i = await impactOf(id.pCdn);
  assert.deepEqual(by(i), { [id.pStore]: 'HARD', [id.pFeat]: 'HARD' });
});

test('names: the same name in another case or Unicode form is a duplicate; different letters are not; the database stores the same key', async () => {
  const { registryNameKey } = await import('../server/registryName.ts');
  const tryCreate = (name: string) => api('POST', '/api/v1/registry', { kind: 'DATABASE', name, owner: 'x', tier: 'TIER_3' });
  const pairs: Array<[string, string, number]> = [
    // Plain toLowerCase() makes these differ (final sigma ς vs σ)
    ['ΣΑΣ Archive', 'σασ archive', 409],
    ['Straße Records', 'STRASSE RECORDS', 409],
    ['Finance DB', 'ﬁnance db', 409],
    // Turkish dotted capital I is a different letter from i
    ['İzmir Store', 'izmir store', 201],
  ];
  for (const [first, second, status] of pairs) {
    const a = await tryCreate(first);
    assert.equal(a.status, 201, `${first}: ${a.raw}`);
    const b = await tryCreate(second);
    assert.equal(b.status, status, `${second} after ${first}: ${b.raw}`);
    if (status === 409) assert.match(b.body.message, /already registered/);
  }
  await waitFor(async () => (await rows(`select count(*)::int n from ${SCHEMA}.registry_components where name = 'izmir store'`))[0].n === 1, 'saved');
  for (const r of await rows(`select name, name_key from ${SCHEMA}.registry_components`)) {
    assert.equal(r.name_key, registryNameKey(r.name), `name_key of ${r.name}`);
  }
});

test('a save PostgreSQL rejects: 409 (not "unreachable"), nothing written, health says REJECTED; saving resumes once the conflict is gone', async () => {
  const { registryNameKey } = await import('../server/registryName.ts');
  // Another writer put a row in the database that this server does not have in memory
  const external = '6f1d6e3a-0000-4000-8000-00000000e001';
  await pgc.query(`insert into ${SCHEMA}.registry_components (id, kind, name, name_key, owner, tier, created_at, updated_at) values ($1, 'DATABASE', 'Shadow DB', $2, 'elsewhere', 'TIER_3', now(), now())`,
    [external, registryNameKey('Shadow DB')]);

  const r = await api('POST', '/api/v1/registry', { kind: 'DATABASE', name: 'shadow db', owner: 'x', tier: 'TIER_3' });
  assert.equal(r.status, 409, r.raw);
  assert.equal(r.body.code, 'SAVE_REJECTED');
  assert.match(r.body.message, /PostgreSQL rejected the save \(constraint registry_components_name_key_uq\)/);
  assert.match(r.body.message, /Nothing from it was written/);
  assert.doesNotMatch(r.body.message, /unreachable/i);
  // The whole transaction was rolled back: neither the entry nor its audit entry is in the database
  assert.equal((await rows(`select count(*)::int n from ${SCHEMA}.registry_components where name_key = $1`, [registryNameKey('shadow db')]))[0].n, 1);
  assert.equal((await rows(`select count(*)::int n from ${SCHEMA}.audit_logs where details like '%shadow db%'`))[0].n, 0);
  const health = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(health.checks.database_save, 'REJECTED');
  assert.equal(serverLog.split('PostgreSQL rejected the save').length - 1, 1, 'logged once');
  assert.doesNotMatch(serverLog, /database unreachable, retrying/);

  // Remove the conflicting row: the next change saves everything that was pending
  await pgc.query(`delete from ${SCHEMA}.registry_components where id = $1`, [external]);
  const ok = await api('PATCH', `/api/v1/registry/${id.pDns}`, { owner: 'Network team' });
  assert.equal(ok.status, 200, ok.raw);
  assert.equal((await rows(`select owner from ${SCHEMA}.registry_components where name_key = $1`, [registryNameKey('shadow db')]))[0]?.owner, 'x');
  assert.equal((await rows(`select count(*)::int n from ${SCHEMA}.audit_logs where details like '%shadow db%'`))[0].n, 1);
  assert.equal((await (await fetch(`${BASE}/api/health`)).json()).checks.database_save, 'OK');
  assert.match(serverLog, /Saving to PostgreSQL works again/);
});

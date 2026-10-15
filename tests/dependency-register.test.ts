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
  await link('lpSrv', { fromId: id.lp, toId: id.srv, type: 'HARD' });
  await link('dbSrv', { fromId: id.db, toId: id.srv, type: 'HARD', notes: 'Database runs on the PRD VPS' });
  await link('lpCf', { fromId: id.lp, toId: id.cf, type: 'HARD' });
  await link('lpMedia', { fromId: id.lp, toId: id.media, type: 'SOFT' });
  const l = await link('lpAi', { fromId: id.lp, toId: id.openai, type: 'SOFT', featureId: id.tutor });
  assert.equal(l.featureId, id.tutor);
  await link('examsDb', { fromId: id.exams, toId: id.db, type: 'HARD' });
  await link('tutorAi', { fromId: id.tutor, toId: id.openai, type: 'HARD' });

  const cases: Array<[Record<string, unknown>, number, RegExp]> = [
    [{ fromId: id.lp, toId: id.lp, type: 'HARD' }, 400, /cannot depend on itself/],
    [{ fromId: id.lp, toId: '00000000-0000-4000-8000-000000000000', type: 'HARD' }, 400, /not in the register/],
    [{ fromId: id.lp, toId: id.db, type: 'MAYBE' }, 400, /Type must be one of/],
    [{ fromId: id.lp, toId: id.db, type: 'HARD', featureId: id.db }, 400, /must be a business feature/],
    [{ fromId: id.tutor, toId: id.db, type: 'SOFT', featureId: id.tutor }, 400, /cannot be A itself/],
    [{ fromId: id.lp, toId: id.tutor, type: 'SOFT', featureId: id.tutor }, 400, /cannot be B itself/],
    [{ fromId: id.lp, toId: id.db, type: 'SOFT' }, 409, /already depends on/],
    [{ toId: id.db, type: 'HARD' }, 400, /Choose what depends/],
  ];
  for (const [body, status, msg] of cases) {
    const r = await api('POST', '/api/v1/dependency-links', body);
    assert.equal(r.status, status, `${JSON.stringify(body)} → ${r.raw}`);
    assert.match(r.body.message, msg);
  }

  // Editable: a soft link becomes hard, notes change
  const e = await api('PATCH', `/api/v1/dependency-links/${id.lpMedia}`, { type: 'HARD', notes: 'Lessons fail without media' });
  assert.equal(e.status, 200, e.raw);
  assert.equal(e.body.data.type, 'HARD');
  const back = await api('PATCH', `/api/v1/dependency-links/${id.lpMedia}`, { type: 'SOFT' });
  assert.equal(back.body.data.type, 'SOFT');
  assert.equal(back.body.data.notes, 'Lessons fail without media', 'fields not sent are kept');
});

test('who is affected: dependents, hard vs degraded, user counts and teams served', async () => {
  // The PRD server takes down the database, everything on it, the exam feature that needs the
  // database, and AI Tutor, which inherits the outage of the platform that provides it
  const s = (await api('GET', `/api/v1/registry/${id.srv}/impact`)).body.data;
  assert.deepEqual(by(s), { [id.lp]: 'HARD', [id.db]: 'HARD', [id.tutor]: 'HARD', [id.exams]: 'HARD' });
  assert.equal(s.largestUserCountStopped, 1200, 'largest single count (1200, 300 and 900 overlap), not their sum');
  assert.equal(s.largestUserCountAffected, 1200);
  assert.deepEqual(s.served, ['Students', 'Teachers', 'Exam office']);

  // OpenAI: the AI Tutor feature stops (hard), the platform is only degraded (soft)
  const ai = (await api('GET', `/api/v1/registry/${id.openai}/impact`)).body.data;
  assert.deepEqual(by(ai), { [id.lp]: 'SOFT', [id.tutor]: 'HARD' });
  assert.equal(ai.largestUserCountStopped, 300);
  assert.equal(ai.largestUserCountAffected, 1200);

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
  await waitFor(async () => (await rows(`select count(*)::int n from ${SCHEMA}.dependency_links`))[0].n === 8, 'links flushed');
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
  assert.equal(boot.dependencyLinks.length, 8);
  const audit = (await api('GET', '/api/v1/audit?category=REGISTRY&pageSize=100')).body.data as Array<{ action: string; details: string }>;
  assert.ok(audit.some(a => a.action === 'REGISTRY_COMPONENT_CREATED' && a.details.includes('Learning Platform') && a.details.includes('Academic IT')));
  assert.ok(audit.some(a => a.action === 'DEPENDENCY_LINK_CREATED' && a.details === 'Learning Platform → OpenAI API (SOFT) for AI Tutor'));
  assert.ok(audit.some(a => a.action === 'DEPENDENCY_LINK_UPDATED'));
});

test('only IT administrators edit the register; viewers can read it', async () => {
  const u = await api('POST', '/api/v1/users', { email: 'reg-viewer@example.com', password: 'RegViewerPassw0rd!', fullName: 'Reg Viewer', roleName: 'viewer' });
  assert.equal(u.status, 201, u.raw);
  const viewer = await loginAs({ email: 'reg-viewer@example.com', password: 'RegViewerPassw0rd!' });
  assert.equal((await api('GET', '/api/v1/registry', undefined, viewer)).status, 200);
  assert.equal((await api('POST', '/api/v1/registry', { kind: 'DATABASE', name: 'v', owner: 'v', tier: 'TIER_1' }, viewer)).status, 403);
  assert.equal((await api('PATCH', `/api/v1/registry/${id.db}`, { owner: 'v' }, viewer)).status, 403);
  assert.equal((await api('DELETE', `/api/v1/dependency-links/${id.lpDb}`, undefined, viewer)).status, 403);
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
  assert.equal(r.links.length, 8);
  const lp = r.components.find((c: { id: string }) => c.id === id.lp);
  assert.equal(lp.owner, 'Digital Learning');
  assert.deepEqual(lp.served, ['Students', 'Teachers', 'Parents']);
  assert.equal(r.links.find((l: { id: string }) => l.id === id.lpAi).featureId, id.tutor);
});

test('deleting: entries take their links along; features and registered apps/servers are unlinked, not deleted', async () => {
  // A second Learning Platform → media link for the exam feature; when the feature goes it would duplicate the plain one
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

  // Bucket down: uploads stop, the portal degrades
  let i = await impactOf(id.pStore);
  assert.deepEqual(by(i), { [id.pApp]: 'SOFT', [id.pFeat]: 'HARD', [id.pCdn]: 'SOFT' });
  assert.equal(i.largestUserCountStopped, 50);
  assert.equal(i.largestUserCountAffected, 500);
  // DNS down: hard path to the bucket, so the bucket and uploads stop; the cycle back through the CDN ends
  i = await impactOf(id.pDns);
  assert.deepEqual(by(i), { [id.pStore]: 'HARD', [id.pApp]: 'SOFT', [id.pFeat]: 'HARD', [id.pCdn]: 'SOFT' });
  assert.ok(!(id.pDns in by(i)), 'the failed component is not listed as affected by itself');
  // CDN down: only a soft path reaches the bucket, so uploads degrade rather than stop
  i = await impactOf(id.pCdn);
  assert.deepEqual(by(i), { [id.pStore]: 'SOFT', [id.pApp]: 'SOFT', [id.pFeat]: 'SOFT' });
  assert.equal(i.largestUserCountStopped, null);
  // …until that link is hard
  assert.equal((await api('PATCH', `/api/v1/dependency-links/${id.pStoreCdn}`, { type: 'HARD' })).status, 200);
  i = await impactOf(id.pCdn);
  assert.deepEqual(by(i), { [id.pStore]: 'HARD', [id.pApp]: 'SOFT', [id.pFeat]: 'HARD' });
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

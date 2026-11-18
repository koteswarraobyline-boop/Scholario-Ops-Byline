/**
 * dependency_links.method and updated_at (migration 017).
 * Throw-away schema in scholario_ops_ui_test only. Applies 001–016, inserts a pre-017 link,
 * then lets migrate() add 017. Does not use the database named in .env.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pinTestDatabaseUrl, assertConnectedToTestDatabase, dropVerifiedTestSchema } from './helpers/test-db-guard.ts';
import type { DependencyMethod } from '../src/types/index.ts';

pinTestDatabaseUrl();
process.env.DB_SCHEMA = `ops_linkmeta_${process.pid}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-linkmeta-'));
process.env.HOSTINGER_API_TOKEN = '';
process.env.CLOUDFLARE_API_TOKEN = '';
process.env.ADMIN_EMAIL = '';
process.env.ADMIN_PASSWORD = '';

const { query, withTransaction, migrate, closePool, SCHEMA, T } = await import('../server/db.ts');
const { initStore, db, flush, persist } = await import('../server/store.ts');
const { buildLink, registryImpact, RegistryConflict, LINK_METHODS } = await import('../server/registry.ts');
const { ValidationError } = await import('../server/validate.ts');

const save = async () => { persist(); return flush(); };
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'migrations');

let verified = false;
const prdId = crypto.randomUUID();
const drId = crypto.randomUUID();
const appId = crypto.randomUUID();
const consumerId = crypto.randomUUID();
const providerId = crypto.randomUUID();
const oldLinkId = crypto.randomUUID();
const createdAt = '2024-06-01T12:00:00.000Z';

async function applyThrough016() {
  await query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await query(`CREATE TABLE IF NOT EXISTS ${T('schema_migrations')} (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = fs.readdirSync(migrationsDir).filter(f => /^\d+_.+\.sql$/.test(f) && f < '017').sort();
  assert.equal(files.includes('016_go_live_runs.sql'), true);
  assert.equal(files.some(f => f.startsWith('017')), false);
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8').replaceAll('{{schema}}', SCHEMA);
    await withTransaction(async c => {
      await c.query(sql);
      await c.query(`INSERT INTO ${T('schema_migrations')} (name) VALUES ($1)`, [file]);
    });
  }
}

before(async () => {
  await assertConnectedToTestDatabase({ query: sql => query(sql) });
  verified = true;
  await applyThrough016();

  await query(
    `INSERT INTO ${T('servers')} (id, hostname, ip, environment, agent_token) VALUES ($1, $2, '10.0.0.1', 'PRD', 'tok-prd'), ($3, $4, '10.0.0.2', 'DR', 'tok-dr')`,
    [prdId, `prd-${prdId.slice(0, 8)}`, drId, `dr-${drId.slice(0, 8)}`],
  );
  await query(
    `INSERT INTO ${T('applications')} (id, name, code_name, tier, rto_target_min, rpo_target_min, prd_server_id, dr_server_id)
     VALUES ($1, 'Hosted App', $2, 'TIER_2', 60, 60, $3, $4)`,
    [appId, `hosted-${appId.slice(0, 8)}`, prdId, drId],
  );
  const component = `INSERT INTO ${T('registry_components')} (id, kind, name, name_key, owner, tier, created_at, updated_at) VALUES ($1, $2, $3, $4, 'Owner', 'TIER_2', $5, $5)`;
  await query(component, [consumerId, 'APPLICATION', 'Consumer App', 'consumer app', createdAt]);
  await query(component, [providerId, 'DATABASE', 'Provider DB', 'provider db', createdAt]);
  await query(
    `INSERT INTO ${T('dependency_links')} (id, from_id, to_id, link_type, notes, created_at) VALUES ($1, $2, $3, 'HARD', 'pre-017', $4)`,
    [oldLinkId, consumerId, providerId, createdAt],
  );

  const first = await migrate();
  assert.deepEqual(first, ['017_dependency_mvp.sql', '018_dependency_layer1.sql']);
  const again = await migrate();
  assert.deepEqual(again, []);

  const row = (await query(
    `SELECT method, (updated_at = created_at) AS same FROM ${T('dependency_links')} WHERE id = $1`,
    [oldLinkId],
  )).rows[0];
  assert.equal(row.method, null);
  assert.equal(row.same, true);

  const sql = fs.readFileSync(path.join(migrationsDir, '017_dependency_mvp.sql'), 'utf8').replaceAll('{{schema}}', SCHEMA);
  await withTransaction(async c => { await c.query(sql); });
  const still = (await query(
    `SELECT (updated_at = created_at) AS same FROM ${T('dependency_links')} WHERE id = $1`,
    [oldLinkId],
  )).rows[0];
  assert.equal(still.same, true, 'running 017 again does not move updated_at');

  await assert.rejects(
    query(`UPDATE ${T('dependency_links')} SET method = 'FTP' WHERE id = $1`, [oldLinkId]),
    (err: { code?: string }) => err.code === '23514',
  );

  await initStore();
});

after(async () => {
  await dropVerifiedTestSchema(verified, () => query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {}));
  await closePool();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100).unref();
});

test('a pre-017 link reloads with a null method and updated_at copied from created_at', () => {
  const link = db.dependencyLinks.find(l => l.id === oldLinkId);
  assert.ok(link);
  assert.equal(link.method, null);
  assert.equal(link.criticality, null);
  assert.equal(link.healthCheck, '');
  assert.equal(link.failureBehaviour, '');
  assert.equal(link.owner, '');
  assert.equal(link.recoveryExpectation, '');
  assert.equal(link.notes, 'pre-017');
  assert.equal(link.type, 'HARD');
  assert.equal(Date.parse(link.createdAt), Date.parse(createdAt));
  assert.equal(Date.parse(link.updatedAt), Date.parse(createdAt));
});

test('each approved method and null is accepted, an unknown method is rejected, and an edit keeps created_at', async () => {
  const extra = (name: string, kind: 'DATABASE' | 'THIRD_PARTY_API' | 'BUSINESS_FEATURE') => {
    const id = crypto.randomUUID();
    db.registry.push({
      id, kind, name, owner: 'Owner', tier: 'TIER_2', description: '', applicationId: null, serverId: null,
      userCount: null, served: [], endpoint: '', createdAt, updatedAt: createdAt,
    });
    return id;
  };
  const methods: Array<DependencyMethod | null> = [...LINK_METHODS, null];
  for (const method of methods) {
    const toId = extra(`Provider ${method ?? 'none'}`, 'DATABASE');
    const link = buildLink({ body: { fromId: consumerId, toId, type: 'SOFT', method, notes: 'rationale' } });
    assert.equal(link.method, method);
    assert.equal(link.createdAt, link.updatedAt);
    db.dependencyLinks.push(link);
  }
  assert.throws(() => buildLink({ body: { fromId: consumerId, toId: providerId, type: 'SOFT', method: 'FTP' } }), ValidationError);
  assert.throws(() => buildLink({ body: { fromId: consumerId, toId: providerId, type: 'SOFT', method: 'http' } }), ValidationError);

  const editable = db.dependencyLinks.find(l => l.method === 'HTTP');
  assert.ok(editable);
  await new Promise(r => setTimeout(r, 5));
  const edited = buildLink({ body: { method: 'API', notes: 'still the rationale' } }, editable);
  assert.equal(edited.createdAt, editable.createdAt);
  assert.notEqual(edited.updatedAt, edited.createdAt);
  assert.equal(edited.method, 'API');
  assert.equal(edited.fromId, editable.fromId);
  assert.equal(edited.toId, editable.toId);
  const idx = db.dependencyLinks.findIndex(l => l.id === editable.id);
  db.dependencyLinks[idx] = edited;

  assert.equal(await save(), true);
  await initStore();
  const reloaded = db.dependencyLinks.find(l => l.id === edited.id);
  assert.ok(reloaded);
  assert.equal(reloaded.method, 'API');
  assert.equal(reloaded.notes, 'still the rationale');
  assert.equal(reloaded.createdAt, edited.createdAt);
  assert.equal(Date.parse(reloaded.updatedAt), Date.parse(edited.updatedAt));
  const old = db.dependencyLinks.find(l => l.id === oldLinkId);
  assert.equal(old?.method, null);
  assert.equal(Date.parse(old?.createdAt ?? ''), Date.parse(createdAt));
});

test('an application id, a server id, or a dangling application reference is rejected', () => {
  assert.throws(
    () => buildLink({ body: { fromId: appId, toId: providerId, type: 'HARD' } }),
    (err: Error) => err instanceof ValidationError && /application's register entry/.test(err.message),
  );
  assert.throws(
    () => buildLink({ body: { fromId: consumerId, toId: prdId, type: 'HARD' } }),
    (err: Error) => err instanceof ValidationError && /server's register entry/.test(err.message),
  );
  const from = db.registry.find(c => c.id === consumerId)!;
  from.applicationId = crypto.randomUUID();
  try {
    assert.throws(
      () => buildLink({ body: { fromId: consumerId, toId: providerId, type: 'SOFT', method: 'DATABASE' } }),
      (err: Error) => err instanceof ValidationError && /consumer application is no longer registered/.test(err.message),
    );
  } finally {
    from.applicationId = null;
  }
});

test('duplicate prevention, self-links, and feature checks are unchanged', () => {
  const from = db.registry.find(c => c.id === consumerId)!;
  const to = db.registry.find(c => c.id === providerId)!;
  assert.throws(
    () => buildLink({ body: { fromId: from.id, toId: to.id, type: 'SOFT', method: 'DATABASE' } }),
    (err: Error) => err instanceof RegistryConflict && /already depends on/.test(err.message),
  );
  assert.throws(
    () => buildLink({ body: { fromId: from.id, toId: from.id, type: 'HARD' } }),
    (err: Error) => err instanceof ValidationError && /cannot depend on itself/.test(err.message),
  );
  assert.throws(
    () => buildLink({ body: { fromId: from.id, toId: '00000000-0000-4000-8000-000000000099', type: 'HARD' } }),
    (err: Error) => err instanceof ValidationError && /not in the register/.test(err.message),
  );
  assert.throws(
    () => buildLink({ body: { fromId: from.id, toId: to.id, type: 'HARD', featureId: to.id } }),
    (err: Error) => err instanceof ValidationError && /must be a business feature/.test(err.message),
  );
});

test('criticality, failure text, owner, recovery, and a config address round-trip, and a password is rejected', async () => {
  const toId = crypto.randomUUID();
  db.registry.push({
    id: toId, kind: 'DATABASE', name: 'Layer1 DB', owner: 'Owner', tier: 'TIER_2', description: '',
    applicationId: null, serverId: null, userCount: null, served: [], endpoint: 'db.internal', createdAt, updatedAt: createdAt,
  });
  const link = buildLink({
    body: {
      fromId: consumerId, toId, type: 'HARD', criticality: 'HIGH', healthCheck: 'GET /health',
      failureBehaviour: 'Sign-in shows an error', owner: 'Academic IT', recoveryExpectation: 'Restore within 30 minutes',
    },
  });
  assert.equal(link.criticality, 'HIGH');
  assert.equal(link.healthCheck, 'GET /health');
  assert.equal(link.failureBehaviour, 'Sign-in shows an error');
  assert.equal(link.owner, 'Academic IT');
  assert.equal(link.recoveryExpectation, 'Restore within 30 minutes');
  db.dependencyLinks.push(link);
  assert.equal(await save(), true);
  await initStore();
  const reloaded = db.dependencyLinks.find(l => l.id === link.id);
  assert.equal(reloaded?.criticality, 'HIGH');
  assert.equal(reloaded?.failureBehaviour, 'Sign-in shows an error');
  assert.equal(db.registry.find(c => c.id === toId)?.endpoint, 'db.internal');
  assert.throws(
    () => buildLink({ body: { healthCheck: 'password=secret' } }, reloaded),
    (err: Error) => err instanceof ValidationError && /password or token/.test(err.message),
  );
  assert.throws(
    () => buildLink({ body: { notes: 'token=abc' } }, reloaded),
    (err: Error) => err instanceof ValidationError && /password or token/.test(err.message),
  );
  assert.throws(
    () => buildLink({ body: ['not', 'an', 'object'] }),
    (err: Error) => err instanceof ValidationError && /JSON object/.test(err.message),
  );
  assert.throws(
    () => buildLink({ body: { applicationId: appId } }, reloaded),
    (err: Error) => err instanceof ValidationError && /does not take an application id/.test(err.message),
  );
  const trimmed = buildLink({ body: { criticality: ' HIGH ' } }, reloaded);
  assert.equal(trimmed.criticality, 'HIGH');
  assert.throws(
    () => buildLink({ body: { criticality: 'URGENT' } }, reloaded),
    (err: Error) => err instanceof ValidationError && /Criticality must be one of/.test(err.message),
  );
});

test('HARD, SOFT, and a named feature still use the existing impact walk', () => {
  const featureId = crypto.randomUUID();
  db.registry.push({
    id: featureId, kind: 'BUSINESS_FEATURE', name: 'Playback', owner: 'Owner', tier: 'TIER_1', description: '',
    applicationId: null, serverId: null, userCount: null, served: [], endpoint: '', createdAt, updatedAt: createdAt,
  });
  const apiId = crypto.randomUUID();
  db.registry.push({
    id: apiId, kind: 'THIRD_PARTY_API', name: 'Storage API', owner: 'Owner', tier: 'TIER_2', description: '',
    applicationId: null, serverId: null, userCount: null, served: [], endpoint: '', createdAt, updatedAt: createdAt,
  });
  const soft = buildLink({ body: { fromId: consumerId, toId: apiId, type: 'SOFT', method: 'API', featureId } });
  db.dependencyLinks.push(soft);

  const hardHit = registryImpact(providerId);
  assert.equal(hardHit?.affected.find(a => a.id === consumerId)?.via, 'HARD');

  const softHit = registryImpact(apiId);
  assert.equal(softHit?.affected.find(a => a.id === consumerId), undefined);
  assert.equal(softHit?.affected.find(a => a.id === featureId)?.via, 'HARD');
});

test('saving links does not change application or server hosting rows', async () => {
  const beforeApps = (await query(`SELECT count(*)::int AS n FROM ${T('applications')}`)).rows[0].n;
  const beforeServers = (await query(`SELECT count(*)::int AS n FROM ${T('servers')}`)).rows[0].n;
  const hosting = (await query(`SELECT prd_server_id, dr_server_id FROM ${T('applications')} WHERE id = $1`, [appId])).rows[0];
  assert.equal(hosting.prd_server_id, prdId);
  assert.equal(hosting.dr_server_id, drId);

  assert.equal(await save(), true);
  const after = (await query(`SELECT prd_server_id, dr_server_id FROM ${T('applications')} WHERE id = $1`, [appId])).rows[0];
  assert.equal(after.prd_server_id, prdId);
  assert.equal(after.dr_server_id, drId);
  assert.equal((await query(`SELECT count(*)::int AS n FROM ${T('applications')}`)).rows[0].n, beforeApps);
  assert.equal((await query(`SELECT count(*)::int AS n FROM ${T('servers')}`)).rows[0].n, beforeServers);
  assert.equal((await query(`SELECT count(*)::int AS n FROM ${T('monitors')}`)).rows[0].n, 0);
  assert.equal((await query(`SELECT count(*)::int AS n FROM ${T('incidents')}`)).rows[0].n, 0);
});

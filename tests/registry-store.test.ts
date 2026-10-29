/**
 * Dependency register persistence (server/store.ts + migration 008): name and link uniqueness is
 * checked once per save transaction (deferred constraints), so swaps and rename-plus-create save in
 * one transaction; the database compares the application's case-insensitive name key; a save
 * PostgreSQL rejects is rolled back as a whole, classified as rejected (not "unreachable") and
 * not retried by timer. Throw-away schema in scholario_ops_ui_test only (tests/helpers/test-db-guard.ts).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pinTestDatabaseUrl, assertConnectedToTestDatabase, dropVerifiedTestSchema } from './helpers/test-db-guard.ts';
import { registryNameCollisions, registryNameKey } from '../server/registryName.ts';
import type { RegistryComponent, DependencyLink } from '../src/types/index.ts';

// Before the store is imported (its config reads .env for anything not already set)
pinTestDatabaseUrl();
process.env.DB_SCHEMA = `ops_regstore_${process.pid}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-regstore-'));
process.env.HOSTINGER_API_TOKEN = '';
process.env.CLOUDFLARE_API_TOKEN = '';

const { initStore, db, flush, persist, saveState, classifySaveError, databaseSaveStatus, saveFailureClient, injectSaveErrorForTests, saveRetry, StoreDataError } = await import('../server/store.ts');
const { query, withTransaction, closePool, SCHEMA, T, MigrationError } = await import('../server/db.ts');
const save = async () => { persist(); return flush(); };
const now = new Date().toISOString();
const comp = (name: string, kind: RegistryComponent['kind'] = 'DATABASE'): RegistryComponent => ({
  id: crypto.randomUUID(), kind, name, owner: 'Test', tier: 'TIER_2', description: '', applicationId: null, serverId: null, userCount: null, served: [], createdAt: now, updatedAt: now,
});
const lnk = (fromId: string, toId: string, featureId: string | null): DependencyLink => ({ id: crypto.randomUUID(), fromId, toId, type: 'SOFT', featureId, notes: '', createdAt: now });
const names = async () => Object.fromEntries((await query(`select id, name from ${T('registry_components')}`)).rows.map(r => [r.id, r.name]));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let verified = false;
before(async () => {
  await assertConnectedToTestDatabase({ query: sql => query(sql) });
  verified = true;
  await initStore();
});
after(async () => {
  await dropVerifiedTestSchema(verified, () => query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {}));
  await closePool();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100).unref();
});

test('migration 008: deferrable, initially deferred constraints replace the row-by-row unique indexes', async () => {
  const c = (await query(`select conname, contype, condeferrable, condeferred from pg_constraint where connamespace = $1::regnamespace
      and conname in ('registry_components_name_key_uq', 'registry_components_app_excl', 'registry_components_server_excl', 'dependency_links_excl') order by conname`, [SCHEMA])).rows;
  assert.deepEqual(c.map(r => [r.conname, r.contype, r.condeferrable, r.condeferred]), [
    ['dependency_links_excl', 'x', true, true],
    ['registry_components_app_excl', 'x', true, true],
    ['registry_components_name_key_uq', 'u', true, true],
    ['registry_components_server_excl', 'x', true, true],
  ]);
  const old = (await query(`select indexname from pg_indexes where schemaname = $1 and indexname in ('registry_components_name_uq', 'registry_components_app_uq', 'registry_components_server_uq', 'dependency_links_uq')`, [SCHEMA])).rows;
  assert.deepEqual(old, []);
  const col = (await query(`select is_nullable from information_schema.columns where table_schema = $1 and table_name = 'registry_components' and column_name = 'name_key'`, [SCHEMA])).rows;
  assert.deepEqual(col, [{ is_nullable: 'NO' }]);
});

test('two names swapped in one save: one transaction, saved', async () => {
  const a = comp('Alpha DB'), b = comp('Beta DB');
  db.registry.push(a, b);
  assert.equal(await save(), true);
  const before = saveState().attempts;
  a.name = 'Beta DB'; b.name = 'Alpha DB';
  assert.equal(await save(), true, JSON.stringify(saveState().failure));
  assert.equal(saveState().attempts, before + 1, 'one transaction');
  const n = await names();
  assert.equal(n[a.id], 'Beta DB'); assert.equal(n[b.id], 'Alpha DB');
});

test('rename plus a new entry with the old name, in one save', async () => {
  const c = comp('Gamma Store', 'STORAGE');
  db.registry.push(c);
  assert.equal(await save(), true);
  c.name = 'Delta Store';
  const d = comp('gamma store', 'STORAGE');
  db.registry.push(d);
  assert.equal(await save(), true, JSON.stringify(saveState().failure));
  const n = await names();
  assert.equal(n[c.id], 'Delta Store'); assert.equal(n[d.id], 'gamma store');
});

test('two links swap the features that need them, in one save', async () => {
  const app = comp('Swap App', 'APPLICATION'), dep = comp('Swap Dep', 'THIRD_PARTY_API');
  const f1 = comp('Swap F1', 'BUSINESS_FEATURE'), f2 = comp('Swap F2', 'BUSINESS_FEATURE');
  db.registry.push(app, dep, f1, f2);
  const l1 = lnk(app.id, dep.id, f1.id), l2 = lnk(app.id, dep.id, f2.id);
  db.dependencyLinks.push(l1, l2);
  assert.equal(await save(), true, JSON.stringify(saveState().failure));
  l1.featureId = f2.id; l2.featureId = f1.id;
  assert.equal(await save(), true, JSON.stringify(saveState().failure));
  const r = Object.fromEntries((await query(`select id, feature_id from ${T('dependency_links')} where id = any($1)`, [[l1.id, l2.id]])).rows.map(x => [x.id, x.feature_id]));
  assert.deepEqual(r, { [l1.id]: f2.id, [l2.id]: f1.id });
});

test('Unicode: the database stores and compares the application key, not lower(); a stale key is rewritten after loading', async () => {
  const sigma = comp('ΣΑΣ Ledger'), tr1 = comp('İzmir Ledger'), tr2 = comp('izmir ledger');
  db.registry.push(sigma, tr1, tr2);
  assert.equal(await save(), true, JSON.stringify(saveState().failure));
  for (const r of (await query(`select name, name_key from ${T('registry_components')}`)).rows) assert.equal(r.name_key, registryNameKey(r.name), r.name);

  // A key that is not the application's (as migration 008's lower(name) backfill may leave it) is rewritten after loading
  await query(`update ${T('registry_components')} set name_key = 'stale' where id = $1`, [sigma.id]);
  await initStore();
  assert.equal(await save(), true, JSON.stringify(saveState().failure));
  const after = (await query(`select name_key from ${T('registry_components')} where id = $1`, [sigma.id])).rows[0].name_key;
  assert.equal(after, registryNameKey('ΣΑΣ Ledger'));
});

test('a real duplicate is still rejected when the transaction commits, and nothing of it remains', async () => {
  const id1 = crypto.randomUUID(), id2 = crypto.randomUUID();
  await assert.rejects(withTransaction(async c => {
    for (const [id, name] of [[id1, 'Dup DB'], [id2, 'DUP db']]) {
      await c.query(`insert into ${T('registry_components')} (id, kind, name, name_key, owner, tier, created_at, updated_at) values ($1, 'DATABASE', $2, $3, 'x', 'TIER_3', now(), now())`, [id, name, registryNameKey(name)]);
    }
  }), (err: { code?: string; constraint?: string }) => err.code === '23505' && err.constraint === 'registry_components_name_key_uq');
  assert.equal((await query(`select count(*)::int n from ${T('registry_components')} where id = any($1)`, [[id1, id2]])).rows[0].n, 0);
});

test('a save PostgreSQL rejects: rolled back as a whole, REJECTED with the constraint, not retried by timer; the next save after the fix succeeds', async () => {
  const external = crypto.randomUUID();
  await query(`insert into ${T('registry_components')} (id, kind, name, name_key, owner, tier, created_at, updated_at) values ($1, 'DATABASE', 'Ext Cache', $2, 'elsewhere', 'TIER_3', now(), now())`, [external, registryNameKey('Ext Cache')]);
  const mine = comp('EXT CACHE');
  db.registry.push(mine);
  const auditId = crypto.randomUUID();
  db.auditLogs.unshift({ id: auditId, timestamp: now, operator: 'test', action: 'TEST', category: 'REGISTRY', targetId: '', details: 'rolled back with the rest' });

  const attempts = saveState().attempts;
  assert.equal(await save(), false);
  const st = saveState();
  assert.equal(st.ok, false);
  assert.equal(st.failure?.kind, 'REJECTED');
  assert.equal(st.failure?.code, '23505');
  assert.equal(st.failure?.constraint, 'registry_components_name_key_uq');
  assert.equal(st.attempts, attempts + 1);
  assert.equal((await query(`select count(*)::int n from ${T('audit_logs')} where id = $1`, [auditId])).rows[0].n, 0, 'the other table\'s change was rolled back too');
  assert.equal((await query(`select count(*)::int n from ${T('registry_components')} where id = $1`, [mine.id])).rows[0].n, 0);

  // Background changes keep calling persist(): no timer save, no retry loop
  for (let i = 0; i < 4; i++) { persist(); await sleep(1700); }
  assert.equal(saveState().attempts, attempts + 1, 'not retried by timer');

  await query(`delete from ${T('registry_components')} where id = $1`, [external]);
  assert.equal(await flush(), true, JSON.stringify(saveState().failure));
  assert.deepEqual(saveState().failure, null);
  assert.equal((await query(`select count(*)::int n from ${T('audit_logs')} where id = $1`, [auditId])).rows[0].n, 1);
  assert.equal((await query(`select name from ${T('registry_components')} where id = $1`, [mine.id])).rows[0]?.name, 'EXT CACHE');
});

test('a migration failure names the file, says it was rolled back, and does not keep a connection string', () => {
  const err = new MigrationError('008_registry_deferred_uniqueness.sql', new Error('duplicate key value postgres://ops:s3cret@127.0.0.1/scholario_ops_dev'));
  assert.match(err.message, /008_registry_deferred_uniqueness.sql/);
  assert.match(err.message, /rolled back/);
  assert.match(err.message, /not changed/);
  assert.equal(err.message.includes('s3cret'), false);
});

test('classifySaveError: connection loss is unreachable, lock and serialization conflicts are conflicts, constraints are rejected', () => {
  const pgErr = (code: string) => Object.assign(new Error('pg'), { code });
  for (const code of ['23505', '23503', '23514', '23P01', '22P02', '42703', '42P01', '25P02']) assert.equal(classifySaveError(pgErr(code)), 'REJECTED', code);
  for (const code of ['40001', '40P01', '55P03', '57014']) assert.equal(classifySaveError(pgErr(code)), 'CONFLICT', code);
  for (const code of ['08006', '08001', '53300', '57P01', '57P02', '57P03']) assert.equal(classifySaveError(pgErr(code)), 'UNREACHABLE', code);
  for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']) assert.equal(classifySaveError(pgErr(code)), 'UNREACHABLE', code);
  assert.equal(classifySaveError(new Error('Connection terminated unexpectedly')), 'UNREACHABLE');
  assert.equal(classifySaveError(new Error('timeout exceeded when trying to connect')), 'UNREACHABLE');
  assert.equal(classifySaveError(new TypeError('x is undefined')), 'REJECTED');
  assert.equal(classifySaveError(new RangeError('Invalid time value')), 'REJECTED');
});

test('a connection failure is retried; the rows stay in memory and are saved when the database answers', async () => {
  const previous = saveRetry.unreachableMs;
  saveRetry.unreachableMs = 40;
  const row = comp('Conn Marker', 'STORAGE');
  db.registry.push(row);
  try {
    injectSaveErrorForTests(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }));
    const start = saveState().attempts;
    persist();
    assert.equal(await flush(), false);
    assert.equal(saveState().failure?.kind, 'UNREACHABLE');
    assert.equal(databaseSaveStatus(), 'RETRYING');
    assert.equal(saveFailureClient()?.code, 'SAVE_UNREACHABLE');
    assert.match(saveFailureClient()?.message ?? '', /not in the database yet/);
    await sleep(180);
    assert.ok(saveState().attempts >= start + 2, `not retried (${saveState().attempts - start})`);
    assert.equal((await query(`select count(*)::int n from ${T('registry_components')} where id = $1`, [row.id])).rows[0].n, 0);
    injectSaveErrorForTests(null);
    assert.equal(await flush(), true, JSON.stringify(saveState().failure));
    assert.equal(databaseSaveStatus(), 'OK');
    assert.equal((await query(`select name from ${T('registry_components')} where id = $1`, [row.id])).rows[0]?.name, 'Conn Marker');
  } finally {
    injectSaveErrorForTests(null);
    saveRetry.unreachableMs = previous;
    if (!saveState().ok) await flush().catch(() => {});
  }
});

test('a lock or serialization failure retries a few times, then stops; the next explicit save resumes and nothing was written meanwhile', async () => {
  const previous = { ms: saveRetry.conflictMs, limit: saveRetry.conflictLimit };
  saveRetry.conflictMs = 40;
  saveRetry.conflictLimit = 3;
  const row = comp('Lock Marker', 'STORAGE');
  db.registry.push(row);
  try {
    injectSaveErrorForTests(Object.assign(new Error('could not serialize access due to concurrent update'), { code: '40001' }));
    const start = saveState().attempts;
    persist();
    assert.equal(await flush(), false);
    assert.equal(saveState().failure?.kind, 'CONFLICT');
    assert.equal(saveState().failure?.code, '40001');
    assert.equal(databaseSaveStatus(), 'CONFLICT');
    assert.equal(saveFailureClient()?.code, 'SAVE_CONFLICT');
    assert.match(saveFailureClient()?.message ?? '', /Nothing from it was written/);
    await sleep(500);
    assert.equal(saveState().attempts - start, 3, `attempts ${saveState().attempts - start}`);
    assert.equal(saveState().conflictAttempts, 3);
    assert.match(saveFailureClient()?.message ?? '', /Automatic retry has stopped/);
    const stopped = saveState().attempts;
    persist();
    await sleep(250);
    assert.equal(saveState().attempts, stopped, 'timer and persist() stopped');
    assert.equal((await query(`select count(*)::int n from ${T('registry_components')} where id = $1`, [row.id])).rows[0].n, 0);
    assert.equal(db.registry.some(c => c.id === row.id), true, 'the change is still in memory');
    injectSaveErrorForTests(null);
    assert.equal(await flush(), true, JSON.stringify(saveState().failure));
    assert.equal(saveState().failure, null);
    assert.equal(databaseSaveStatus(), 'OK');
    assert.equal((await query(`select name from ${T('registry_components')} where id = $1`, [row.id])).rows[0]?.name, 'Lock Marker');
  } finally {
    injectSaveErrorForTests(null);
    saveRetry.conflictMs = previous.ms;
    saveRetry.conflictLimit = previous.limit;
    if (!saveState().ok) await flush().catch(() => {});
  }
});

test('a rejected save keeps its message free of secrets, is absent after reload, and saving works again', async () => {
  const external = crypto.randomUUID();
  await query(`insert into ${T('registry_components')} (id, kind, name, name_key, owner, tier, created_at, updated_at) values ($1, 'DATABASE', 'Restart Ext', $2, 'elsewhere', 'TIER_3', now(), now())`, [external, registryNameKey('Restart Ext')]);
  const mine = comp('RESTART EXT');
  db.registry.push(mine);
  assert.equal(await save(), false);
  assert.equal(databaseSaveStatus(), 'REJECTED');
  const body = saveFailureClient();
  assert.equal(body?.status, 409);
  assert.equal(body?.code, 'SAVE_REJECTED');
  assert.match(body?.message ?? '', /Nothing from it was written/);
  assert.equal((await query(`select count(*)::int n from ${T('registry_components')} where id = $1`, [mine.id])).rows[0].n, 0);

  await initStore();
  assert.equal(db.registry.some(c => c.id === mine.id), false, 'reload drops the change that was never committed');
  assert.equal(saveState().failure, null);
  assert.equal(databaseSaveStatus(), 'OK');
  assert.equal((await query(`select count(*)::int n from ${T('registry_components')} where id = $1`, [external])).rows[0].n, 1);
  await query(`delete from ${T('registry_components')} where id = $1`, [external]);
  const fresh = comp('After Restart');
  db.registry.push(fresh);
  assert.equal(await save(), true, JSON.stringify(saveState().failure));
  assert.equal((await query(`select name from ${T('registry_components')} where id = $1`, [fresh.id])).rows[0]?.name, 'After Restart');
});

test('a save error that contains a password or a connection string is stored without them', async () => {
  const row = comp('Secret Marker', 'PROVIDER');
  db.registry.push(row);
  try {
    injectSaveErrorForTests(Object.assign(new Error('failed password=s3cret using postgres://ops:s3cret@127.0.0.1/scholario_ops_dev'), { code: '23514' }));
    persist();
    assert.equal(await flush(), false);
    assert.equal(saveState().failure?.kind, 'REJECTED');
    assert.equal(saveState().failure?.message.includes('s3cret'), false);
    assert.equal(saveFailureClient()?.message.includes('s3cret'), false);
    assert.equal((await query(`select count(*)::int n from ${T('registry_components')} where id = $1`, [row.id])).rows[0].n, 0);
    injectSaveErrorForTests(null);
    assert.equal(await flush(), true, JSON.stringify(saveState().failure));
  } finally {
    injectSaveErrorForTests(null);
    if (!saveState().ok) await flush().catch(() => {});
  }
});

test('names that only the shared key treats as duplicates are left unchanged, and startup refuses to write', async () => {
  assert.deepEqual(registryNameCollisions([
    { kind: 'DATABASE', name: 'Straße' },
    { kind: 'DATABASE', name: 'STRASSE' },
    { kind: 'DATABASE', name: 'Other' },
  ]), ['DATABASE "Straße" and "STRASSE"']);
  const a = crypto.randomUUID(), b = crypto.randomUUID();
  const insert = (id: string, name: string, key: string) => query(
    `insert into ${T('registry_components')} (id, kind, name, name_key, owner, tier, created_at, updated_at) values ($1, 'DATABASE', $2, $3, 'x', 'TIER_3', now(), now())`,
    [id, name, key],
  );
  await insert(a, 'Straße', 'straße');
  await insert(b, 'STRASSE', 'strasse');
  await assert.rejects(() => initStore(), (err: Error) => err instanceof StoreDataError && /Nothing was written/.test(err.message) && /Straße/.test(err.message));
  const left = Object.fromEntries((await query(`select name, name_key from ${T('registry_components')} where id = any($1)`, [[a, b]])).rows.map(r => [r.name, r.name_key]));
  assert.deepEqual(left, { 'Straße': 'straße', STRASSE: 'strasse' });
  await query(`delete from ${T('registry_components')} where id = any($1)`, [[a, b]]);
  await initStore();
  assert.equal(db.registry.some(c => c.id === a || c.id === b), false);
});

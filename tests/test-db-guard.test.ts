/**
 * The fail-closed guard for database-backed tests (tests/helpers/test-db-guard.ts): only
 * scholario_ops_ui_test on this machine; no .env fallback; refuses before any connection is made.
 * Needs no database.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveTestDatabaseUrl, assertConnectedToTestDatabase, pinTestDatabaseUrl, dropVerifiedTestSchema, assertScratchDatabaseName, TestDatabaseRefused } from './helpers/test-db-guard.ts';

const refused = (env: Record<string, string | undefined>, why: RegExp) =>
  assert.throws(() => resolveTestDatabaseUrl(env), (e: Error) => e instanceof TestDatabaseRefused && why.test(e.message));

test('resolveTestDatabaseUrl refuses anything but scholario_ops_ui_test on this machine', () => {
  refused({}, /not set in the environment/);
  refused({ DATABASE_URL: '' }, /not set/);
  refused({ DATABASE_URL: '   ' }, /not set/);
  refused({ DATABASE_URL: 'not a url' }, /not a valid URL/);
  refused({ DATABASE_URL: 'mysql://u:p@localhost/scholario_ops_ui_test' }, /protocol/);
  refused({ DATABASE_URL: 'postgres://u:p@localhost:5432/scholario_ops_dev' }, /"scholario_ops_dev", not scholario_ops_ui_test/);
  refused({ DATABASE_URL: 'postgres://u:p@localhost:5432/scholario_ops_prodcopy' }, /"scholario_ops_prodcopy"/);
  refused({ DATABASE_URL: 'postgres://u:p@localhost:5432/scholario_ops_ui_test_x' }, /not scholario_ops_ui_test/);
  refused({ DATABASE_URL: 'postgres://u:p@localhost:5432/SCHOLARIO_OPS_UI_TEST' }, /not scholario_ops_ui_test/);
  refused({ DATABASE_URL: 'postgres://u:p@localhost:5432/' }, /"\(none\)"/);
  refused({ DATABASE_URL: 'postgres://u:p@localhost:5432' }, /"\(none\)"/);
  refused({ DATABASE_URL: 'postgres://u:p@db.example.com:5432/scholario_ops_ui_test' }, /not this machine/);
  refused({ DATABASE_URL: 'postgres://u:p@10.0.0.5/scholario_ops_ui_test' }, /not this machine/);
  refused({ DATABASE_URL: 'postgres://u:p@/scholario_ops_ui_test' }, /not this machine|not a valid URL/);
  refused({ DATABASE_URL: 'postgres://u:p@localhost/scholario_ops_ui_test?database=scholario_ops_dev' }, /parameter "database"/);
  refused({ DATABASE_URL: 'postgres://u:p@localhost/scholario_ops_ui_test?host=db.example.com' }, /parameter "host"/);
  refused({ DATABASE_URL: 'postgres://u:p@localhost/scholario_ops_ui_test?options=-c%20search_path%3Dops' }, /parameter "options"/);
  refused({ DATABASE_URL: 'postgres://u:p@localhost/scholario_ops_ui_test?service=prod' }, /parameter "service"/);

  for (const ok of ['postgres://u:p@localhost:5432/scholario_ops_ui_test', 'postgresql://u@127.0.0.1/scholario_ops_ui_test?sslmode=disable', 'postgres://u:p@[::1]:5432/scholario_ops_ui_test']) {
    const url = resolveTestDatabaseUrl({ DATABASE_URL: ok });
    assert.equal(new URL(url).pathname, '/scholario_ops_ui_test', ok);
  }
  // Agreeing libpq variables are not a second target
  const agreed = resolveTestDatabaseUrl({
    DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/scholario_ops_ui_test',
    PGHOST: '127.0.0.1', PGPORT: '5432', PGDATABASE: 'scholario_ops_ui_test', pghost: '',
  });
  assert.equal(new URL(agreed).hostname, '127.0.0.1');
});

const VALID = 'postgres://u:p@127.0.0.1:5432/scholario_ops_ui_test';
test('resolveTestDatabaseUrl refuses an ambiguous target', () => {
  refused({ DATABASE_URL: VALID, PGDATABASE: 'scholario_ops_dev' }, /PGDATABASE is "scholario_ops_dev".*ambiguous/);
  refused({ DATABASE_URL: VALID, PGHOST: 'db.example.com' }, /PGHOST disagrees.*ambiguous/);
  refused({ DATABASE_URL: VALID, PGHOST: 'localhost' }, /PGHOST disagrees.*ambiguous/);
  refused({ DATABASE_URL: VALID, PGPORT: '5433' }, /PGPORT disagrees.*ambiguous/);
  refused({ DATABASE_URL: 'postgres://u:p@127.0.0.1/scholario_ops_ui_test', PGPORT: '5433' }, /no port.*ambiguous/);
  refused({ DATABASE_URL: VALID, PGHOSTADDR: '10.0.0.5' }, /PGHOSTADDR is set, so the database target is ambiguous/);
  refused({ DATABASE_URL: VALID, PGHOSTADDR: '127.0.0.1' }, /PGHOSTADDR is set/);
  refused({ DATABASE_URL: VALID, PGSERVICE: 'prod' }, /PGSERVICE is set/);
  refused({ DATABASE_URL: VALID, PGSERVICEFILE: 'C:/pg_service.conf' }, /PGSERVICEFILE is set/);
  refused({ DATABASE_URL: VALID, PGOPTIONS: '-c search_path=ops' }, /PGOPTIONS is set/);
});

test('schema cleanup does not run unless the connected database was confirmed', async () => {
  let dropped = false;
  await dropVerifiedTestSchema(false, async () => { dropped = true; });
  assert.equal(dropped, false);
  await dropVerifiedTestSchema(true, async () => { dropped = true; });
  assert.equal(dropped, true);
  assert.throws(() => assertScratchDatabaseName('scholario_ops_dev'), TestDatabaseRefused);
  assert.throws(() => assertScratchDatabaseName('scholario_ops_prodcopy'), TestDatabaseRefused);
  assert.throws(() => assertScratchDatabaseName('scholario_ops_ui_test'), TestDatabaseRefused);
  assert.throws(() => assertScratchDatabaseName('postgres'), TestDatabaseRefused);
  assert.doesNotThrow(() => assertScratchDatabaseName('ops_restore_test_1'));
});

test('pinTestDatabaseUrl pins the approved URL and does not read a caller-supplied object as .env', () => {
  const env: Record<string, string | undefined> = { DATABASE_URL: VALID };
  assert.equal(new URL(pinTestDatabaseUrl(env)).pathname, '/scholario_ops_ui_test');
  assert.equal(env.DATABASE_URL && new URL(env.DATABASE_URL).pathname, '/scholario_ops_ui_test');
});

test('assertConnectedToTestDatabase refuses another database, a remote server and a failed check', async () => {
  const client = (row: Record<string, unknown> | undefined) => ({ query: async () => ({ rows: row ? [row] : [] }) });
  await assertConnectedToTestDatabase(client({ db: 'scholario_ops_ui_test', addr: '127.0.0.1' }));
  await assertConnectedToTestDatabase(client({ db: 'scholario_ops_ui_test', addr: '::1' }));
  await assertConnectedToTestDatabase(client({ db: 'scholario_ops_ui_test', addr: null }));
  const no = async (c: Parameters<typeof assertConnectedToTestDatabase>[0], why: RegExp) =>
    assert.rejects(assertConnectedToTestDatabase(c), (e: Error) => e instanceof TestDatabaseRefused && why.test(e.message));
  await no(client({ db: 'scholario_ops_dev', addr: '127.0.0.1' }), /"scholario_ops_dev"/);
  await no(client({ db: 'scholario_ops_ui_test', addr: '10.0.0.5' }), /not a loopback address/);
  await no(client(undefined), /"\(unknown\)"/);
  await no({ query: async () => { throw new Error('connection refused'); } }, /could not confirm the connected database/);
});

const here = path.dirname(fileURLToPath(import.meta.url));
const tsx = import.meta.resolve('tsx');
const guardHref = pathToFileURL(path.join(here, 'helpers', 'test-db-guard.ts')).href;

/** Every test file that connects to PostgreSQL or drops a schema. */
const DATABASE_TEST_FILES = [
  'audit-fixes.test.ts', 'config-flow.test.ts', 'dependency-register.test.ts', 'email.test.ts',
  'escalation.test.ts', 'heartbeat.test.ts', 'insights.test.ts', 'loadbalancer.test.ts',
  'monitoring.test.ts', 'ops-backup.test.ts', 'production.test.ts', 'registry-store.test.ts',
  'responsive.test.ts', 'secrets.test.ts', 'telemetry.test.ts',
];

test('every database test pins the URL before dotenv and gates schema cleanup', () => {
  for (const file of DATABASE_TEST_FILES) {
    const src = fs.readFileSync(path.join(here, file), 'utf8');
    const pinAt = src.indexOf('pinTestDatabaseUrl(');
    const dotenvAt = src.indexOf('dotenv.config(');
    assert.ok(pinAt >= 0, `${file} does not call pinTestDatabaseUrl()`);
    if (dotenvAt >= 0) assert.ok(pinAt < dotenvAt, `${file} loads .env before the guard`);
    if (src.includes('DROP SCHEMA')) assert.match(src, /dropVerifiedTestSchema\(/, `${file} drops a schema without the verified-database gate`);
  }
});

// A bad target must not reach schema cleanup. The after() hook is registered first, the way node:test
// still runs it when before() fails; the drop is gated and the guard throws before `verified` is set.
// The working directory contains a .env naming scholario_ops_dev on a closed port, so a dotenv fallback
// could not reach a real database even if the guard forgot to run first.
for (const [label, envExtra, why] of [
  ['a missing DATABASE_URL', {}, /not set in the environment/],
  ['a non-local host', { DATABASE_URL: 'postgres://u:p@not-a-database.invalid:1/scholario_ops_ui_test' }, /not this machine/],
  ['the development database', { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/scholario_ops_dev' }, /"scholario_ops_dev"/],
  ['an ambiguous PGDATABASE', { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/scholario_ops_ui_test', PGDATABASE: 'scholario_ops_dev' }, /ambiguous/],
] as const) {
  test(`a refused target (${label}) does not run schema cleanup`, () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-guard-'));
    const marker = path.join(cwd, 'schema-cleaned');
    const fixture = path.join(cwd, 'cleanup-order.test.ts');
    fs.writeFileSync(path.join(cwd, '.env'), 'DATABASE_URL=postgres://u:p@127.0.0.1:1/scholario_ops_dev\n');
    fs.writeFileSync(fixture, `
      import { before, after, test } from 'node:test';
      import fs from 'node:fs';
      import { pinTestDatabaseUrl, dropVerifiedTestSchema } from ${JSON.stringify(guardHref)};
      const marker = ${JSON.stringify(marker)};
      let verified = false;
      after(async () => { await dropVerifiedTestSchema(verified, async () => { fs.writeFileSync(marker, 'dropped'); }); });
      before(async () => { pinTestDatabaseUrl(); verified = true; });
      test('would have used the database', () => {});
    `);
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, PGPORT: '1', ...envExtra };
      delete env.NODE_TEST_CONTEXT;
      if (!('DATABASE_URL' in envExtra)) delete env.DATABASE_URL;
      const r = spawnSync(process.execPath, ['--import', tsx, '--test', fixture], { cwd, env, encoding: 'utf8', timeout: 60_000 });
      const out = `${r.stdout}\n${r.stderr}`;
      assert.notEqual(r.status, 0, out);
      assert.match(out, /Refusing to run database tests/, out);
      assert.match(out, why, out);
      assert.equal(fs.existsSync(marker), false, `schema cleanup ran:\n${out}`);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
}

for (const file of DATABASE_TEST_FILES) {
  for (const [label, envExtra, why] of [
    ['no DATABASE_URL', {}, /not set in the environment/],
    ['a non-local host', { DATABASE_URL: 'postgres://u:p@not-a-database.invalid:1/scholario_ops_ui_test' }, /not this machine/],
    ['the development database', { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/scholario_ops_dev' }, /"scholario_ops_dev"/],
    ['an ambiguous PGDATABASE', { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/scholario_ops_ui_test', PGDATABASE: 'scholario_ops_dev' }, /ambiguous/],
  ] as const) {
    test(`${file} refuses to start with ${label} before any test runs`, () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-guard-'));
      // A .env in the working directory must not be consulted. Port 1: a fallback could not connect.
      fs.writeFileSync(path.join(cwd, '.env'), 'DATABASE_URL=postgres://u:p@127.0.0.1:1/scholario_ops_dev\n');
      try {
        const env: NodeJS.ProcessEnv = { ...process.env, PGPORT: '1', ...envExtra };
        delete env.NODE_TEST_CONTEXT;
        if (!('DATABASE_URL' in envExtra)) delete env.DATABASE_URL;
        const r = spawnSync(process.execPath, ['--import', tsx, '--test', path.join(here, file)], { cwd, env, encoding: 'utf8', timeout: 60_000 });
        const out = `${r.stdout}\n${r.stderr}`;
        assert.notEqual(r.status, 0, out);
        assert.match(out, /Refusing to run database tests/, out);
        assert.match(out, why, out);
        assert.match(out, /# pass 0/, out);
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    });
  }
}

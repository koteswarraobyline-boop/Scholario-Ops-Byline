/**
 * Isolated checks for the test-local database URL. No connection is opened.
 * Failure messages must not contain the password or the connection string.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareLocalTestDatabaseUrl, LocalTestDatabaseRefused, TEST_DATABASE } from '../scripts/test-database-url.mjs';

const SECRET = 's3cret-token';
const localDev = `postgresql://ops:${SECRET}@127.0.0.1:5432/scholario_ops_dev`;

function refused(raw: string, env: Record<string, string | undefined> = {}): LocalTestDatabaseRefused {
  try {
    prepareLocalTestDatabaseUrl(raw, env);
  } catch (err) {
    assert.ok(err instanceof LocalTestDatabaseRefused, err instanceof Error ? err.message : String(err));
    assert.equal(err.message.includes(SECRET), false);
    assert.equal(err.message.includes('postgresql://'), false);
    assert.equal(err.message.includes('postgres://'), false);
    return err;
  }
  assert.fail('expected the URL to be refused');
}

function accepted(raw: string, env: Record<string, string | undefined> = {}) {
  const prepared = prepareLocalTestDatabaseUrl(raw, env);
  const url = new URL(prepared.connectionString);
  assert.equal(prepared.database, TEST_DATABASE);
  assert.equal(prepared.hostname, url.hostname);
  assert.equal(decodeURIComponent(url.pathname.replace(/^\//, '')), TEST_DATABASE);
  assert.ok(url.password === SECRET);
  return { prepared, url };
}

test('a missing, empty, or unparsable URL is refused without echoing it', () => {
  assert.match(refused('').message, /missing or empty/);
  assert.match(refused('   ').message, /missing or empty/);
  assert.match(refused(`not a url ${SECRET}`).message, /not a valid URL/);
  assert.match(refused(`http://ops:${SECRET}@127.0.0.1/scholario_ops_dev`).message, /not a postgres URL/);
});

test('a non-local host is refused', () => {
  assert.match(refused(`postgresql://ops:${SECRET}@db.example:5432/scholario_ops_ui_test`).message, /db\.example/);
});

test('the original URL is validated before its database name is replaced', () => {
  assert.match(refused(`postgresql://ops:${SECRET}@127.0.0.1:5432/`).message, /does not name a database/);
  assert.match(refused(`postgresql://ops:${SECRET}@127.0.0.1:5432/postgres`).message, /protected database "postgres"/);
  assert.match(refused(`postgresql://ops:${SECRET}@127.0.0.1:5432/template0`).message, /protected database "template0"/);
  assert.match(refused(`postgresql://ops:${SECRET}@127.0.0.1:5432/template1`).message, /template1/);
  assert.match(refused(`postgresql://ops:${SECRET}@127.0.0.1:5432/scholario_ops_prodcopy`).message, /protected database "scholario_ops_prodcopy"/);
  assert.match(refused(`postgresql://ops:${SECRET}@127.0.0.1:5432/scholario_ops_dev#keep`).message, /fragment/);
});

test('query parameters that could redirect the connection are rejected and not kept', () => {
  for (const param of ['database', 'host', 'port', 'options', 'service', 'user', 'dbname']) {
    const err = refused(`${localDev}?${param}=scholario_ops_prodcopy`);
    assert.match(err.message, new RegExp(`parameter "${param}"`));
  }
  const { url } = accepted(`${localDev}?sslmode=require&application_name=scholario-test`);
  assert.deepEqual([...url.searchParams.keys()].sort(), ['application_name', 'sslmode']);
  assert.equal(url.searchParams.get('database'), null);
  assert.equal(url.searchParams.get('host'), null);
});

test('a local development database name is replaced; the connection target is only the disposable database', () => {
  for (const name of ['scholario_ops_dev', TEST_DATABASE]) {
    const { prepared } = accepted(`postgresql://ops:${SECRET}@localhost:5432/${name}`);
    assert.equal(prepared.sourceDatabase, name);
    assert.equal(prepared.database, TEST_DATABASE);
    assert.equal(prepared.hostname, 'localhost');
  }
});

test('libpq variables that could select another database are refused', () => {
  assert.match(refused(localDev, { PGDATABASE: 'scholario_ops_dev' }).message, /protected database/);
  assert.match(refused(localDev, { PGDATABASE: 'scholario_ops_prodcopy' }).message, /protected database/);
  assert.match(refused(localDev, { PGDATABASE: 'other' }).message, /different database/);
  assert.match(refused(localDev, { PGHOST: 'db.example' }).message, /PGHOST disagrees/);
  assert.match(refused(localDev, { PGHOSTADDR: '10.1.1.1' }).message, /PGHOSTADDR/);
  assert.match(refused(localDev, { PGSERVICE: 'prod' }).message, /PGSERVICE/);
  assert.match(refused(localDev, { PGOPTIONS: '-c search_path=public' }).message, /PGOPTIONS/);
  assert.match(refused('postgresql://ops:' + SECRET + '@127.0.0.1/scholario_ops_dev', { PGPORT: '5433' }).message, /PGPORT is set and DATABASE_URL has no port/);
  assert.match(refused(localDev, { PGPORT: '5433' }).message, /PGPORT disagrees/);
  const { prepared } = accepted(localDev, { PGHOST: '127.0.0.1', PGPORT: '5432', PGDATABASE: TEST_DATABASE });
  assert.equal(prepared.database, TEST_DATABASE);
});

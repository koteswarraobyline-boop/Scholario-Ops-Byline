/**
 * Decides the connection string for `npm run test:local` without connecting.
 *
 * The URL in the environment (often the local development database named in .env) is checked
 * first. Its database name is then replaced with scholario_ops_ui_test. Query parameters that
 * could point the connection somewhere else are rejected, not kept. Libpq variables that could
 * disagree with that result are rejected too. The returned string is for the test process only;
 * callers must not print it.
 */
export const TEST_DATABASE = 'scholario_ops_ui_test';
/** Databases a test command must never end up connected to. The approved target is not in this set. */
const PROTECTED_TARGETS = new Set(['scholario_ops_dev', 'scholario_ops_prodcopy', 'postgres', 'template0', 'template1']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** Parameters that only tune the connection. host, port, database, options, service, and anything else are refused. */
const ALLOWED_PARAMS = new Set(['sslmode', 'ssl', 'application_name', 'connect_timeout']);
const ALWAYS_AMBIGUOUS = ['PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGHOSTADDR'];

export class LocalTestDatabaseRefused extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'LocalTestDatabaseRefused';
  }
}

function envValue(env, name) {
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === name.toLowerCase() && typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
}

function databaseName(url) {
  let name;
  try { name = decodeURIComponent(url.pathname.replace(/^\//, '')); }
  catch { throw new LocalTestDatabaseRefused('the database name in DATABASE_URL cannot be decoded'); }
  if (name.includes('/') || name.includes('\\') || name.includes('@')) {
    throw new LocalTestDatabaseRefused('the database name in DATABASE_URL is not a single database name');
  }
  return name;
}

/**
 * Validates `raw` against `env`, then returns a connection string whose database is
 * scholario_ops_ui_test on the same local host. Does not connect. Does not read .env itself.
 * @param {string} raw
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ connectionString: string, hostname: string, database: string, sourceDatabase: string }}
 */
export function prepareLocalTestDatabaseUrl(raw, env = {}) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new LocalTestDatabaseRefused('DATABASE_URL is missing or empty');
  }
  let source;
  try { source = new URL(raw.trim()); }
  catch { throw new LocalTestDatabaseRefused('DATABASE_URL is not a valid URL'); }
  if (source.protocol !== 'postgres:' && source.protocol !== 'postgresql:') {
    throw new LocalTestDatabaseRefused('DATABASE_URL is not a postgres URL');
  }
  if (source.hash) throw new LocalTestDatabaseRefused('DATABASE_URL has a fragment, so the target is ambiguous');
  const host = source.hostname.toLowerCase();
  if (!LOCAL_HOSTS.has(host)) {
    throw new LocalTestDatabaseRefused(`the database host is ${source.hostname || '(none)'}, not this machine`);
  }
  const sourceDatabase = databaseName(source);
  if (sourceDatabase === '') throw new LocalTestDatabaseRefused('DATABASE_URL does not name a database');
  // scholario_ops_dev is the local database named in .env. Its name is replaced below and it is
  // never the connection target. A production copy, or a maintenance database, is refused outright.
  if (sourceDatabase === 'scholario_ops_prodcopy' || sourceDatabase === 'postgres' || sourceDatabase === 'template0' || sourceDatabase === 'template1') {
    throw new LocalTestDatabaseRefused(`DATABASE_URL names the protected database "${sourceDatabase}"`);
  }
  for (const key of source.searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key.toLowerCase())) {
      throw new LocalTestDatabaseRefused(`DATABASE_URL has the parameter "${key}", which could change where the connection goes`);
    }
  }

  // Rewrite only after the original URL has been accepted. Drop nothing silently: disallowed
  // parameters already threw. The approved target is always this database on the same host.
  const target = new URL(source.href);
  target.pathname = `/${TEST_DATABASE}`;
  target.hash = '';
  const database = databaseName(target);
  if (database !== TEST_DATABASE || PROTECTED_TARGETS.has(database) || !LOCAL_HOSTS.has(target.hostname.toLowerCase())) {
    throw new LocalTestDatabaseRefused('the test database target is not the local disposable database');
  }

  for (const key of ALWAYS_AMBIGUOUS) {
    if (envValue(env, key) !== undefined) {
      throw new LocalTestDatabaseRefused(`environment variable ${key} is set, so the database target is ambiguous`);
    }
  }
  const pgHost = envValue(env, 'PGHOST');
  if (pgHost !== undefined && pgHost.toLowerCase() !== target.hostname.toLowerCase()) {
    throw new LocalTestDatabaseRefused('PGHOST disagrees with DATABASE_URL, so the database target is ambiguous');
  }
  const pgDb = envValue(env, 'PGDATABASE');
  if (pgDb !== undefined && pgDb !== TEST_DATABASE) {
    const protectedName = PROTECTED_TARGETS.has(pgDb) ? 'a protected database' : 'a different database';
    throw new LocalTestDatabaseRefused(`PGDATABASE names ${protectedName}, so the database target is ambiguous`);
  }
  const pgPort = envValue(env, 'PGPORT');
  if (pgPort !== undefined && pgPort !== target.port) {
    throw new LocalTestDatabaseRefused(target.port
      ? 'PGPORT disagrees with DATABASE_URL, so the database target is ambiguous'
      : 'PGPORT is set and DATABASE_URL has no port, so the database target is ambiguous');
  }

  return { connectionString: target.toString(), hostname: target.hostname, database, sourceDatabase };
}

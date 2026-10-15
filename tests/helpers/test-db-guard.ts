/**
 * Fail-closed guard for database-backed tests: they may only ever touch the disposable local
 * database scholario_ops_ui_test.
 *
 * - Reads DATABASE_URL from the process environment only (set by `npm run test:local`). The .env
 *   file is never consulted, so its database (scholario_ops_dev) cannot be used as a fallback.
 *   Call pinTestDatabaseUrl() before dotenv.config() and before importing server code (server/config.ts
 *   loads .env on import and does not override a variable that is already set).
 * - Refuses a missing, empty or unparsable URL, a non-local host, any other database name, and any
 *   query parameter that could redirect the connection (pg applies ?host= / ?database= / … on top
 *   of the URL).
 * - Refuses an ambiguous target: a libpq variable (PGHOST, PGHOSTADDR, PGPORT, PGDATABASE, PGSERVICE,
 *   PGSERVICEFILE, PGOPTIONS) that could send a client somewhere other than that URL. node-pg uses
 *   PGPORT when the URL omits the port, and libpq uses PGHOSTADDR / a service file in preference to
 *   parts of the URL.
 * - After connecting, confirms the server reports current_database() = scholario_ops_ui_test on a
 *   loopback address; any failure to establish that is a refusal too.
 * - dropVerifiedTestSchema() is the only schema cleanup. It does nothing unless that confirmation
 *   has already succeeded, so a refused target cannot drop a schema.
 */
export const TEST_DATABASE = 'scholario_ops_ui_test';
/** Names a test must never CREATE or DROP. scholario_ops_ui_test is the only database tests may connect to, and they must not drop it. */
export const PROTECTED_DATABASES = ['scholario_ops_dev', 'scholario_ops_prodcopy', 'scholario_ops_ui_test', 'postgres', 'template0', 'template1'] as const;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** Parameters that only tune the connection; anything else is refused */
const ALLOWED_PARAMS = new Set(['sslmode', 'ssl', 'application_name', 'connect_timeout']);
/** Set at all → the target is defined outside the URL (service file or startup options) */
const ALWAYS_AMBIGUOUS = ['PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGHOSTADDR'] as const;

export class TestDatabaseRefused extends Error {
  constructor(reason: string) {
    super(`Refusing to run database tests: ${reason}. Run them with "npm run test:local" (database ${TEST_DATABASE} only).`);
  }
}

const envValue = (env: Record<string, string | undefined>, name: string): string | undefined => {
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === name.toLowerCase() && typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
};

/** The connection string to use, or throws TestDatabaseRefused. Does not read .env and does not connect. */
export function resolveTestDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.DATABASE_URL;
  if (typeof raw !== 'string' || raw.trim() === '') throw new TestDatabaseRefused('DATABASE_URL is not set in the environment (the .env file is deliberately not used, and PGHOST / PGDATABASE / PGPORT are not a fallback)');
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new TestDatabaseRefused('DATABASE_URL is not a valid URL'); }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new TestDatabaseRefused(`DATABASE_URL protocol ${u.protocol} is not postgres:`);
  if (!LOCAL_HOSTS.has(u.hostname.toLowerCase())) throw new TestDatabaseRefused('the database host is not this machine');
  let name: string;
  try { name = decodeURIComponent(u.pathname.replace(/^\//, '')); } catch { throw new TestDatabaseRefused('the database name cannot be decoded'); }
  if (name !== TEST_DATABASE) throw new TestDatabaseRefused(`the database is "${name || '(none)'}", not ${TEST_DATABASE}`);
  for (const key of u.searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key.toLowerCase())) throw new TestDatabaseRefused(`DATABASE_URL has the parameter "${key}", which could change the target`);
  }
  for (const key of ALWAYS_AMBIGUOUS) {
    if (envValue(env, key) !== undefined) throw new TestDatabaseRefused(`environment variable ${key} is set, so the database target is ambiguous`);
  }
  const pgHost = envValue(env, 'PGHOST');
  if (pgHost !== undefined && pgHost.toLowerCase() !== u.hostname.toLowerCase()) {
    throw new TestDatabaseRefused('PGHOST disagrees with DATABASE_URL, so the database target is ambiguous');
  }
  const pgDb = envValue(env, 'PGDATABASE');
  if (pgDb !== undefined && pgDb !== TEST_DATABASE) {
    throw new TestDatabaseRefused(`PGDATABASE is "${pgDb}", which disagrees with DATABASE_URL, so the database target is ambiguous`);
  }
  const pgPort = envValue(env, 'PGPORT');
  if (pgPort !== undefined && pgPort !== u.port) {
    // No explicit port in the URL: node-pg and libpq fill it from PGPORT, which can point elsewhere
    throw new TestDatabaseRefused(u.port
      ? 'PGPORT disagrees with DATABASE_URL, so the database target is ambiguous'
      : 'PGPORT is set and DATABASE_URL has no port, so the database target is ambiguous');
  }
  return u.toString();
}

/**
 * Resolves the approved URL and pins it onto env.DATABASE_URL so a later dotenv.config() cannot
 * replace it. Call before dotenv and before importing server code. Throws before any connection.
 */
export function pinTestDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const url = resolveTestDatabaseUrl(env);
  env.DATABASE_URL = url;
  return url;
}

/**
 * Drops a throw-away schema only after assertConnectedToTestDatabase has succeeded.
 * A refused target leaves `verified` false, and this does nothing — including when an after()
 * hook still runs because before() failed.
 */
export async function dropVerifiedTestSchema(verified: boolean, drop: () => Promise<unknown>): Promise<void> {
  if (verified !== true) return;
  await drop();
}

/** A scratch database name tests may create on the already-verified local server. Never a protected database. */
export function assertScratchDatabaseName(name: string): void {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name) || (PROTECTED_DATABASES as readonly string[]).includes(name)) {
    throw new TestDatabaseRefused(`refusing to create or drop the database "${name}"`);
  }
}

/** Confirms what the connected server reports; throws TestDatabaseRefused otherwise (also when the check itself fails) */
export async function assertConnectedToTestDatabase(client: { query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> }): Promise<void> {
  let row: Record<string, unknown> | undefined;
  try { row = (await client.query('select current_database() as db, host(inet_server_addr()) as addr')).rows[0]; }
  catch (err) { throw new TestDatabaseRefused(`could not confirm the connected database (${(err as Error).message})`); }
  if (!row || row.db !== TEST_DATABASE) throw new TestDatabaseRefused(`connected database is "${String(row?.db ?? '(unknown)')}", not ${TEST_DATABASE}`);
  // NULL address = Unix-domain socket (local)
  if (row.addr !== null && row.addr !== undefined && row.addr !== '127.0.0.1' && row.addr !== '::1') {
    throw new TestDatabaseRefused(`connected server address ${String(row.addr)} is not a loopback address`);
  }
}

/**
 * PostgreSQL connection + migrations.
 * All tables live in DB_SCHEMA (default "ops") so they never collide with other
 * tables in the same database (e.g. the legacy "public" tables).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { config } from './config.ts';
import { log } from './logger.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(config.dbSchema)) {
  throw new Error(`DB_SCHEMA "${config.dbSchema}" is invalid (use lower-case letters, digits and _)`);
}
export const SCHEMA = config.dbSchema;
/** Schema-qualified table name */
export const T = (table: string) => `${SCHEMA}.${table}`;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is not set. Scholario Ops stores its configuration and data in PostgreSQL — set DATABASE_URL in .env (see .env.example).');
    }
    pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
    pool.on('error', err => log.error('db', `idle client error: ${err.message}`));
  }
  return pool;
}

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<pg.QueryResult<R>> {
  return getPool().query<R>(text, params);
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Locates server/migrations both when running from source (tsx) and from the esbuild bundle (dist-server/). */
function migrationsDir(): string {
  const candidates = [path.join(__dirname, 'migrations'), path.join(__dirname, '..', 'server', 'migrations')];
  const found = candidates.find(d => fs.existsSync(d));
  if (!found) throw new Error(`Migrations folder not found (looked in ${candidates.join(', ')})`);
  return found;
}

/** Applies server/migrations/*.sql in order, once each, inside transactions. */
export async function migrate(): Promise<string[]> {
  await query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await query(`CREATE TABLE IF NOT EXISTS ${T('schema_migrations')} (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await query<{ name: string }>(`SELECT name FROM ${T('schema_migrations')}`)).rows.map(r => r.name));
  const dir = migrationsDir();
  const files = fs.readdirSync(dir).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8').replaceAll('{{schema}}', SCHEMA);
    await withTransaction(async c => {
      await c.query(sql);
      await c.query(`INSERT INTO ${T('schema_migrations')} (name) VALUES ($1)`, [file]);
    });
    ran.push(file);
  }
  return ran;
}

export async function closePool() {
  if (pool) { await pool.end().catch(() => {}); pool = null; }
}

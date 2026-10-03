import { Pool, PoolClient } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.db.url,
      min: config.db.poolMin,
      max: config.db.poolMax,
      ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected PostgreSQL pool error');
    });

    pool.on('connect', () => {
      logger.debug('PostgreSQL: new client connected');
    });
  }
  return pool;
}

export async function query<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const start = Date.now();
  const pool = getPool();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  logger.debug({ query: text.slice(0, 80), duration, rows: res.rowCount }, 'db query');
  return res.rows as T[];
}

export async function queryOne<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL pool closed');
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    const result = await query<{ now: Date }>('SELECT NOW()');
    logger.info({ time: result[0]?.now }, 'PostgreSQL connected');
    return true;
  } catch (err) {
    logger.error({ err }, 'PostgreSQL connection failed');
    return false;
  }
}

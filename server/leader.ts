/**
 * Single worker for notification escalation, reminders and delayed first pages: a PostgreSQL
 * session advisory lock held on one dedicated connection. If a second Scholario Ops process points
 * at the same database (accidental double start, blue/green overlap), only the lock holder sends —
 * no duplicate escalations. The lock is released automatically when the holder's connection ends
 * (crash, stop); the other process takes over on its next attempt.
 *
 * Before startLeaderElection() is called (unit tests, scripts) this process counts as the worker.
 */
import pg from 'pg';
import crypto from 'crypto';
import { getPool, SCHEMA } from './db.ts';
import { log } from './logger.ts';

/** Lock key: stable per schema, so separate deployments on one database do not block each other */
export const LOCK_KEY = BigInt.asIntN(64, BigInt('0x' + crypto.createHash('sha256').update(`scholario-ops:escalation:${SCHEMA}`).digest('hex').slice(0, 16)));

let state: 'standalone' | 'leader' | 'follower' = 'standalone';
let client: pg.PoolClient | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export const isNotificationWorker = () => state !== 'follower';
export const workerState = () => state;

/** One attempt to take the lock; keeps the connection open while holding it */
export async function tryAcquire(): Promise<boolean> {
  if (client) return true;
  let c: pg.PoolClient | null = null;
  try {
    c = await getPool().connect();
    const got = (await c.query('SELECT pg_try_advisory_lock($1::bigint) AS ok', [LOCK_KEY.toString()])).rows[0].ok === true;
    if (!got) { c.release(); state = 'follower'; return false; }
    client = c;
    c.on('error', err => {
      log.error('leader', `lost the escalation lock connection: ${err.message}`);
      client = null; state = 'follower';
    });
    if (state !== 'leader') log.info('leader', 'this process runs notification escalation (advisory lock held)');
    state = 'leader';
    return true;
  } catch (err) {
    c?.release();
    state = 'follower';
    log.error('leader', `could not take the escalation lock: ${(err as Error).message}`);
    return false;
  }
}

/** Takes the lock now and retries every intervalMs while another process holds it */
export function startLeaderElection(intervalMs = 30_000) {
  void tryAcquire().then(ok => { if (!ok) log.warn('leader', 'another Scholario Ops process holds the escalation lock — this one will not send escalations or reminders'); });
  timer = setInterval(() => { if (!client) void tryAcquire(); }, intervalMs);
  timer.unref();
}

/** Releases the lock (shutdown / tests) */
export async function releaseLeadership() {
  if (timer) { clearInterval(timer); timer = null; }
  if (client) {
    try { await client.query('SELECT pg_advisory_unlock($1::bigint)', [LOCK_KEY.toString()]); } catch { /* connection already gone */ }
    client.release();
    client = null;
  }
  state = 'standalone';
}

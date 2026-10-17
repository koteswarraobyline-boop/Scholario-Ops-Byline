/**
 * Notification delivery log (table notification_deliveries): one row per notification sent to a
 * channel, with the result, attempts and error. Written through a small bounded queue so a slow or
 * unavailable database never delays an alert; read by the Notifications page.
 */
import crypto from 'crypto';
import type { NotificationDelivery, NotificationDeliveryKind } from '../src/types/index.ts';
import { query, T, withTransaction } from './db.ts';
import { config } from './config.ts';
import { log } from './logger.ts';

export interface DeliveryMessage {
  title: string;
  text: string;
  severity: string;
  status: NotificationDeliveryKind;
  incidentId?: string;
  link?: string;
}

let queue: NotificationDelivery[] = [];
let writing: Promise<void> | null = null;
/** Bounded memory while PostgreSQL is unavailable (oldest dropped first) */
const MAX_QUEUED = 5_000;

export function recordDelivery(entry: Omit<NotificationDelivery, 'id' | 't'> & { t?: string }): NotificationDelivery {
  const row: NotificationDelivery = { id: crypto.randomUUID(), t: entry.t ?? new Date().toISOString(), ...entry };
  queue.push(row);
  if (queue.length > MAX_QUEUED) queue.splice(0, queue.length - MAX_QUEUED);
  void flushDeliveries();
  return row;
}

export async function flushDeliveries(): Promise<void> {
  if (writing) { await writing; }
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  writing = (async () => {
    try {
      for (const r of batch) {
        await query(
          `INSERT INTO ${T('notification_deliveries')} (id,t,channel_id,channel_name,channel_type,kind,incident_id,severity,title,result,attempts,duration_ms,error,resend_of,message)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (id) DO NOTHING`,
          [r.id, r.t, r.channelId, r.channelName, r.channelType, r.kind, r.incidentId ?? null, r.severity, r.title.slice(0, 500), r.result,
            r.attempts, r.durationMs, r.error ? r.error.slice(0, 1000) : null, r.resendOf ?? null, JSON.stringify(r.message)],
        );
      }
    } catch (err) {
      queue = batch.concat(queue).slice(-MAX_QUEUED);
      log.error('deliveries', `could not write the notification log: ${(err as Error).message}`);
    } finally {
      writing = null;
    }
  })();
  await writing;
}

type Row = Record<string, unknown>;
const fromRow = (r: Row): NotificationDelivery => ({
  id: r.id as string, t: (r.t as Date).toISOString(), channelId: r.channel_id as string, channelName: r.channel_name as string,
  channelType: r.channel_type as string, kind: r.kind as NotificationDeliveryKind, incidentId: (r.incident_id as string | null) ?? undefined,
  severity: r.severity as string, title: r.title as string, result: r.result as NotificationDelivery['result'], attempts: Number(r.attempts),
  durationMs: Number(r.duration_ms), error: (r.error as string | null) ?? undefined, resendOf: (r.resend_of as string | null) ?? undefined,
  message: r.message as DeliveryMessage,
});

export interface DeliveryFilter {
  channelId?: string;
  result?: 'DELIVERED' | 'FAILED';
  kind?: NotificationDeliveryKind;
  incidentId?: string;
  /** Text search in title, channel name and incident id (case-insensitive) */
  q?: string;
  /** Only rows this user has not read */
  unread?: boolean;
  sort?: 'newest' | 'oldest';
  page: number;
  pageSize: number;
}

/** "Delivery d is read by the user": an explicit mark wins; otherwise older than the user's mark-all-read time */
const IS_READ = 'COALESCE(r.is_read, d.t <= m.all_read_before, false)';
/** Joins the read state of the user bound as $1 */
const READ_JOINS = () =>
  `LEFT JOIN ${T('notification_reads')} r ON r.delivery_id = d.id AND r.user_id = $1
   LEFT JOIN ${T('notification_read_marks')} m ON m.user_id = $1`;

export async function listDeliveries(f: DeliveryFilter, userId: string) {
  await flushDeliveries();
  const params: unknown[] = [userId];
  const where: string[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (f.channelId) add('d.channel_id = ?', f.channelId);
  if (f.result) add('d.result = ?', f.result);
  if (f.kind) add('d.kind = ?', f.kind);
  if (f.incidentId) add('d.incident_id = ?', f.incidentId);
  if (f.q) add('(d.title ILIKE ? OR d.channel_name ILIKE ? OR d.incident_id ILIKE ?)', `%${f.q.replace(/[\\%_]/g, c => `\\${c}`)}%`);
  if (f.unread) where.push(`NOT ${IS_READ}`);
  const from = `FROM ${T('notification_deliveries')} d ${READ_JOINS()} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const total = Number((await query(`SELECT count(*)::int n ${from}`, params)).rows[0].n);
  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const rows = (await query(
    `SELECT d.*, ${IS_READ} AS is_read ${from} ORDER BY d.t ${f.sort === 'oldest' ? 'ASC' : 'DESC'}, d.id ${f.sort === 'oldest' ? 'ASC' : 'DESC'} LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )).rows;
  return {
    data: rows.map(r => ({ ...fromRow(r), read: Boolean(r.is_read) })),
    pagination: { page: f.page, pageSize: f.pageSize, total, totalPages: Math.max(1, Math.ceil(total / f.pageSize)) },
  };
}

/** Unread deliveries for this user (all, and failed ones — the number that needs attention) */
export async function unreadCounts(userId: string): Promise<{ unread: number; unreadFailed: number }> {
  await flushDeliveries();
  const r = (await query(
    `SELECT count(*)::int unread, count(*) FILTER (WHERE d.result = 'FAILED')::int unread_failed
       FROM ${T('notification_deliveries')} d ${READ_JOINS()} WHERE NOT ${IS_READ}`, [userId])).rows[0];
  return { unread: Number(r.unread), unreadFailed: Number(r.unread_failed) };
}

/** Marks deliveries read / unread for one user. Unknown ids are ignored. Returns how many were marked. */
export async function setRead(userId: string, ids: string[], read: boolean): Promise<number> {
  const valid = [...new Set(ids)].filter(id => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 500);
  if (!valid.length) return 0;
  await flushDeliveries();
  const res = await query(
    `INSERT INTO ${T('notification_reads')} (user_id, delivery_id, is_read, marked_at)
       SELECT $1, d.id, $3, now() FROM ${T('notification_deliveries')} d WHERE d.id = ANY($2::uuid[])
     ON CONFLICT (user_id, delivery_id) DO UPDATE SET is_read = EXCLUDED.is_read, marked_at = EXCLUDED.marked_at`,
    [userId, valid, read]);
  return res.rowCount ?? 0;
}

/** Everything up to now is read for this user (one row); earlier individual marks are no longer needed */
export async function markAllRead(userId: string): Promise<void> {
  await flushDeliveries();
  await withTransaction(async c => {
    await c.query(
      `INSERT INTO ${T('notification_read_marks')} (user_id, all_read_before) VALUES ($1, now())
       ON CONFLICT (user_id) DO UPDATE SET all_read_before = EXCLUDED.all_read_before`, [userId]);
    await c.query(`DELETE FROM ${T('notification_reads')} WHERE user_id = $1`, [userId]);
  });
}

/** Every delivery row for one incident, oldest first. */
export async function deliveriesForIncident(incidentId: string): Promise<NotificationDelivery[]> {
  await flushDeliveries();
  const rows = (await query(`SELECT * FROM ${T('notification_deliveries')} WHERE incident_id = $1 ORDER BY t ASC, id ASC`, [incidentId])).rows;
  return rows.map(fromRow);
}

export async function getDelivery(id: string): Promise<NotificationDelivery | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  await flushDeliveries();
  const r = (await query(`SELECT * FROM ${T('notification_deliveries')} WHERE id = $1`, [id])).rows[0];
  return r ? fromRow(r) : null;
}

/** One delivery with the user's read state */
export async function getDeliveryForUser(id: string, userId: string): Promise<(NotificationDelivery & { read: boolean }) | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  await flushDeliveries();
  const r = (await query(`SELECT d.*, ${IS_READ} AS is_read FROM ${T('notification_deliveries')} d ${READ_JOINS()} WHERE d.id = $2`, [userId, id])).rows[0];
  return r ? { ...fromRow(r), read: Boolean(r.is_read) } : null;
}

/**
 * Every send of the same message: the original and all its resends (and resends of resends),
 * oldest first — the full attempt history of one notification on one channel.
 */
export async function deliveryChain(id: string): Promise<NotificationDelivery[]> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return [];
  await flushDeliveries();
  const rows = (await query(
    `WITH RECURSIVE up AS (
       SELECT id, resend_of, 0 AS depth FROM ${T('notification_deliveries')} WHERE id = $1
       UNION ALL
       SELECT d.id, d.resend_of, up.depth + 1 FROM ${T('notification_deliveries')} d JOIN up ON d.id = up.resend_of WHERE up.depth < 50
     ), root AS (SELECT id FROM up WHERE resend_of IS NULL OR depth = 50 LIMIT 1),
     down AS (
       SELECT d.*, 0 AS depth FROM ${T('notification_deliveries')} d WHERE d.id = (SELECT id FROM root)
       UNION ALL
       SELECT d.*, down.depth + 1 FROM ${T('notification_deliveries')} d JOIN down ON d.resend_of = down.id WHERE down.depth < 50
     )
     SELECT * FROM down ORDER BY t ASC LIMIT 100`, [id])).rows;
  return rows.map(fromRow);
}

/** Delivered / failed per channel over the last `hours` (default 24) + the latest failure reason */
export async function deliveryStats(hours = 24) {
  await flushDeliveries();
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const rows = (await query(
    `SELECT channel_id, count(*) FILTER (WHERE result = 'DELIVERED')::int delivered, count(*) FILTER (WHERE result = 'FAILED')::int failed,
            (array_agg(error ORDER BY t DESC) FILTER (WHERE result = 'FAILED'))[1] last_error
       FROM ${T('notification_deliveries')} WHERE t >= $1 GROUP BY channel_id`, [since])).rows;
  return { hours, channels: Object.fromEntries(rows.map(r => [r.channel_id as string, { delivered: Number(r.delivered), failed: Number(r.failed), lastError: (r.last_error as string | null) ?? null }])) };
}

/** Starts periodic pruning (call after the store is ready) */
export function startDeliveryLog() {
  const prune = () => {
    const cutoff = new Date(Date.now() - config.notificationLogRetentionDays * 86_400_000).toISOString();
    void query(`DELETE FROM ${T('notification_deliveries')} WHERE t < $1`, [cutoff]).catch(err => log.error('deliveries', `prune failed: ${(err as Error).message}`));
  };
  prune();
  setInterval(prune, 6 * 3600 * 1000).unref();
}

/** Delivered FIRING messages in the window: replay uses them so a summary sent just before a crash is not sent twice */
export async function recentDeliveredFiringMessages(hours = 24): Promise<Array<{ incidentId?: string; text: string }>> {
  await flushDeliveries();
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const rows = (await query(
    `SELECT incident_id, message FROM ${T('notification_deliveries')}
      WHERE t >= $1 AND kind = 'FIRING' AND result = 'DELIVERED' AND resend_of IS NULL`, [since])).rows;
  return rows.map(r => ({
    incidentId: (r.incident_id as string | null) ?? undefined,
    text: (r.message as { text?: string } | null)?.text ?? '',
  }));
}

/** Last FIRING / RESOLVED send per incident + severity (for duplicate protection after a restart) */
export async function recentIncidentSends(hours = 24): Promise<Array<{ incidentId: string; kind: 'FIRING' | 'RESOLVED'; severity: string; t: string; delivered: boolean }>> {
  await flushDeliveries();
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const rows = (await query(
    `SELECT incident_id, kind, severity, max(t) AS t, bool_or(result = 'DELIVERED') AS delivered
       FROM ${T('notification_deliveries')}
      WHERE t >= $1 AND incident_id IS NOT NULL AND kind IN ('FIRING', 'RESOLVED') AND resend_of IS NULL
      GROUP BY incident_id, kind, severity`, [since])).rows;
  return rows.map(r => ({ incidentId: r.incident_id as string, kind: r.kind as 'FIRING' | 'RESOLVED', severity: r.severity as string, t: (r.t as Date).toISOString(), delivered: Boolean(r.delivered) }));
}

/** Log rows not yet written to PostgreSQL */
export const pendingLogWrites = () => queue.length;

/** Delivery health over the last `hours`: volume, success rate, retries, latency, per channel */
export async function deliveryHealth(hours = 24) {
  await flushDeliveries();
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const t = (await query(
    `SELECT count(*)::int total,
            count(*) FILTER (WHERE result = 'DELIVERED')::int delivered,
            count(*) FILTER (WHERE result = 'FAILED')::int failed,
            coalesce(sum(attempts - 1), 0)::int retries,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
       FROM ${T('notification_deliveries')} WHERE t >= $1`, [since])).rows[0];
  const per = (await query(
    `SELECT channel_id, max(channel_name) AS channel_name,
            count(*) FILTER (WHERE result = 'DELIVERED')::int delivered,
            count(*) FILTER (WHERE result = 'FAILED')::int failed,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
            max(t) FILTER (WHERE result = 'DELIVERED') AS last_ok,
            max(t) FILTER (WHERE result = 'FAILED') AS last_fail,
            (array_agg(error ORDER BY t DESC) FILTER (WHERE result = 'FAILED'))[1] AS last_error
       FROM ${T('notification_deliveries')} WHERE t >= $1 GROUP BY channel_id`, [since])).rows;
  const total = Number(t.total);
  return {
    hours,
    total, delivered: Number(t.delivered), failed: Number(t.failed), retries: Number(t.retries),
    successRate: total ? Math.round((Number(t.delivered) / total) * 1000) / 10 : null,
    p50Ms: t.p50 === null ? null : Math.round(Number(t.p50)), p95Ms: t.p95 === null ? null : Math.round(Number(t.p95)),
    channels: per.map(r => ({
      channelId: r.channel_id as string, channelName: r.channel_name as string,
      delivered: Number(r.delivered), failed: Number(r.failed), p95Ms: r.p95 === null ? null : Math.round(Number(r.p95)),
      lastDeliveredAt: r.last_ok ? (r.last_ok as Date).toISOString() : null, lastFailedAt: r.last_fail ? (r.last_fail as Date).toISOString() : null,
      lastError: (r.last_error as string | null) ?? null,
    })),
  };
}

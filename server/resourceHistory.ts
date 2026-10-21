/**
 * Accepted resource measurements, stored in PostgreSQL table resource_measurements.
 * Kept for CHECK_HISTORY_RETENTION_DAYS. Not loaded into the in-memory store.
 * One Node process appends these rows. There is no lock across multiple processes.
 */
import type { ResourceLimit } from '../src/types/index.ts';
import { config } from './config.ts';
import { query, T } from './db.ts';
import { log } from './logger.ts';

export interface ResourceMeasurementPoint {
  measuredAt: string;
  usage: number;
  capacity: number | null;
  unit: string;
  source: string;
  alertState: string;
}

interface QueuedMeasurement extends ResourceMeasurementPoint {
  resourceId: string;
}

let queue: QueuedMeasurement[] = [];
let writing: Promise<void> | null = null;
const MAX_QUEUED = 20_000;

async function writeQueued(): Promise<void> {
  if (writing) { await writing; return writeQueued(); }
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  writing = (async () => {
    let i = 0;
    try {
      for (; i < batch.length; i += 200) {
        const params: unknown[] = [];
        const tuples = batch.slice(i, i + 200).map(row => {
          params.push(row.resourceId, row.measuredAt, row.usage, row.capacity, row.unit, row.source, row.alertState);
          const n = params.length;
          return `(${Array.from({ length: 7 }, (_, k) => `$${n - 6 + k}`).join(',')})`;
        });
        await query(
          `INSERT INTO ${T('resource_measurements')} (resource_id, measured_at, usage, capacity, unit, source, alert_state) VALUES ${tuples.join(',')}
           ON CONFLICT (resource_id, measured_at) DO UPDATE SET
             usage = EXCLUDED.usage, capacity = EXCLUDED.capacity, unit = EXCLUDED.unit,
             source = EXCLUDED.source, alert_state = EXCLUDED.alert_state`,
          params,
        );
      }
    } catch (err) {
      queue = batch.slice(i).concat(queue);
      if (queue.length > MAX_QUEUED) queue = queue.slice(queue.length - MAX_QUEUED);
      log.error('capacity', `failed to write resource measurements: ${(err as Error).message}`);
    } finally {
      writing = null;
    }
  })();
  await writing;
}

/** Queues one sample. Call only after evaluation, and only when this measurement changed usage. */
export function recordResourceMeasurement(row: ResourceLimit): void {
  if (row.usage === null || row.measuredAt === null) return;
  queue.push({
    resourceId: row.id,
    measuredAt: row.measuredAt,
    usage: row.usage,
    capacity: row.capacity,
    unit: row.unit,
    source: row.source,
    alertState: row.alertState,
  });
  void writeQueued();
}

export async function readResourceMeasurements(resourceId: string, limit = 100): Promise<ResourceMeasurementPoint[]> {
  await writeQueued();
  const res = await query(
    `SELECT measured_at, usage, capacity, unit, source, alert_state
     FROM ${T('resource_measurements')} WHERE resource_id = $1
     ORDER BY measured_at DESC LIMIT $2`,
    [resourceId, limit],
  );
  return res.rows.map(r => ({
    measuredAt: (r.measured_at as Date).toISOString(),
    usage: Number(r.usage),
    capacity: r.capacity === null || r.capacity === undefined ? null : Number(r.capacity),
    unit: String(r.unit),
    source: String(r.source),
    alertState: String(r.alert_state),
  }));
}

export async function flushResourceMeasurements(): Promise<void> {
  await writeQueued();
}

/** Deletes samples older than CHECK_HISTORY_RETENTION_DAYS. Returns how many rows were removed. */
export async function pruneResourceMeasurements(): Promise<number> {
  const cutoff = new Date(Date.now() - config.checkHistoryRetentionDays * 86_400_000).toISOString();
  const res = await query(`DELETE FROM ${T('resource_measurements')} WHERE measured_at < $1`, [cutoff]);
  return res.rowCount ?? 0;
}

export function startResourceHistory(): void {
  setInterval(() => { void writeQueued(); }, 2000).unref();
  const prune = () => { void pruneResourceMeasurements().catch(err => log.error('capacity', `measurement prune failed: ${(err as Error).message}`)); };
  prune();
  setInterval(prune, 6 * 3600 * 1000).unref();
}

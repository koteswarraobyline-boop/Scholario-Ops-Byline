/**
 * Every monitor check result (and every Cloudflare origin-health sample), stored in
 * PostgreSQL table check_results and kept for CHECK_HISTORY_RETENTION_DAYS.
 * Used for latency charts, availability and SLA reports.
 */
import { CheckRecord } from '../src/types/index.ts';
import { config } from './config.ts';
import { query, T } from './db.ts';
import { log } from './logger.ts';

const queue: CheckRecord[] = [];
let writing: Promise<void> | null = null;

async function writeQueued(): Promise<void> {
  if (writing) { await writing; }
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  writing = (async () => {
    try {
      for (let i = 0; i < batch.length; i += 200) {
        const params: unknown[] = [];
        const tuples = batch.slice(i, i + 200).map(r => {
          params.push(r.t, r.monitorId, r.applicationId ?? '', r.environment, r.target, r.ok, r.probeStatus, r.statusCode, r.latencyMs, r.reason ?? '');
          const n = params.length;
          return `(${Array.from({ length: 10 }, (_, k) => `$${n - 9 + k}`).join(',')})`;
        });
        await query(`INSERT INTO ${T('check_results')} (t,monitor_id,application_id,environment,target,ok,probe_status,status_code,latency_ms,reason) VALUES ${tuples.join(',')}`, params);
      }
    } catch (err) {
      queue.unshift(...batch);
      log.error('history', `failed to write check records: ${(err as Error).message}`);
    } finally {
      writing = null;
    }
  })();
  await writing;
}

export function recordCheck(rec: CheckRecord) {
  queue.push(rec);
  if (queue.length >= 100) void writeQueued();
}

/**
 * Check records with t >= sinceMs, oldest first. Filter by monitor ids and/or a monitor id prefix
 * (e.g. "cf-origin:<poolId>:" for Cloudflare origin samples).
 */
export async function readChecks(sinceMs: number, monitorIds?: string[], idPrefix?: string): Promise<CheckRecord[]> {
  await writeQueued();
  const params: unknown[] = [new Date(sinceMs).toISOString()];
  let where = 't >= $1';
  if (monitorIds) { params.push(monitorIds); where += ` AND monitor_id = ANY($${params.length})`; }
  if (idPrefix) { params.push(`${idPrefix.replace(/[\\%_]/g, m => `\\${m}`)}%`); where += ` AND monitor_id LIKE $${params.length}`; }
  const res = await query(`SELECT t, monitor_id, application_id, environment, target, ok, probe_status, status_code, latency_ms, reason FROM ${T('check_results')} WHERE ${where} ORDER BY t`, params);
  return res.rows.map(r => ({
    t: (r.t as Date).toISOString(), monitorId: r.monitor_id, applicationId: r.application_id, environment: r.environment, target: r.target,
    ok: r.ok, probeStatus: r.probe_status, statusCode: r.status_code, latencyMs: Number(r.latency_ms), reason: r.reason,
  }));
}

export interface AvailabilityStats {
  total: number;
  ok: number;
  /** null when there are no checks in the window */
  availabilityPercent: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  firstCheckAt: string | null;
  lastCheckAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  byStatus: Record<string, number>;
}

export function availability(records: CheckRecord[]): AvailabilityStats {
  const okRecs = records.filter(r => r.ok);
  const lat = okRecs.map(r => r.latencyMs).sort((a, b) => a - b);
  const byStatus: Record<string, number> = {};
  for (const r of records) byStatus[r.probeStatus] = (byStatus[r.probeStatus] ?? 0) + 1;
  const last = (pred: (r: CheckRecord) => boolean) => {
    for (let i = records.length - 1; i >= 0; i--) if (pred(records[i])) return records[i].t;
    return null;
  };
  return {
    total: records.length,
    ok: okRecs.length,
    availabilityPercent: records.length ? Math.round((okRecs.length / records.length) * 10000) / 100 : null,
    avgLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
    p95LatencyMs: lat.length ? lat[Math.min(lat.length - 1, Math.ceil(0.95 * lat.length) - 1)] : null,
    firstCheckAt: records[0]?.t ?? null,
    lastCheckAt: records[records.length - 1]?.t ?? null,
    lastSuccessAt: last(r => r.ok),
    lastFailureAt: last(r => !r.ok),
    byStatus,
  };
}

export async function flushChecks() { await writeQueued(); }

/** Starts the periodic writer and retention pruning (call after the store is ready). */
export function startHistory() {
  setInterval(() => { void writeQueued(); }, 2000).unref();
  const prune = () => {
    const cutoff = new Date(Date.now() - config.checkHistoryRetentionDays * 86_400_000).toISOString();
    void query(`DELETE FROM ${T('check_results')} WHERE t < $1`, [cutoff]).catch(err => log.error('history', `prune failed: ${(err as Error).message}`));
  };
  prune();
  setInterval(prune, 6 * 3600 * 1000).unref();
}

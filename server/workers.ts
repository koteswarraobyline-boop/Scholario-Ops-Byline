/**
 * Optional, read-only Cloudflare Worker checks.
 * Script source is never downloaded. Binding values are never read.
 * Request counts stay null until a Worker posts events with WORKER_EVENTS_TOKEN.
 * Nothing in this file deploys a Worker or changes a route.
 */
import { WorkerAppSnapshot, WorkerEventKind, WorkerMonitorState, WorkerRoutingEvent } from '../src/types/index.ts';
import { effectiveRoutingMethod, normalizeRouting } from '../src/lib/trafficHealth.ts';
import { config, isCloudflareConfigured } from './config.ts';
import { safeEqual } from './auth.ts';
import { cf, CloudflareError } from './cloudflare.ts';
import { db, persist } from './store.ts';
import { broadcast } from './events.ts';
import { log } from './logger.ts';

export const WORKER_PERMISSION_HINT = 'Cloudflare permission required for Worker configuration reads: Account › Workers Scripts › Read. Workers Analytics is not called. Request counts stay "Not connected" unless the Worker posts events and WORKER_EVENTS_TOKEN is set on this server. The token is never sent to the browser.';

const EVENT_KINDS: readonly WorkerEventKind[] = ['origin_selected', 'failover', 'failback', 'origin_error', 'health'];
const HEALTHS = ['healthy', 'unhealthy', 'unknown'] as const;

const snapshots = new Map<string, WorkerAppSnapshot>();
let syncStatus: WorkerMonitorState['status'] = isCloudflareConfigured() ? 'PENDING' : 'NOT_CONNECTED';
let syncDetail = isCloudflareConfigured() ? 'Worker configuration has not been read yet.' : 'CLOUDFLARE_API_TOKEN is not set. Worker script reads are not connected.';
let lastSyncAt: string | null = null;
let lastSuccessAt: string | null = null;

export function authorizeWorkerEvent(authorization: string | undefined): { ok: true } | { ok: false; status: number; message: string } {
  if (!config.workerEventsToken) {
    return { ok: false, status: 503, message: 'Worker event ingest is not connected. Set WORKER_EVENTS_TOKEN on the Scholario Ops server. Nothing was stored.' };
  }
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token || !safeEqual(token, config.workerEventsToken)) return { ok: false, status: 401, message: 'Invalid worker event token' };
  return { ok: true };
}

export function eventsFor(applicationId: string): WorkerRoutingEvent[] {
  return db.workerEvents.filter(e => e.applicationId === applicationId).sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, 50);
}

function postedCount(value: number | null | undefined, label: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000_000) throw new Error(`${label} must be a whole number from 0`);
  return value;
}

export function recordWorkerEvent(input: {
  applicationId: string;
  kind: string;
  origin?: string | null;
  prdHealth?: string | null;
  drHealth?: string | null;
  detail?: string;
  observedAt?: string;
  requests?: number | null;
  errors?: number | null;
}): WorkerRoutingEvent {
  if (!EVENT_KINDS.includes(input.kind as WorkerEventKind)) throw new Error(`kind must be one of: ${EVENT_KINDS.join(', ')}`);
  const health = (v: string | null | undefined) => {
    if (v === undefined || v === null || v === '') return null;
    if (!HEALTHS.includes(v as typeof HEALTHS[number])) throw new Error('origin health must be healthy, unhealthy, or unknown');
    return v as WorkerRoutingEvent['prdHealth'];
  };
  const now = new Date().toISOString();
  const event: WorkerRoutingEvent = {
    id: crypto.randomUUID(),
    applicationId: input.applicationId,
    kind: input.kind as WorkerEventKind,
    origin: input.origin?.trim() ? input.origin.trim().slice(0, 253) : null,
    prdHealth: health(input.prdHealth),
    drHealth: health(input.drHealth),
    detail: (input.detail ?? '').slice(0, 500),
    observedAt: input.observedAt && !Number.isNaN(Date.parse(input.observedAt)) ? new Date(input.observedAt).toISOString() : now,
    receivedAt: now,
    source: 'worker_event',
    requests: postedCount(input.requests, 'requests'),
    errors: postedCount(input.errors, 'errors'),
  };
  db.workerEvents.unshift(event);
  const mine = db.workerEvents.filter(e => e.applicationId === event.applicationId);
  if (mine.length > 100) {
    const keep = new Set(mine.slice(0, 100).map(e => e.id));
    db.workerEvents = db.workerEvents.filter(e => e.applicationId !== event.applicationId || keep.has(e.id));
  }
  if (db.workerEvents.length > 1000) db.workerEvents.length = 1000;
  persist();
  broadcast('worker_update', workerMonitorState());
  return event;
}

function countsFor(applicationId: string): { requests: number | null; errors: number | null; analytics: WorkerAppSnapshot['analytics'] } {
  const hit = db.workerEvents.find(e => e.applicationId === applicationId && (e.requests !== null || e.errors !== null));
  if (!hit) return { requests: null, errors: null, analytics: 'NOT_CONNECTED' };
  return { requests: hit.requests, errors: hit.errors, analytics: 'EVENTS' };
}

function withCounts(applicationId: string, snap: Omit<WorkerAppSnapshot, 'requests' | 'errors' | 'analytics'>): WorkerAppSnapshot {
  return { ...snap, ...countsFor(applicationId) };
}

function snapshotFor(applicationId: string, name: string, accountId: string): WorkerAppSnapshot {
  const saved = snapshots.get(applicationId);
  if (saved) return saved;
  if (!isCloudflareConfigured() || !accountId) {
    return withCounts(applicationId, { applicationId, connection: 'not_connected', detail: 'Cloudflare API is not connected for this Worker, or the account ID is empty.', observedAt: null, scriptFound: null, lastDeployedAt: null });
  }
  if (!name) {
    return withCounts(applicationId, { applicationId, connection: 'configured', detail: 'Worker name is empty.', observedAt: null, scriptFound: null, lastDeployedAt: null });
  }
  return withCounts(applicationId, { applicationId, connection: 'unknown', detail: 'Worker configuration has not been verified yet.', observedAt: null, scriptFound: null, lastDeployedAt: null });
}

export function workerMonitorState(): WorkerMonitorState {
  const apps: WorkerAppSnapshot[] = [];
  for (const app of db.applications) {
    const method = effectiveRoutingMethod(app);
    if (method !== 'cloudflare_worker' && method !== 'cloudflare_worker_failover') continue;
    const cfg = normalizeRouting(app);
    apps.push(snapshotFor(app.id, cfg.worker.name, cfg.worker.accountId));
  }
  return {
    status: syncStatus,
    detail: syncDetail,
    lastSyncAt,
    lastSuccessAt,
    eventsConnected: Boolean(config.workerEventsToken),
    permissionHint: WORKER_PERMISSION_HINT,
    apps,
    events: db.workerEvents.slice(0, 200),
  };
}

interface ScriptRow { id?: string; name?: string; modified_on?: string }

/** Match a script list entry. Does not read script source or bindings. */
export function matchWorkerScript(rows: ScriptRow[], name: string): ScriptRow | undefined {
  const want = name.toLowerCase();
  return rows.find(r => (r.id ?? '').toLowerCase() === want || (r.name ?? '').toLowerCase() === want);
}

export async function syncWorkers(): Promise<WorkerMonitorState> {
  lastSyncAt = new Date().toISOString();
  const wanted = db.applications.filter(a => {
    const method = effectiveRoutingMethod(a);
    return method === 'cloudflare_worker' || method === 'cloudflare_worker_failover';
  });
  if (!isCloudflareConfigured()) {
    syncStatus = 'NOT_CONNECTED';
    syncDetail = 'CLOUDFLARE_API_TOKEN is not set. Worker script reads are not connected. No request counts are estimated.';
    snapshots.clear();
    broadcast('worker_update', workerMonitorState());
    return workerMonitorState();
  }
  if (wanted.length === 0) {
    syncStatus = 'NOT_CONFIGURED';
    syncDetail = 'No application uses a Cloudflare Worker routing method.';
    snapshots.clear();
    broadcast('worker_update', workerMonitorState());
    return workerMonitorState();
  }
  const byAccount = new Map<string, typeof wanted>();
  for (const app of wanted) {
    const accountId = normalizeRouting(app).worker.accountId;
    if (!accountId) {
      snapshots.set(app.id, withCounts(app.id, { applicationId: app.id, connection: 'not_connected', detail: 'Worker account ID is empty, so the script list was not requested.', observedAt: lastSyncAt, scriptFound: null, lastDeployedAt: null }));
      continue;
    }
    const list = byAccount.get(accountId) ?? [];
    list.push(app);
    byAccount.set(accountId, list);
  }
  let anyOk = false;
  let anyPermission = false;
  let anyError = false;
  let errorText = '';
  for (const [accountId, apps] of byAccount) {
    try {
      const rows: ScriptRow[] = [];
      for (let page = 1; page <= 5; page++) {
        const res = await cf<ScriptRow[]>(`/accounts/${accountId}/workers/scripts?per_page=50&page=${page}`);
        if (Array.isArray(res.result)) rows.push(...res.result);
        if (!res.result_info || page >= res.result_info.total_pages) break;
      }
      anyOk = true;
      lastSuccessAt = new Date().toISOString();
      for (const app of apps) {
        const name = normalizeRouting(app).worker.name;
        const hit = name ? matchWorkerScript(rows, name) : undefined;
        snapshots.set(app.id, {
          applicationId: app.id,
          connection: !name ? 'configured' : hit ? 'verified' : 'unavailable',
          detail: !name ? 'Worker name is empty.' : hit ? `Worker ${name} is listed in account ${accountId}.` : `Worker ${name} was not in the account script list.`,
          observedAt: lastSuccessAt,
          scriptFound: name ? Boolean(hit) : null,
          lastDeployedAt: hit?.modified_on ?? null,
          ...countsFor(app.id),
        });
      }
    } catch (err) {
      const permission = err instanceof CloudflareError && err.isPermission;
      if (permission) anyPermission = true; else anyError = true;
      errorText = permission ? `${WORKER_PERMISSION_HINT} (${(err as Error).message})` : (err as Error).message;
      log.warn('workers', `worker script list failed for one account: ${errorText}`);
      for (const app of apps) {
        snapshots.set(app.id, {
          applicationId: app.id,
          connection: 'unknown',
          detail: errorText,
          observedAt: lastSyncAt,
          scriptFound: null,
          lastDeployedAt: null,
          ...countsFor(app.id),
        });
      }
    }
  }
  syncStatus = anyPermission && !anyOk ? 'PERMISSION_REQUIRED' : anyError && !anyOk ? 'ERROR' : 'OK';
  syncDetail = syncStatus === 'OK'
    ? 'Worker names were compared with the account script list. Analytics were not requested.'
    : errorText || syncDetail;
  broadcast('worker_update', workerMonitorState());
  return workerMonitorState();
}

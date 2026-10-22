/**
 * Hostinger VPS API provider — server-side, read-only.
 *
 *   GET https://developers.hostinger.com/api/vps/v1/virtual-machines   VMs (plan, CPU, RAM, disk, IPs, state, template)
 *   GET https://developers.hostinger.com/api/vps/v1/data-centers       data centers (for the VM region)
 *   GET /virtual-machines/{id}/backups and /snapshot                    recovery points (read-only)
 *
 * The token is passed in by the caller (one account at a time) and is never logged or returned.
 * Every request has a timeout; 429 and 5xx are retried once; 401/403 are reported as AUTH_FAILED.
 * Error bodies are discarded. A failure never invents values: unknown fields stay null.
 */
import { BackupRecord, HostingerInfo, ProviderStatus } from '../src/types/index.ts';
import { ProviderRecoveryPoint, recoveryPointFromSnapshot, recoveryPointsFromBackupList } from '../src/lib/hostingerBackups.ts';
import { config, isHostingerConfigured } from './config.ts';
import { db, ServerRecord } from './store.ts';
import { syncServerPlan } from './resources.ts';

const API = 'https://developers.hostinger.com/api/vps/v1';

/** Shape of a VM from the Hostinger VPS API (fields are read defensively). */
export interface HostingerVm {
  id: number;
  hostname?: string | null;
  state?: string | null;
  cpus?: number | null;
  memory?: number | null; // MB
  disk?: number | null;   // MB
  plan?: string | null;
  ipv4?: Array<{ address?: string }> | null;
  ipv6?: Array<{ address?: string }> | null;
  template?: { name?: string } | null;
  data_center_id?: number | null;
}
interface DataCenter { id: number; name?: string; location?: string; city?: string; continent?: string }

export type HostingerSyncStatus = 'NOT_CONFIGURED' | 'OK' | 'AUTH_FAILED' | 'RATE_LIMITED' | 'ERROR' | 'PENDING';

export const hostingerState = {
  vms: [] as HostingerInfo[],
  status: (isHostingerConfigured() ? 'PENDING' : 'NOT_CONFIGURED') as HostingerSyncStatus,
  lastSyncAt: null as string | null,
  lastSuccessAt: null as string | null,
  lastError: null as string | null,
};

/** Last read-only backup/snapshot check per VM. Not a backup record. */
const backupChecks = new Map<number, { checkedAt: string; count: number; error: string | null }>();

export function noteProviderBackupCheck(vmId: number, count: number, error: string | null, checkedAt: string) {
  backupChecks.set(vmId, { checkedAt, count, error });
}

export function providerBackupCheck(vmId: number | undefined) {
  if (vmId == null) return null;
  return backupChecks.get(vmId) ?? null;
}

export class HostingerError extends Error {
  constructor(message: string, public kind: Exclude<HostingerSyncStatus, 'OK' | 'PENDING' | 'NOT_CONFIGURED'>, public httpStatus: number | null = null) { super(message); }
}

/** Maps the Hostinger VM state to a monitoring status. Unknown states stay UNKNOWN. */
export function vmStatus(state: string | null | undefined): ProviderStatus {
  if (!state) return 'UNKNOWN';
  const s = state.toLowerCase();
  if (s === 'running') return 'HEALTHY';
  if (['starting', 'stopping', 'restarting', 'recreating', 'restoring', 'creating', 'initial', 'recovery', 'stopping_recovery', 'unsuspending', 'suspending'].includes(s)) return 'DEGRADED';
  if (['stopped', 'error', 'suspended', 'destroyed', 'destroying'].includes(s)) return 'UNAVAILABLE';
  return 'UNKNOWN';
}

export function normalizeVm(vm: HostingerVm, dataCenters: DataCenter[], fetchedAt: string): HostingerInfo {
  const dc = vm.data_center_id != null ? dataCenters.find(d => d.id === vm.data_center_id) : undefined;
  const region = dc ? [dc.city || dc.name, dc.location].filter(Boolean).join(', ') || null : null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    vmId: vm.id,
    hostname: vm.hostname ?? null,
    plan: vm.plan ?? null,
    cpus: num(vm.cpus),
    ramGb: num(vm.memory) !== null ? Math.round((vm.memory as number) / 1024) : null,
    diskGb: num(vm.disk) !== null ? Math.round((vm.disk as number) / 1024) : null,
    os: vm.template?.name ?? null,
    state: vm.state ?? null,
    status: vmStatus(vm.state),
    region,
    ipv4: (vm.ipv4 ?? []).map(a => a.address).filter((a): a is string => Boolean(a)),
    fetchedAt,
  };
}

async function hget<T>(path: string, token: string, envName: string, attempt = 1): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.hostingerTimeoutMs);
  let resp: Response;
  try {
    resp = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    const msg = (err as Error).name === 'AbortError' ? `timeout after ${config.hostingerTimeoutMs / 1000}s` : (err as Error).message;
    if (attempt < 2) return hget<T>(path, token, envName, attempt + 1);
    throw new HostingerError(`Hostinger API unreachable: ${msg}`, 'ERROR');
  }
  clearTimeout(timer);
  if (resp.ok) return (await resp.json()) as T;
  await resp.text().catch(() => ''); // discard the body — it is never logged or returned
  if (resp.status === 401 || resp.status === 403) throw new HostingerError(`Hostinger API rejected the token (HTTP ${resp.status}) — check ${envName} and its permissions`, 'AUTH_FAILED', resp.status);
  if (resp.status === 429) {
    const wait = Math.min(30, Number(resp.headers.get('retry-after')) || 5);
    if (attempt < 2) { await new Promise(r => setTimeout(r, wait * 1000)); return hget<T>(path, token, envName, attempt + 1); }
    throw new HostingerError('Hostinger API rate limit reached (HTTP 429)', 'RATE_LIMITED', 429);
  }
  if (resp.status >= 500 && attempt < 2) { await new Promise(r => setTimeout(r, 2000)); return hget<T>(path, token, envName, attempt + 1); }
  throw new HostingerError(`Hostinger API ${path} failed: HTTP ${resp.status}`, 'ERROR', resp.status);
}

const listOf = <T>(body: unknown): T[] => (Array.isArray(body) ? body : ((body as { data?: T[] })?.data ?? [])) as T[];

/** Like hget, but HTTP 404 is an empty result (this VPS has no snapshot, or backups are not enabled). */
async function hgetMissingOk(path: string, token: string, envName: string): Promise<unknown | null> {
  try {
    return await hget<unknown>(path, token, envName);
  } catch (err) {
    if (err instanceof HostingerError && err.httpStatus === 404) return null;
    throw err;
  }
}

/**
 * Recovery points for one VM. A failure here is returned and does not discard the VM list.
 * Page 1 is enough when the rows are not backups; otherwise up to 3 pages are read.
 */
export async function pullRecoveryPoints(token: string, envName: string, vmId: number, hostname: string): Promise<{ points: ProviderRecoveryPoint[]; complete: boolean; error: string | null }> {
  try {
    const points: ProviderRecoveryPoint[] = [];
    let complete = true;
    for (let page = 1; page <= 3; page++) {
      const body = await hgetMissingOk(`/virtual-machines/${vmId}/backups?page=${page}`, token, envName);
      if (body == null) break;
      const parsed = recoveryPointsFromBackupList(vmId, hostname, body);
      if (parsed.length === 0) break;
      points.push(...parsed);
      const total = (body as { meta?: { total?: number } }).meta?.total;
      if (typeof total === 'number' && points.length >= total) break;
      if (typeof total !== 'number') { complete = false; break; }
      if (page === 3) complete = points.length >= total;
    }
    const snapshotBody = await hgetMissingOk(`/virtual-machines/${vmId}/snapshot`, token, envName);
    const snapshot = snapshotBody == null ? null : recoveryPointFromSnapshot(vmId, hostname, snapshotBody);
    if (snapshot) points.push(snapshot);
    return { points, complete, error: null };
  } catch (err) {
    const message = err instanceof HostingerError ? err.message : (err as Error).message;
    return { points: [], complete: false, error: message };
  }
}

function applicationIdFor(srv: ServerRecord): string {
  if (srv.applicationId) return srv.applicationId;
  return db.applications.find(a => a.prdServerId === srv.id || a.drServerId === srv.id)?.id ?? '';
}

/** Inserts or updates Hostinger recovery points. Script-reported rows use other ids and are left alone. */
export function storeRecoveryPoints(srv: ServerRecord, vmId: number, points: ProviderRecoveryPoint[], complete: boolean): boolean {
  const applicationId = applicationIdFor(srv);
  let changed = false;
  if (complete) {
    const keep = new Set(points.map(p => p.key));
    const backupPrefix = `hostinger-backup:${vmId}:`;
    const snapshotPrefix = `hostinger-snapshot:${vmId}:`;
    const before = db.backups.length;
    db.backups = db.backups.filter(b => {
      if (b.serverId !== srv.id) return true;
      if (!b.id.startsWith(backupPrefix) && !b.id.startsWith(snapshotPrefix)) return true;
      return keep.has(b.id);
    });
    if (db.backups.length !== before) changed = true;
  }
  for (const point of points) {
    const existing = db.backups.find(b => b.id === point.key);
    if (existing) {
      const before = `${existing.sizeGb}|${existing.destination}|${existing.completedAt}|${existing.serverId}|${existing.applicationId}|${existing.retentionDays}|${existing.status}`;
      existing.sizeGb = point.sizeGb;
      existing.destination = point.destination;
      existing.completedAt = point.completedAt;
      existing.serverId = srv.id;
      existing.applicationId = applicationId;
      existing.retentionDays = point.retentionDays;
      existing.status = 'SUCCESS';
      const after = `${existing.sizeGb}|${existing.destination}|${existing.completedAt}|${existing.serverId}|${existing.applicationId}|${existing.retentionDays}|${existing.status}`;
      if (before !== after) changed = true;
      continue;
    }
    const rec: BackupRecord = {
      id: point.key,
      applicationId,
      serverId: srv.id,
      type: 'DAILY_SNAPSHOT',
      sizeGb: point.sizeGb,
      destination: point.destination,
      retentionDays: point.retentionDays,
      encrypted: false,
      integrityVerified: false,
      integrityHash: '',
      restoreTestedAt: '',
      restoreDurationMin: 0,
      restoreStatus: 'PENDING',
      status: 'SUCCESS',
      completedAt: point.completedAt,
    };
    db.backups.unshift(rec);
    changed = true;
  }
  if (db.backups.length > 2000) db.backups.length = 2000;
  return changed;
}

export function vmAddresses(vm: HostingerVm, kind: 'ipv4' | 'ipv6'): string[] {
  return (vm[kind] ?? []).map(a => a.address).filter((a): a is string => Boolean(a));
}

/** Read-only list + data centers. The token is sent and then dropped; the response body of an error is not kept. */
export async function pullHostinger(token: string, envName: string): Promise<{ vms: HostingerVm[]; infos: HostingerInfo[]; fetchedAt: string }> {
  const fetchedAt = new Date().toISOString();
  const vms = listOf<HostingerVm>(await hget('/virtual-machines', token, envName));
  // Region is optional: a data-center lookup failure must not fail the sync
  const dataCenters = await hget<unknown>('/data-centers', token, envName).then(b => listOf<DataCenter>(b)).catch(() => [] as DataCenter[]);
  return { vms, infos: vms.map(vm => normalizeVm(vm, dataCenters, fetchedAt)), fetchedAt };
}

export function noteHostingerSuccess(infos: HostingerInfo[], now: string) {
  hostingerState.vms = infos;
  hostingerState.status = 'OK';
  hostingerState.lastSuccessAt = now;
  hostingerState.lastError = null;
  hostingerState.lastSyncAt = now;
}

export function noteHostingerFailure(message: string, kind: HostingerSyncStatus, now: string) {
  hostingerState.lastSyncAt = now;
  hostingerState.status = kind;
  hostingerState.lastError = message;
}

/**
 * IP enrichment for the built-in HOSTINGER_API_TOKEN connection only.
 * Other connections must not call this: a shared IP must not overwrite this server.
 */
export function attachLegacyServers(vms: HostingerVm[], infos: HostingerInfo[]): boolean {
  let changed = false;
  for (const srv of db.servers) {
    const raw = vms.find(v => (v.ipv4 ?? []).some(a => a.address === srv.ip) || (v.ipv6 ?? []).some(a => a.address === srv.ip));
    const info = raw ? infos.find(i => i.vmId === raw.id) : undefined;
    if (!info) {
      if (srv.hostinger) { delete srv.hostinger; changed = true; }
      continue;
    }
    srv.hostinger = info;
    srv.hostingerVmId = info.vmId;
    srv.hostingerState = info.state ?? undefined;
    srv.provider = 'Hostinger';
    if (info.plan) srv.plan = info.plan;
    if (info.cpus && info.ramGb && info.diskGb) {
      srv.planSpec = { name: info.plan || srv.planSpec?.name || '', cpuCores: info.cpus, ramGb: info.ramGb, diskGb: info.diskGb, source: 'hostinger' };
      syncServerPlan(srv);
    }
    if (!srv.os && info.os) srv.os = info.os;
    if (info.region && (!srv.region || srv.region === 'Unknown' || srv.region === 'Not available')) srv.region = info.region;
    changed = true;
  }
  return changed;
}

/** Built-in account. Same entry point as before; extra accounts sync through their own connection id. */
export async function syncHostinger(): Promise<void> {
  const { syncLegacyHostinger } = await import('./providers/sync.ts');
  return syncLegacyHostinger();
}

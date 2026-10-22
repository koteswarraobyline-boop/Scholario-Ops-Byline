/**
 * Per-connection Hostinger sync. One account's failure does not change another account's rows
 * or the registered servers those other accounts did not enrich.
 */
import { db, persist } from '../store.ts';
import { broadcast } from '../events.ts';
import { log } from '../logger.ts';
import {
  HostingerError, HostingerVm, attachLegacyServers, hostingerState, noteHostingerFailure, noteHostingerSuccess, noteProviderBackupCheck, pullHostinger, pullRecoveryPoints, storeRecoveryPoints, vmAddresses,
} from '../hostinger.ts';
import { redactSecrets, tokenFromEnv } from './env.ts';
import { ensureLegacyHostingerConnection } from './connections.ts';

export class ProviderSyncError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); }
}

const inflight = new Map<string, Promise<void>>();

function legacyConnection() {
  return db.providerConnections.find(c => c.legacy && c.provider === 'hostinger' && c.tokenEnv === 'HOSTINGER_API_TOKEN');
}

function upsertInstances(connectionId: string, vms: HostingerVm[], infos: Awaited<ReturnType<typeof pullHostinger>>['infos'], fetchedAt: string) {
  const seen = new Set<string>();
  for (const info of infos) {
    const providerVmId = String(info.vmId);
    seen.add(providerVmId);
    const raw = vms.find(v => String(v.id) === providerVmId);
    let row = db.providerInstances.find(i => i.connectionId === connectionId && i.providerVmId === providerVmId);
    if (!row) {
      row = {
        id: crypto.randomUUID(),
        connectionId,
        providerVmId,
        hostname: null,
        ipv4: [],
        ipv6: [],
        os: null,
        region: null,
        plan: null,
        cpu: null,
        ramGb: null,
        diskGb: null,
        powerState: null,
        status: 'UNKNOWN',
        fetchedAt: null,
        lastSeenAt: null,
        absent: false,
      };
      db.providerInstances.push(row);
    }
    row.hostname = info.hostname;
    row.ipv4 = raw ? vmAddresses(raw, 'ipv4') : info.ipv4;
    row.ipv6 = raw ? vmAddresses(raw, 'ipv6') : [];
    row.os = info.os;
    row.region = info.region;
    row.plan = info.plan;
    row.cpu = info.cpus;
    row.ramGb = info.ramGb;
    row.diskGb = info.diskGb;
    row.powerState = info.state;
    row.status = info.status;
    row.fetchedAt = fetchedAt;
    row.lastSeenAt = fetchedAt;
    row.absent = false;
  }
  for (const row of db.providerInstances) {
    if (row.connectionId === connectionId && !seen.has(row.providerVmId)) row.absent = true;
  }
}

async function runSync(id: string, manual: boolean): Promise<void> {
  const conn = db.providerConnections.find(c => c.id === id);
  if (!conn) throw new ProviderSyncError('Connection not found', 404);
  const token = tokenFromEnv(conn.tokenEnv);
  const now = new Date().toISOString();
  if (!token) {
    conn.status = 'NOT_CONFIGURED';
    conn.lastError = `${conn.tokenEnv} is not set. Add it to .env and restart the server.`;
    conn.updatedAt = now;
    if (conn.legacy) noteHostingerFailure(conn.lastError, 'NOT_CONFIGURED', now);
    persist();
    if (manual) throw new ProviderSyncError(conn.lastError, 400);
    return;
  }
  conn.lastSyncAt = now;
  conn.updatedAt = now;
  if (conn.legacy) hostingerState.lastSyncAt = now;
  try {
    const pulled = await pullHostinger(token, conn.tokenEnv);
    upsertInstances(conn.id, pulled.vms, pulled.infos, pulled.fetchedAt);
    conn.status = 'OK';
    conn.lastSuccessAt = pulled.fetchedAt;
    conn.lastError = null;
    conn.updatedAt = pulled.fetchedAt;
    let serversChanged = false;
    if (conn.legacy) {
      noteHostingerSuccess(pulled.infos, pulled.fetchedAt);
      serversChanged = attachLegacyServers(pulled.vms, pulled.infos);
    }
    let backupsChanged = false;
    for (const srv of db.servers) {
      const vm = pulled.vms.find(v => vmAddresses(v, 'ipv4').includes(srv.ip) || vmAddresses(v, 'ipv6').includes(srv.ip));
      if (!vm) continue;
      const hostname = vm.hostname || srv.hostname;
      const recovered = await pullRecoveryPoints(token, conn.tokenEnv, vm.id, hostname);
      noteProviderBackupCheck(vm.id, recovered.points.length, recovered.error, pulled.fetchedAt);
      if (recovered.error) {
        log.warn('hostinger', `backup list for vm ${vm.id} was not read: ${redactSecrets(recovered.error)}`);
        continue;
      }
      if (storeRecoveryPoints(srv, vm.id, recovered.points, recovered.complete)) backupsChanged = true;
    }
    persist();
    if (serversChanged) broadcast('servers_changed', null);
    if (backupsChanged) broadcast('backups_changed', null);
  } catch (err) {
    const kind = err instanceof HostingerError ? err.kind : 'ERROR';
    const message = redactSecrets(err instanceof HostingerError ? err.message : (err as Error).message);
    conn.status = kind;
    conn.lastError = message;
    conn.updatedAt = new Date().toISOString();
    if (conn.legacy) noteHostingerFailure(message, kind, conn.lastSyncAt ?? now);
    log.error('hostinger', `sync failed for ${conn.name}: ${message}`);
    persist();
    if (err instanceof HostingerError) {
      err.message = message;
      throw err;
    }
    throw new HostingerError(message, 'ERROR');
  }
}

/** Joins a sync already running for this connection instead of starting a second one. */
export function syncConnection(id: string, opts?: { manual?: boolean }): Promise<void> {
  const existing = inflight.get(id);
  if (existing) return existing;
  const manual = opts?.manual === true;
  const job = runSync(id, manual).finally(() => { if (inflight.get(id) === job) inflight.delete(id); });
  inflight.set(id, job);
  return job;
}

export async function syncLegacyHostinger(): Promise<void> {
  ensureLegacyHostingerConnection();
  const conn = legacyConnection();
  if (!conn) {
    hostingerState.status = 'NOT_CONFIGURED';
    return;
  }
  return syncConnection(conn.id, { manual: true });
}

/** Automatic pass. A disabled connection is skipped. One failure does not stop the rest. */
export async function syncEnabledConnections(): Promise<void> {
  ensureLegacyHostingerConnection();
  const due = db.providerConnections.filter(c => c.syncEnabled && tokenFromEnv(c.tokenEnv));
  for (const c of due) {
    try { await syncConnection(c.id); }
    catch { /* status is already stored on that connection */ }
  }
}

/** Read-only auth check. Does not replace inventory and does not change registered servers. */
export async function testProviderConnection(id: string): Promise<{ vmCount: number }> {
  const pending = inflight.get(id);
  if (pending) await pending.catch(() => {});
  const conn = db.providerConnections.find(c => c.id === id);
  if (!conn) throw new ProviderSyncError('Connection not found', 404);
  const token = tokenFromEnv(conn.tokenEnv);
  if (!token) throw new ProviderSyncError(`${conn.tokenEnv} is not set. Add it to .env and restart the server.`, 400);
  const now = new Date().toISOString();
  try {
    const pulled = await pullHostinger(token, conn.tokenEnv);
    conn.status = 'OK';
    conn.lastError = null;
    conn.updatedAt = now;
    persist();
    return { vmCount: pulled.infos.length };
  } catch (err) {
    const kind = err instanceof HostingerError ? err.kind : 'ERROR';
    const message = redactSecrets(err instanceof HostingerError ? err.message : (err as Error).message);
    conn.status = kind;
    conn.lastError = message;
    conn.lastSyncAt = now;
    conn.updatedAt = now;
    if (conn.legacy) noteHostingerFailure(message, kind, now);
    log.error('hostinger', `connection test failed for ${conn.name}: ${message}`);
    persist();
    if (err instanceof HostingerError) { err.message = message; throw err; }
    throw new HostingerError(message, 'ERROR');
  }
}

export function instancesForApi(): import('../../src/types/index.ts').ProviderInstanceView[] {
  return db.providerInstances.map(row => {
    const conn = db.providerConnections.find(c => c.id === row.connectionId);
    return { ...row, provider: conn?.provider ?? 'hostinger', connectionName: conn?.name ?? '' };
  });
}


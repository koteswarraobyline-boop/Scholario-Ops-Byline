/**
 * Register a Hostinger (provider) VM as an Ops server row.
 * Data comes from the synced provider inventory in PostgreSQL — nothing is hardcoded.
 */
import crypto from 'crypto';
import net from 'net';
import type { Environment, ProviderInstanceRecord } from '../../src/types/index.ts';
import { ValidationError, isHostname } from '../validate.ts';
import { db, persist, ServerRecord } from '../store.ts';
import { syncServerPlan } from '../resources.ts';
import { publicServer } from '../engine.ts';
import { isHostingerConfigured } from '../config.ts';
import { syncHostinger } from '../hostinger.ts';

const newToken = () => crypto.randomBytes(24).toString('hex');

function pickIp(inst: ProviderInstanceRecord): string {
  const ip = [...inst.ipv4, ...inst.ipv6].find(a => net.isIP(a));
  if (!ip) throw new ValidationError('This VPS has no public IP to register');
  return ip;
}

function pickHostname(inst: ProviderInstanceRecord, ip: string): string {
  const raw = (inst.hostname || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (raw && isHostname(raw) && !db.servers.some(s => s.hostname === raw)) return raw;
  // Prefer a stable label from the provider VM id when hostname is missing or already taken
  const fromVm = `hostinger-${inst.providerVmId}`.toLowerCase();
  if (isHostname(fromVm) && !db.servers.some(s => s.hostname === fromVm)) return fromVm;
  if (isHostname(ip) && !db.servers.some(s => s.hostname === ip)) return ip;
  throw new ValidationError('Could not derive a unique hostname for this VPS — edit hostname in Setup after registering');
}

/** Infer PRD/DR from Hostinger hostname labels (e.g. Cipher.LMS.DR, Vantage.DR). */
export function environmentFromHostname(hostname: string | null | undefined): Environment {
  const h = (hostname || '').toLowerCase();
  if (/(^|[.-])dr($|[.-])/.test(h) || h.endsWith('-dr') || h.endsWith('.dr')) return 'DR';
  return 'PRD';
}

function findExistingForInstance(inst: ProviderInstanceRecord): ServerRecord | undefined {
  const ips = new Set([...inst.ipv4, ...inst.ipv6]);
  return db.servers.find(s => ips.has(s.ip) || (inst.providerVmId && s.hostingerVmId === Number(inst.providerVmId)));
}

export type RegisterResult =
  | { status: 'created'; server: ReturnType<typeof publicServer>; instanceId: string }
  | { status: 'exists'; server: ReturnType<typeof publicServer>; instanceId: string }
  | { status: 'skipped'; instanceId: string; reason: string };

/** Build a server row from one provider instance. Does not persist. */
export function serverFromProviderInstance(
  inst: ProviderInstanceRecord,
  opts: { environment?: Environment; notes?: string } = {},
): ServerRecord {
  if (inst.absent) throw new ValidationError('Cannot register an absent VPS — sync Hostinger first');
  const existing = findExistingForInstance(inst);
  if (existing) throw new ValidationError(`Already registered as ${existing.hostname} (${existing.ip})`);
  const ip = pickIp(inst);
  if (db.servers.some(s => s.ip === ip)) throw new ValidationError(`IP ${ip} is already registered`);
  const hostname = pickHostname(inst, ip);
  const planName = (inst.plan || '').trim();
  const planSpec =
    inst.cpu && inst.ramGb && inst.diskGb
      ? { name: planName, cpuCores: inst.cpu, ramGb: inst.ramGb, diskGb: inst.diskGb, source: 'hostinger' as const }
      : undefined;
  const now = new Date().toISOString();
  const vmId = Number(inst.providerVmId);
  return {
    id: crypto.randomUUID(),
    hostname,
    ip,
    applicationId: '',
    environment: opts.environment ?? environmentFromHostname(inst.hostname),
    provider: 'Hostinger',
    region: inst.region || '',
    plan: planName,
    planSpec,
    cpuCores: 0,
    ramGb: 0,
    diskGb: 0,
    os: inst.os || '',
    status: 'UNKNOWN',
    agentVersion: '',
    agentStatus: 'DISCONNECTED',
    uptimeDays: 0,
    lastSeen: '',
    notes: opts.notes ?? `Registered from Hostinger VM ${inst.providerVmId}`,
    telemetry: { cpuPercent: 0, ramPercent: 0, diskPercent: 0, loadAvg: [0, 0, 0], networkInKbps: 0, networkOutKbps: 0, observedAt: '', receivedAt: '' },
    processes: [],
    services: [],
    logs: [],
    agentToken: newToken(),
    createdAt: now,
    hostingerVmId: Number.isFinite(vmId) ? vmId : undefined,
    hostingerState: inst.powerState ?? undefined,
  };
}

export function registerProviderInstance(
  instanceId: string,
  opts: { environment?: Environment; notes?: string } = {},
): RegisterResult {
  const inst = db.providerInstances.find(i => i.id === instanceId);
  if (!inst) throw new ValidationError('Provider instance not found — sync Hostinger first');
  const existing = findExistingForInstance(inst);
  if (existing) return { status: 'exists', server: publicServer(existing), instanceId };
  if (inst.absent) return { status: 'skipped', instanceId, reason: 'VPS is absent from the latest sync' };
  try {
    pickIp(inst);
  } catch (e) {
    return { status: 'skipped', instanceId, reason: (e as Error).message };
  }
  const srv = serverFromProviderInstance(inst, opts);
  db.servers.push(srv);
  syncServerPlan(srv);
  persist();
  if (isHostingerConfigured()) void syncHostinger().catch(() => {});
  return { status: 'created', server: publicServer(srv), instanceId };
}

/** Register every current (non-absent) provider VM that is not already an Ops server. */
export function registerAllProviderInstances(
  opts: { environment?: Environment } = {},
): { created: RegisterResult[]; existed: RegisterResult[]; skipped: RegisterResult[] } {
  const created: RegisterResult[] = [];
  const existed: RegisterResult[] = [];
  const skipped: RegisterResult[] = [];
  for (const inst of db.providerInstances) {
    if (inst.absent) {
      skipped.push({ status: 'skipped', instanceId: inst.id, reason: 'absent from latest sync' });
      continue;
    }
    const result = registerProviderInstance(inst.id, opts);
    if (result.status === 'created') created.push(result);
    else if (result.status === 'exists') existed.push(result);
    else skipped.push(result);
  }
  return { created, existed, skipped };
}

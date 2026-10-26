/**
 * Resource limit records.
 * Server plans create CPU, memory and disk rows. The agent fills usage only when it reports
 * an absolute value (or a CPU percent together with an observed core count). Registry user
 * counts are not seat limits. Hostinger supplies plan capacity, not live usage.
 */
import crypto from 'crypto';
import type { ResourceKind, ResourceLimit, ResourceSource, ResourceUnit, QuotaWindow, ThresholdMode } from '../src/types/index.ts';
import {
  convertUnit, evaluateCapacity, infraMonitorType, monitorBand, RESOURCE_KINDS, roundMeasure, thresholdProblem, unitAllowed, unitsFor, type CapacityResult,
} from '../src/lib/resources.ts';
import { config } from './config.ts';
import { assertSafeTarget, policyFromEnv, UnsafeTargetError } from './netguard.ts';
import { db, ServerRecord } from './store.ts';
import { ValidationError, body, optBool, optStr, reqStr } from './validate.ts';

export class MeasurementConflict extends Error {}

const KEY_RE = /^[a-z0-9][a-z0-9:._-]{0,159}$/;
const nowIso = () => new Date().toISOString();

type Obj = Record<string, unknown>;

function numOrNull(o: Obj, key: string, label: string, min: number, max: number): number | null | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${label} must be a number from ${min} to ${max}`);
  return n;
}

function requirePositive(n: number | null | undefined, label: string): number | null | undefined {
  if (n === undefined || n === null) return n;
  if (n <= 0) throw new ValidationError(`${label} must be greater than zero. Leave it empty when it is unknown. Unlimited is a separate switch.`);
  return n;
}

export function monitorOverride(kind: ResourceKind, serverId: string | null): { warning: number | null; critical: number | null } {
  const type = infraMonitorType(kind);
  if (!type || !serverId) return { warning: null, critical: null };
  const monitors = db.monitors
    .filter(m => m.enabled && m.type === type && m.serverId === serverId)
    .sort((a, b) => a.id.localeCompare(b.id));
  return monitorBand(kind, monitors[0] ?? null);
}

export function assessment(r: ResourceLimit, now = Date.now()): CapacityResult {
  const band = monitorOverride(r.kind, r.serverId);
  return evaluateCapacity({
    kind: r.kind,
    usage: r.usage,
    capacity: r.capacity,
    unlimited: r.unlimited,
    thresholdMode: r.thresholdMode,
    warningValue: r.warningValue,
    criticalValue: r.criticalValue,
    hardLimit: r.hardLimit,
    recoveryMargin: r.recoveryMargin,
    previous: r.alertState,
    measuredAt: r.measuredAt,
    syncError: r.syncError,
    now,
    staleMs: config.resourceStaleSec * 1000,
    monitorWarning: band.warning,
    monitorCritical: band.critical,
  });
}

export function presentResource(r: ResourceLimit, now = Date.now()) {
  return { ...r, evaluation: assessment(r, now) };
}

function checkRecord(r: Pick<ResourceLimit, 'kind' | 'unit' | 'unlimited' | 'thresholdMode' | 'warningValue' | 'criticalValue' | 'recoveryMargin' | 'quotaWindow' | 'capacity' | 'hardLimit'>): void {
  if (!unitAllowed(r.kind, r.unit)) throw new ValidationError(`${r.kind} is measured in ${unitsFor(r.kind).join(', ')}`);
  if (r.kind === 'API_QUOTA' && !r.quotaWindow) throw new ValidationError('An API quota needs a window: minute, hour or day');
  if (r.kind !== 'API_QUOTA' && r.quotaWindow) throw new ValidationError('Only an API quota has a request window');
  const problem = thresholdProblem({
    mode: r.thresholdMode, warning: r.warningValue, critical: r.criticalValue, margin: r.recoveryMargin, unlimited: r.unlimited,
  });
  if (problem) throw new ValidationError(problem);
  if (r.hardLimit !== null && r.capacity !== null && r.hardLimit < r.capacity) {
    throw new ValidationError('The hard limit cannot be below the capacity');
  }
}

function blank(partial: {
  id?: string; resourceKey: string; kind: ResourceKind; name: string; owner: string; unit: ResourceUnit; source: ResourceSource;
  description?: string; serverId?: string | null; applicationId?: string | null; capacity?: number | null; unlimited?: boolean;
  thresholdMode?: ThresholdMode; warningValue?: number | null; criticalValue?: number | null; hardLimit?: number | null;
  recoveryMargin?: number; quotaWindow?: QuotaWindow | null; managedBy?: ResourceLimit['managedBy'];
}): ResourceLimit {
  const now = nowIso();
  const row: ResourceLimit = {
    id: partial.id ?? crypto.randomUUID(),
    resourceKey: partial.resourceKey,
    kind: partial.kind,
    name: partial.name,
    description: partial.description ?? '',
    owner: partial.owner,
    serverId: partial.serverId ?? null,
    applicationId: partial.applicationId ?? null,
    capacity: partial.capacity ?? null,
    unlimited: partial.unlimited ?? false,
    usage: null,
    unit: partial.unit,
    source: partial.source,
    thresholdMode: partial.thresholdMode ?? 'percent',
    warningValue: partial.warningValue ?? null,
    criticalValue: partial.criticalValue ?? null,
    hardLimit: partial.hardLimit ?? null,
    recoveryMargin: partial.recoveryMargin ?? 2,
    quotaWindow: partial.quotaWindow ?? null,
    measuredAt: null,
    lastSyncAt: now,
    freshness: 'MISSING',
    syncError: '',
    enabled: true,
    alertState: 'UNKNOWN',
    alertSince: null,
    managedBy: partial.managedBy ?? null,
    lastMeasurementId: null,
    createdAt: now,
    updatedAt: now,
  };
  checkRecord(row);
  return row;
}

export function buildResource(input: unknown, existing?: ResourceLimit): ResourceLimit {
  const b = body({ body: input });
  const kind = (existing ? (optStr(b, 'kind', 'Kind', 40) ?? existing.kind) : reqStr(b, 'kind', 'Kind', 40)) as ResourceKind;
  if (!RESOURCE_KINDS.includes(kind) || !unitsFor(kind)) throw new ValidationError('Kind must be one of: ' + RESOURCE_KINDS.join(', '));
  const name = existing ? (optStr(b, 'name', 'Name', 160) ?? existing.name) : reqStr(b, 'name', 'Name', 160);
  const owner = existing ? (optStr(b, 'owner', 'Owner', 200) ?? existing.owner) : reqStr(b, 'owner', 'Owner', 200);
  const unit = (existing ? (optStr(b, 'unit', 'Unit', 32) ?? existing.unit) : reqStr(b, 'unit', 'Unit', 32)) as ResourceUnit;
  const source = (optStr(b, 'source', 'Source', 20) ?? existing?.source ?? 'manual') as ResourceSource;
  if (!['manual', 'config', 'provider', 'discovered'].includes(source)) throw new ValidationError('Source must be manual, config, provider or discovered');
  const mode = (optStr(b, 'thresholdMode', 'Threshold mode', 20) ?? existing?.thresholdMode ?? (kind === 'LOAD' && !existing ? 'absolute' : 'percent')) as ThresholdMode;
  if (mode !== 'percent' && mode !== 'absolute') throw new ValidationError('Threshold mode must be percent or absolute');
  const windowRaw = b.quotaWindow === undefined ? existing?.quotaWindow ?? null : (b.quotaWindow === null || b.quotaWindow === '' ? null : optStr(b, 'quotaWindow', 'Quota window', 10));
  if (windowRaw && windowRaw !== 'minute' && windowRaw !== 'hour' && windowRaw !== 'day') throw new ValidationError('Quota window must be minute, hour or day');
  let capacity = b.capacity === undefined ? existing?.capacity ?? null : requirePositive(numOrNull(b, 'capacity', 'Capacity', 0, 1e18) ?? null, 'Capacity');
  const unlimited = b.unlimited === undefined ? existing?.unlimited ?? false : (optBool(b, 'unlimited') ?? false);
  if (unlimited) capacity = null;
  const warningValue = b.warningValue === undefined ? existing?.warningValue ?? null : requirePositive(numOrNull(b, 'warningValue', 'Warning threshold', 0, 1e18) ?? null, 'Warning threshold');
  const criticalValue = b.criticalValue === undefined ? existing?.criticalValue ?? null : requirePositive(numOrNull(b, 'criticalValue', 'Critical threshold', 0, 1e18) ?? null, 'Critical threshold');
  const hardLimit = b.hardLimit === undefined ? existing?.hardLimit ?? null : requirePositive(numOrNull(b, 'hardLimit', 'Hard limit', 0, 1e18) ?? null, 'Hard limit');
  const recoveryMargin = b.recoveryMargin === undefined ? existing?.recoveryMargin ?? 2 : (numOrNull(b, 'recoveryMargin', 'Recovery margin', 0, 1e6) ?? 2);
  const serverId = b.serverId === undefined ? existing?.serverId ?? null : (b.serverId === null || b.serverId === '' ? null : reqStr({ serverId: b.serverId }, 'serverId', 'Server', 64));
  const applicationId = b.applicationId === undefined ? existing?.applicationId ?? null : (b.applicationId === null || b.applicationId === '' ? null : reqStr({ applicationId: b.applicationId }, 'applicationId', 'Application', 64));
  if (serverId && !db.servers.some(s => s.id === serverId)) throw new ValidationError('Server not found');
  if (applicationId && !db.applications.some(a => a.id === applicationId)) throw new ValidationError('Application not found');
  let resourceKey = existing?.resourceKey ?? (optStr(b, 'resourceKey', 'Resource key', 160) || `manual:${crypto.randomUUID()}`);
  resourceKey = resourceKey.toLowerCase();
  if (!KEY_RE.test(resourceKey)) throw new ValidationError('Resource key must start with a letter or number and use only letters, numbers, colon, dot, underscore or dash');
  if (db.resources.some(r => r.resourceKey === resourceKey && r.id !== existing?.id)) throw new ValidationError(`Resource key ${resourceKey} is already used`);
  const nextUnit = unit;
  const prev = existing;
  let usage = prev?.usage ?? null;
  let nextCapacity = capacity ?? null;
  let nextHard = hardLimit ?? null;
  let nextWarn = warningValue ?? null;
  let nextCrit = criticalValue ?? null;
  let nextMargin = recoveryMargin ?? 2;
  // Load is judged per core, not as a percent of a purchased size. Warning 1, critical 2.
  // The default recovery of 2 is wider than a warning of 1, so a new load row uses 0.2.
  if (!prev && kind === 'LOAD' && mode === 'absolute') {
    if (b.warningValue === undefined) nextWarn = 1;
    if (b.criticalValue === undefined) nextCrit = 2;
    if (b.recoveryMargin === undefined) nextMargin = 0.2;
  }
  if (mode === 'absolute' && nextWarn !== null && b.recoveryMargin === undefined && nextMargin >= nextWarn) {
    nextMargin = Math.round(nextWarn * 0.2 * 1000) / 1000;
  }
  if (prev && prev.unit !== nextUnit) {
    try {
      if (usage !== null) usage = roundMeasure(convertUnit(usage, prev.unit, nextUnit));
      if (nextCapacity !== null && prev.capacity !== null) nextCapacity = roundMeasure(convertUnit(prev.capacity, prev.unit, nextUnit));
      if (mode === 'absolute') {
        if (nextWarn !== null) nextWarn = roundMeasure(convertUnit(nextWarn, prev.unit, nextUnit));
        if (nextCrit !== null) nextCrit = roundMeasure(convertUnit(nextCrit, prev.unit, nextUnit));
      }
      if (nextHard !== null) nextHard = roundMeasure(convertUnit(nextHard, prev.unit, nextUnit));
    } catch (err) {
      throw new ValidationError((err as Error).message);
    }
  }
  const description = b.description === undefined ? prev?.description ?? '' : (optStr(b, 'description', 'Description', 2000) ?? '');
  const enabled = b.enabled === undefined ? prev?.enabled ?? true : (optBool(b, 'enabled') ?? true);
  const row: ResourceLimit = {
    ...(prev ?? blank({ resourceKey, kind, name, owner, unit: nextUnit, source, capacity: nextCapacity, unlimited, thresholdMode: mode, warningValue: nextWarn, criticalValue: nextCrit, hardLimit: nextHard, recoveryMargin: nextMargin, quotaWindow: (windowRaw as QuotaWindow | null) ?? null, serverId, applicationId, description, managedBy: null })),
    resourceKey, kind, name, owner, unit: nextUnit, source, description, serverId, applicationId,
    capacity: nextCapacity, unlimited, usage, thresholdMode: mode,
    warningValue: nextWarn, criticalValue: nextCrit, hardLimit: nextHard,
    recoveryMargin: nextMargin,
    quotaWindow: (windowRaw as QuotaWindow | null) ?? null,
    enabled,
    updatedAt: nowIso(),
  };
  if (!prev) {
    row.createdAt = row.updatedAt;
    row.freshness = 'MISSING';
    row.alertState = 'UNKNOWN';
  }
  checkRecord(row);
  return row;
}

/**
 * Records a measurement. The same measurement id is a no-op. An older timestamp is refused.
 * The check and the write happen before the next request runs in this process.
 * Two server processes on one database are not coordinated.
 */
export function applyMeasurement(r: ResourceLimit, input: unknown): { idempotent: boolean } {
  const b = body({ body: input });
  const measurementId = optStr(b, 'measurementId', 'Measurement id', 80) ?? null;
  if (measurementId && measurementId === r.lastMeasurementId) return { idempotent: true };
  const usage = numOrNull(b, 'usage', 'Usage', 0, 1e18);
  if (usage === undefined || usage === null) throw new ValidationError('Usage is required. Omit the call when the value was not measured.');
  const measuredAt = optStr(b, 'measuredAt', 'Measured at', 40) ?? nowIso();
  if (Number.isNaN(Date.parse(measuredAt))) throw new ValidationError('Measured at must be an ISO-8601 timestamp');
  if (r.measuredAt && Date.parse(measuredAt) < Date.parse(r.measuredAt)) {
    throw new MeasurementConflict('This measurement is older than the one already stored');
  }
  const window = b.window === undefined || b.window === null || b.window === '' ? null : optStr(b, 'window', 'Window', 10);
  if (r.kind === 'API_QUOTA') {
    if (window !== r.quotaWindow) throw new ValidationError(`This quota is ${r.quotaWindow}. Send usage already counted for that window. It is not converted from another window.`);
  } else if (window) {
    throw new ValidationError('A request window applies only to an API quota');
  }
  r.usage = usage;
  r.measuredAt = new Date(measuredAt).toISOString();
  r.lastMeasurementId = measurementId;
  r.syncError = '';
  r.lastSyncAt = nowIso();
  r.updatedAt = r.lastSyncAt;
  return { idempotent: false };
}

function upsertManaged(match: (r: ResourceLimit) => boolean, create: () => ResourceLimit, patch: (r: ResourceLimit) => void): boolean {
  const row = db.resources.find(match);
  if (!row) {
    db.resources.push(create());
    return true;
  }
  const before = JSON.stringify(row);
  patch(row);
  row.updatedAt = nowIso();
  return before !== JSON.stringify(row);
}

/** Keeps three plan rows aligned with a server's purchased capacity. Does not invent usage. */
export function syncServerPlan(srv: ServerRecord): boolean {
  const key = (suffix: string) => `server:${srv.id}:${suffix}`;
  let changed = false;
  if (!srv.planSpec) {
    for (const suffix of ['cpu', 'memory', 'disk'] as const) {
      const row = db.resources.find(r => r.resourceKey === key(suffix) && r.managedBy === 'server-plan');
      if (!row || row.capacity === null) continue;
      row.capacity = null;
      row.lastSyncAt = nowIso();
      row.updatedAt = row.lastSyncAt;
      changed = true;
    }
    return changed;
  }
  const spec = srv.planSpec;
  const source: ResourceSource = spec.source === 'hostinger' ? 'provider' : spec.source;
  const storageUnit: ResourceUnit = spec.source === 'hostinger' ? 'GiB' : 'GB';
  const parts: Array<{ suffix: string; kind: ResourceKind; label: string; unit: ResourceUnit; capacity: number }> = [
    { suffix: 'cpu', kind: 'CPU', label: 'CPU', unit: 'cores', capacity: spec.cpuCores },
    { suffix: 'memory', kind: 'MEMORY', label: 'memory', unit: storageUnit, capacity: spec.ramGb },
    { suffix: 'disk', kind: 'SERVER_DISK', label: 'disk', unit: storageUnit, capacity: spec.diskGb },
  ];
  for (const part of parts) {
    if (!(part.capacity > 0)) continue;
    changed = upsertManaged(
      r => r.resourceKey === key(part.suffix),
      () => blank({
        resourceKey: key(part.suffix), kind: part.kind, name: `${srv.hostname} ${part.label}`, owner: 'Infrastructure',
        unit: part.unit, source, capacity: part.capacity, serverId: srv.id,
        applicationId: srv.applicationId || null, managedBy: 'server-plan',
        description: `Purchased plan ${spec.name || 'capacity'}. Usage stays empty until a measurement arrives.`,
      }),
      row => {
        const previousUnit = row.unit;
        row.name = `${srv.hostname} ${part.label}`;
        row.serverId = srv.id;
        row.source = source;
        row.capacity = part.capacity;
        row.unlimited = false;
        row.unit = part.unit;
        row.managedBy = 'server-plan';
        row.lastSyncAt = nowIso();
        if (previousUnit !== part.unit && row.usage !== null) {
          try { row.usage = roundMeasure(convertUnit(row.usage, previousUnit, part.unit)); } catch { row.usage = null; row.syncError = `Usage was in ${previousUnit} and could not be converted to ${part.unit}`; }
        }
      },
    ) || changed;
  }
  return changed;
}

export function syncAllServerPlans(): boolean {
  return db.servers.reduce((changed, srv) => syncServerPlan(srv) || changed, false);
}

/** Copies absolute agent observations onto plan and database rows. A missing field leaves the previous usage in place. */
export function applyServerTelemetry(srv: ServerRecord): { changed: boolean; sampled: ResourceLimit[] } {
  const measuredAt = srv.telemetry.observedAt || srv.telemetry.receivedAt || nowIso();
  let changed = false;
  const sampled = new Map<string, ResourceLimit>();
  const setUsage = (row: ResourceLimit, usage: number, at: string) => {
    const next = roundMeasure(usage);
    const usageChanged = row.usage !== next;
    row.usage = next;
    row.measuredAt = at;
    row.syncError = '';
    row.lastSyncAt = nowIso();
    row.updatedAt = row.lastSyncAt;
    if (usageChanged) sampled.set(row.id, row);
  };
  const observed = (kind: ResourceKind, suffix: string, label: string, unit: ResourceUnit) => {
    const resourceKey = `server:${srv.id}:${suffix}`;
    let row = db.resources.find(r => r.resourceKey === resourceKey);
    if (!row) {
      row = blank({
        resourceKey, kind, name: `${srv.hostname} ${label}`, owner: 'Infrastructure',
        unit, source: 'discovered', serverId: srv.id, capacity: null,
        description: 'Measured by the agent. No purchased limit is invented.',
      });
      db.resources.push(row);
      changed = true;
    }
    return row;
  };
  if (srv.cpuCores > 0 && Number.isFinite(srv.telemetry.cpuPercent)) {
    const cpu = observed('CPU', 'cpu', 'CPU', 'cores');
    const cores = (srv.telemetry.cpuPercent / 100) * srv.cpuCores;
    try {
      const usage = cpu.unit === 'percent' ? srv.telemetry.cpuPercent : convertUnit(cores, 'cores', cpu.unit);
      setUsage(cpu, usage, measuredAt);
      changed = true;
    } catch (err) {
      cpu.syncError = (err as Error).message;
      cpu.updatedAt = nowIso();
      changed = true;
    }
  }
  if (srv.telemetry.memUsedMb != null) {
    const memory = observed('MEMORY', 'memory', 'memory', 'GB');
    try {
      const bytes = srv.telemetry.memUsedMb * 1024 * 1024;
      setUsage(memory, convertUnit(bytes, 'bytes', memory.unit), measuredAt);
      changed = true;
    } catch (err) {
      memory.syncError = (err as Error).message;
      memory.updatedAt = nowIso();
      changed = true;
    }
  }
  if (srv.telemetry.diskUsedGb != null) {
    const disk = observed('SERVER_DISK', 'disk', 'disk', 'GB');
    try {
      setUsage(disk, convertUnit(srv.telemetry.diskUsedGb, 'GB', disk.unit), measuredAt);
      changed = true;
    } catch (err) {
      disk.syncError = (err as Error).message;
      disk.updatedAt = nowIso();
      changed = true;
    }
  }
  if (srv.cpuCores > 0 && Number.isFinite(srv.telemetry.loadAvg?.[0])) {
    const perCore = srv.telemetry.loadAvg[0] / srv.cpuCores;
    const resourceKey = `server:${srv.id}:load`;
    changed = upsertManaged(
      r => r.resourceKey === resourceKey,
      () => {
        const row = blank({
          resourceKey, kind: 'LOAD', name: `${srv.hostname} load`, owner: 'Infrastructure',
          unit: 'load', source: 'discovered', serverId: srv.id, managedBy: 'agent-load',
          thresholdMode: 'absolute', warningValue: 1, criticalValue: 2, recoveryMargin: 0.2,
          description: '1-minute load average per CPU core, from the agent. Warning at 1, critical at 2. No capacity is invented.',
        });
        setUsage(row, perCore, measuredAt);
        return row;
      },
      row => {
        row.thresholdMode = 'absolute';
        row.warningValue = row.warningValue ?? 1;
        row.criticalValue = row.criticalValue ?? 2;
        setUsage(row, perCore, measuredAt);
      },
    ) || changed;
  } else if (Number.isFinite(srv.telemetry.loadAvg?.[0])) {
    const existing = db.resources.find(r => r.resourceKey === `server:${srv.id}:load`);
    if (existing) {
      existing.syncError = 'Core count was not reported, so load per core was not updated.';
      existing.measuredAt = null;
      existing.updatedAt = nowIso();
      changed = true;
    }
  }
  for (const report of srv.databases ?? []) {
    const slug = (report.name || report.engine).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || report.engine;
    const when = report.observedAt || measuredAt;
    if (report.sizeBytes !== null && report.available) {
      const resourceKey = `server:${srv.id}:db:${slug}:size`;
      changed = upsertManaged(
        r => r.resourceKey === resourceKey,
        () => {
          const row = blank({
            resourceKey, kind: 'DATABASE_SIZE', name: `${srv.hostname} ${report.name || report.engine} size`, owner: 'Infrastructure',
            unit: 'bytes', source: 'discovered', serverId: srv.id, managedBy: 'agent-db',
            description: 'Size reported by the telemetry agent. No storage quota is assumed.',
          });
          setUsage(row, report.sizeBytes!, when);
          return row;
        },
        row => {
          if (row.managedBy === 'agent-db') row.source = 'discovered';
          try { setUsage(row, convertUnit(report.sizeBytes!, 'bytes', row.unit), when); } catch (err) { row.syncError = (err as Error).message; }
        },
      ) || changed;
    } else if (!report.available) {
      const row = db.resources.find(r => r.resourceKey === `server:${srv.id}:db:${slug}:size`);
      if (row && report.error) { row.syncError = report.error; row.updatedAt = nowIso(); changed = true; }
    }
    if (report.connections !== null && report.available) {
      const resourceKey = `server:${srv.id}:db:${slug}:connections`;
      changed = upsertManaged(
        r => r.resourceKey === resourceKey,
        () => {
          const row = blank({
            resourceKey, kind: 'DATABASE_CONNECTIONS', name: `${srv.hostname} ${report.name || report.engine} connections`, owner: 'Infrastructure',
            unit: 'connections', source: 'discovered', capacity: report.maxConnections, serverId: srv.id, managedBy: 'agent-db',
            description: 'Connections reported by the telemetry agent. Capacity is max_connections when the agent reported it.',
          });
          setUsage(row, report.connections!, when);
          return row;
        },
        row => {
          if (row.source === 'discovered' && report.maxConnections) row.capacity = report.maxConnections;
          setUsage(row, report.connections!, when);
        },
      ) || changed;
    }
  }
  return { changed, sampled: [...sampled.values()] };
}

function connectorRecord(v: unknown, label: string): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ValidationError(`${label} must be an object`);
  return v as Obj;
}

function connectorNumber(v: unknown, label: string): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e15) throw new ValidationError(`${label} must be a number from 0 to 1e15`);
  return n;
}

function connectorCapacity(v: unknown, label: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = connectorNumber(v, label);
  if (n <= 0) throw new ValidationError(`${label} must be greater than zero. Leave it empty when it is unknown.`);
  return n;
}

function connectorSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sample';
}

/**
 * Writes usage reported by a storage, seat, user, or API-quota endpoint.
 * A user count is stored as ACTIVE_USERS and is never written onto a seat limit.
 */
export function applyConnectorReport(input: unknown): ResourceLimit[] {
  const b = body({ body: input });
  if (b.storage === undefined && b.seats === undefined && b.users === undefined && b.apiQuota === undefined) {
    throw new ValidationError('Send storage, seats, users, or apiQuota from the endpoint');
  }
  const touched: ResourceLimit[] = [];
  const write = (
    resourceKey: string,
    usage: number,
    capacity: number | null,
    create: () => ResourceLimit,
  ) => {
    let row = db.resources.find(r => r.resourceKey === resourceKey);
    if (!row) {
      row = create();
      db.resources.push(row);
    } else if (row.managedBy === 'server-plan' || row.managedBy === 'agent-db' || row.managedBy === 'agent-load') {
      throw new ValidationError(`${row.name} is filled by the agent or the server plan`);
    }
    row.usage = roundMeasure(usage);
    if (capacity !== null) { row.capacity = capacity; row.unlimited = false; }
    row.measuredAt = nowIso();
    row.lastSyncAt = row.measuredAt;
    row.updatedAt = row.measuredAt;
    row.syncError = '';
    row.source = 'discovered';
    checkRecord(row);
    touched.push(row);
  };

  if (b.storage !== undefined) {
    const s = connectorRecord(b.storage, 'Storage');
    const name = reqStr(s, 'name', 'Storage name', 160);
    const owner = reqStr(s, 'owner', 'Storage owner', 200);
    const key = `connector:storage:${connectorSlug(name)}`;
    const capacity = connectorCapacity(s.capacityGb, 'Storage capacity');
    write(key, connectorNumber(s.usedGb, 'Storage used'), capacity, () => blank({
      resourceKey: key, kind: 'STORAGE', name, owner, unit: 'GB', source: 'discovered', capacity,
      description: 'Storage use reported by the storage connector.',
    }));
  }
  if (b.seats !== undefined) {
    const s = connectorRecord(b.seats, 'Seats');
    const name = reqStr(s, 'name', 'Seat name', 160);
    const owner = reqStr(s, 'owner', 'Seat owner', 200);
    const key = `connector:seats:${connectorSlug(name)}`;
    const capacity = connectorCapacity(s.capacity, 'Seat capacity');
    write(key, connectorNumber(s.used, 'Seats used'), capacity, () => blank({
      resourceKey: key, kind: 'SEATS', name, owner, unit: 'seats', source: 'discovered', capacity,
      description: 'Seat count reported by the seat connector. A user headcount is a different record.',
    }));
  }
  if (b.users !== undefined) {
    const s = connectorRecord(b.users, 'Users');
    const name = reqStr(s, 'name', 'User count name', 160);
    const owner = reqStr(s, 'owner', 'User count owner', 200);
    const key = `connector:users:${connectorSlug(name)}`;
    write(key, connectorNumber(s.count, 'User count'), null, () => blank({
      resourceKey: key, kind: 'ACTIVE_USERS', name, owner, unit: 'users', source: 'discovered', capacity: null,
      description: 'Active users reported by the user connector. This is not a seat limit.',
    }));
  }
  if (b.apiQuota !== undefined) {
    const s = connectorRecord(b.apiQuota, 'API quota');
    const name = reqStr(s, 'name', 'API name', 160);
    const owner = reqStr(s, 'owner', 'API owner', 200);
    const window = reqStr(s, 'window', 'API window', 10);
    if (window !== 'minute' && window !== 'hour' && window !== 'day') throw new ValidationError('API window must be minute, hour or day');
    const key = `connector:api:${connectorSlug(name)}`;
    const existing = db.resources.find(r => r.resourceKey === key);
    if (existing && existing.quotaWindow !== window) throw new ValidationError(`This quota is ${existing.quotaWindow}. Send usage already counted for that window.`);
    const capacity = connectorCapacity(s.limit, 'API limit');
    write(key, connectorNumber(s.requests, 'API requests'), capacity, () => blank({
      resourceKey: key, kind: 'API_QUOTA', name, owner, unit: 'requests', source: 'discovered', capacity, quotaWindow: window,
      description: 'API usage reported by the quota endpoint. The count is already for this window.',
    }));
  }
  return touched;
}

/** Reads storage, seat, user, and API-quota endpoints and returns the report those endpoints sent. */
export async function pullUsageEndpoints(input: unknown): Promise<Record<string, unknown>> {
  const b = body({ body: input });
  const endpoints = connectorRecord(b.endpoints, 'Endpoints');
  const out: Record<string, unknown> = {};
  const keys = ['storage', 'seats', 'users', 'apiQuota'] as const;
  const labels = { storage: 'Storage', seats: 'Seats', users: 'Users', apiQuota: 'API quota' };
  let any = false;
  for (const key of keys) {
    if (endpoints[key] === undefined || endpoints[key] === null || endpoints[key] === '') continue;
    any = true;
    const url = reqStr(endpoints, key, `${labels[key]} endpoint`, 2000);
    try {
      await assertSafeTarget(url, policyFromEnv(config.notifyAllowedPrivateTargets));
    } catch (err) {
      if (err instanceof UnsafeTargetError) throw new ValidationError(err.message);
      throw err;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) throw new ValidationError(`${labels[key]} endpoint redirected. Send the final URL.`);
      if (!res.ok) throw new ValidationError(`${labels[key]} endpoint returned HTTP ${res.status}`);
      const json = await res.json() as unknown;
      if (!json || typeof json !== 'object' || Array.isArray(json)) throw new ValidationError(`${labels[key]} endpoint did not return an object`);
      out[key] = json;
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError(`${labels[key]} endpoint could not be read`);
    } finally {
      clearTimeout(timer);
    }
  }
  if (!any) throw new ValidationError('Give a storage, seats, users, or apiQuota endpoint');
  return out;
}

export function detachServerResources(serverId: string): string[] {
  const ids = db.resources.filter(r => r.serverId === serverId).map(r => r.id);
  db.resources = db.resources.filter(r => r.serverId !== serverId);
  return ids;
}

export function unlinkApplicationResources(applicationId: string): void {
  const now = nowIso();
  for (const r of db.resources) {
    if (r.applicationId !== applicationId) continue;
    r.applicationId = null;
    r.updatedAt = now;
  }
}

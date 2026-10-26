/**
 * Resource capacity rules. Pure functions: the same inputs always produce the same state.
 *
 * Boundary (percent of a finite capacity): usage >= warning → WARNING, >= critical → CRITICAL,
 * usage > capacity → EXCEEDED. Equal to capacity is not exceeded.
 * A missing usage is never read as 0. An unknown capacity is never invented.
 * GB is 10^9 bytes. GiB is 1024^3 bytes. They are not interchangeable labels.
 * API quota usage is already counted inside the resource's window. This module does not
 * turn an hourly count into a daily count.
 */
import type { ResourceAlertState, ResourceFreshness, ResourceKind, ResourceUnit, ThresholdMode } from '../types/index.ts';

export const RESOURCE_KINDS: ResourceKind[] = [
  'CPU', 'MEMORY', 'SERVER_DISK', 'STORAGE', 'SEATS', 'ACTIVE_USERS', 'DATABASE_SIZE', 'DATABASE_CONNECTIONS', 'API_QUOTA', 'LOAD',
];

export const RESOURCE_UNITS: ResourceUnit[] = [
  'cores', 'millicores', 'percent', 'bytes', 'GiB', 'GB', 'seats', 'users', 'connections', 'requests', 'load',
];

/** Global percent defaults. A null entry means "a measurement with no capacity is not a breach". */
export const RESOURCE_DEFAULTS: Record<ResourceKind, { warning: number; critical: number } | null> = {
  CPU: { warning: 85, critical: 95 },
  MEMORY: { warning: 85, critical: 95 },
  SERVER_DISK: { warning: 85, critical: 95 },
  STORAGE: { warning: 85, critical: 95 },
  DATABASE_SIZE: { warning: 85, critical: 95 },
  DATABASE_CONNECTIONS: { warning: 80, critical: 90 },
  SEATS: { warning: 90, critical: 100 },
  API_QUOTA: { warning: 80, critical: 100 },
  ACTIVE_USERS: null,
  /** Absolute load per core is set on the row (warning 1, critical 2). A percent of an unknown limit is not used. */
  LOAD: null,
};

const KIND_UNITS: Record<ResourceKind, ResourceUnit[]> = {
  CPU: ['cores', 'millicores', 'percent'],
  MEMORY: ['bytes', 'GiB', 'GB'],
  SERVER_DISK: ['bytes', 'GiB', 'GB'],
  STORAGE: ['bytes', 'GiB', 'GB'],
  DATABASE_SIZE: ['bytes', 'GiB', 'GB'],
  DATABASE_CONNECTIONS: ['connections'],
  SEATS: ['seats'],
  ACTIVE_USERS: ['users'],
  API_QUOTA: ['requests'],
  LOAD: ['load'],
};

export function unitsFor(kind: ResourceKind): ResourceUnit[] {
  return KIND_UNITS[kind];
}

export function unitAllowed(kind: ResourceKind, unit: ResourceUnit): boolean {
  return KIND_UNITS[kind].includes(unit);
}

const GIB = 1024 ** 3;
const GB = 1e9;

/** Converts a quantity. Throws when the units are not the same dimension. */
export function convertUnit(value: number, from: ResourceUnit, to: ResourceUnit): number {
  if (from === to) return value;
  if (!Number.isFinite(value)) throw new Error(`Cannot convert a non-finite ${from} value`);
  const bytes = (unit: ResourceUnit, v: number): number | null => {
    if (unit === 'bytes') return v;
    if (unit === 'GiB') return v * GIB;
    if (unit === 'GB') return v * GB;
    return null;
  };
  const fromBytes = bytes(from, value);
  const toBytes = bytes(to, 1);
  if (fromBytes !== null && toBytes !== null) return fromBytes / toBytes;
  if ((from === 'cores' && to === 'millicores') || (from === 'millicores' && to === 'cores')) {
    return from === 'cores' ? value * 1000 : value / 1000;
  }
  throw new Error(`Cannot convert ${from} to ${to}`);
}

export function roundMeasure(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export interface ThresholdCheck {
  mode: ThresholdMode;
  warning: number | null;
  critical: number | null;
  margin: number;
  unlimited: boolean;
}

/** Returns a user-facing error, or null when the pair is usable. Both values empty means "inherit". */
export function thresholdProblem(t: ThresholdCheck): string | null {
  if (!Number.isFinite(t.margin) || t.margin < 0 || t.margin > 1e6) return 'Recovery margin must be zero or a positive number';
  const empty = t.warning === null && t.critical === null;
  if (t.warning === null || t.critical === null) {
    if (!empty) return 'Set both a warning and a critical threshold, or leave both empty to use the default';
    if (t.unlimited && t.mode === 'percent') return null;
    return null;
  }
  if (t.warning <= 0 || t.critical <= t.warning) return 'Critical threshold must be higher than the warning threshold, and the warning must be above zero';
  if (t.mode === 'percent') {
    if (t.unlimited) return 'An unlimited resource cannot use a percentage of capacity. Use an absolute threshold or leave both empty.';
    if (t.critical > 100) return 'A percentage critical threshold cannot be above 100. Usage above capacity is exceeded on its own.';
    if (t.margin >= t.warning) return 'Recovery margin must be lower than the warning percentage so the resource can return to normal';
  } else if (t.margin >= t.warning) {
    return 'Recovery margin must be lower than the warning value so the resource can return to normal';
  }
  return null;
}

export interface CapacityInput {
  kind: ResourceKind;
  usage: number | null;
  capacity: number | null;
  unlimited: boolean;
  thresholdMode: ThresholdMode;
  warningValue: number | null;
  criticalValue: number | null;
  hardLimit: number | null;
  recoveryMargin: number;
  previous: ResourceAlertState;
  measuredAt: string | null;
  syncError: string;
  now: number;
  staleMs: number;
  /** From an enabled infrastructure monitor on the same server. Null when that monitor is not set. */
  monitorWarning: number | null;
  monitorCritical: number | null;
}

export interface CapacityResult {
  state: ResourceAlertState;
  freshness: ResourceFreshness;
  utilizationPercent: number | null;
  thresholdFrom: 'resource' | 'monitor' | 'default' | 'none';
  mode: ThresholdMode;
  warning: number | null;
  critical: number | null;
  /** The number compared with the thresholds. Null when the state is not a threshold result. */
  metric: number | null;
}

function pair(mode: ThresholdMode, warning: number, critical: number, from: CapacityResult['thresholdFrom']): Pick<CapacityResult, 'mode' | 'warning' | 'critical' | 'thresholdFrom'> {
  return { mode, warning, critical, thresholdFrom: from };
}

function thresholds(input: CapacityInput): Pick<CapacityResult, 'mode' | 'warning' | 'critical' | 'thresholdFrom'> {
  if (input.warningValue !== null && input.criticalValue !== null) {
    return pair(input.thresholdMode, input.warningValue, input.criticalValue, 'resource');
  }
  const fallback = RESOURCE_DEFAULTS[input.kind];
  if (input.monitorWarning !== null && input.monitorCritical !== null && fallback) {
    return pair('percent', input.monitorWarning, input.monitorCritical, 'monitor');
  }
  if (fallback) return pair('percent', fallback.warning, fallback.critical, 'default');
  return { mode: input.thresholdMode, warning: null, critical: null, thresholdFrom: 'none' };
}

function hold(metric: number, previous: ResourceAlertState, warning: number, critical: number, margin: number): ResourceAlertState {
  const above = (line: number) => metric >= line;
  if (previous === 'CRITICAL' || previous === 'EXCEEDED') {
    if (above(critical) || above(critical - margin)) return 'CRITICAL';
    if (above(warning) || above(warning - margin)) return 'WARNING';
    return 'NORMAL';
  }
  if (previous === 'WARNING') {
    if (above(critical)) return 'CRITICAL';
    if (above(warning) || above(warning - margin)) return 'WARNING';
    return 'NORMAL';
  }
  if (above(critical)) return 'CRITICAL';
  if (above(warning)) return 'WARNING';
  return 'NORMAL';
}

/**
 * Decides the state of one resource.
 * Enter WARNING/CRITICAL at the threshold. Leave only after dropping by the recovery margin.
 * EXCEEDED is usage strictly above a finite capacity or above the hard limit, with no margin.
 */
export function evaluateCapacity(input: CapacityInput): CapacityResult {
  const base = {
    utilizationPercent: null as number | null,
    metric: null as number | null,
    ...thresholds(input),
  };
  if (input.usage === null || !Number.isFinite(input.usage)) {
    return { ...base, state: 'UNKNOWN', freshness: input.syncError ? 'ERROR' : 'MISSING' };
  }
  const measured = input.measuredAt ? Date.parse(input.measuredAt) : NaN;
  if (!Number.isFinite(measured) || input.now - measured > input.staleMs) {
    return { ...base, state: 'STALE', freshness: 'STALE' };
  }
  const finiteCap = !input.unlimited && input.capacity !== null && input.capacity > 0;
  const utilization = finiteCap ? Math.round((input.usage / input.capacity!) * 1000) / 10 : null;
  const fresh = { ...base, utilizationPercent: utilization, freshness: 'FRESH' as const };
  if ((finiteCap && input.usage > input.capacity!) || (input.hardLimit !== null && input.usage > input.hardLimit)) {
    return { ...fresh, state: 'EXCEEDED' };
  }
  const spec = thresholds(input);
  if (spec.warning === null || spec.critical === null) return { ...fresh, state: 'NORMAL' };
  if (spec.mode === 'percent' && !finiteCap) return { ...fresh, state: 'UNKNOWN', freshness: 'FRESH' };
  const metric = spec.mode === 'percent' ? input.usage / input.capacity! * 100 : input.usage;
  return { ...fresh, metric, state: hold(metric, input.previous, spec.warning, spec.critical, input.recoveryMargin) };
}

export function infraMonitorType(kind: ResourceKind): 'INFRA_CPU' | 'INFRA_RAM' | 'INFRA_DISK' | null {
  if (kind === 'CPU') return 'INFRA_CPU';
  if (kind === 'MEMORY') return 'INFRA_RAM';
  if (kind === 'SERVER_DISK') return 'INFRA_DISK';
  return null;
}

/** Monitor fields store a percent in the threshold columns. 0 means "use the global default for that side". */
export function monitorBand(
  kind: ResourceKind,
  monitor: { warningThresholdMs: number; criticalThresholdMs: number } | null,
): { warning: number | null; critical: number | null } {
  const fallback = RESOURCE_DEFAULTS[kind];
  if (!monitor || !fallback || !infraMonitorType(kind)) return { warning: null, critical: null };
  const warning = monitor.warningThresholdMs > 0 ? monitor.warningThresholdMs : fallback.warning;
  const critical = monitor.criticalThresholdMs > 0 ? monitor.criticalThresholdMs : fallback.critical;
  if (critical <= warning) return { warning: fallback.warning, critical: fallback.critical };
  return { warning, critical };
}

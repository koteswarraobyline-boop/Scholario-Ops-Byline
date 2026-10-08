/**
 * Agent >= 3.3 telemetry: validation and normalisation of the extended report sections.
 *
 * Every number is range-checked and every string length-capped; anything malformed becomes null or
 * is dropped — never guessed. Lists are capped so one bad agent cannot bloat the stored state.
 * A section that is absent from a report (heavy collectors run on every 3rd report) keeps the
 * previously reported value; an explicit null means the agent looked and the source is unavailable
 * (e.g. PM2 not running on this server).
 */
import {
  ApplicationHealthTelemetry, DiskIOTelemetry, FailedUnitsTelemetry, FilesystemTelemetry, ListeningPortTelemetry,
  NetworkInterfaceTelemetry, NtpTelemetry, PM2ProcessTelemetry, Pm2Status, PressureTelemetry, SystemInfoTelemetry,
} from '../src/types/index.ts';
import { THRESHOLDS } from '../src/lib/thresholds.ts';
import { db, ServerRecord } from './store.ts';

/** Sections added in agent 3.3 (all optional; older agents simply do not send them) */
export interface ExtendedAgentReport {
  cpuIowaitPercent?: unknown;
  cpuStealPercent?: unknown;
  swapTotalMb?: unknown;
  swapUsedMb?: unknown;
  swapFreeMb?: unknown;
  swapPercent?: unknown;
  pressure?: unknown;
  networkInterfaces?: unknown;
  diskIo?: unknown;
  filesystems?: unknown;
  pm2?: unknown;
  appChecks?: unknown;
  listeningPorts?: unknown;
  ntp?: unknown;
  system?: unknown;
  failedUnits?: unknown;
  sentAt?: unknown;
  lastReportRttMs?: unknown;
}

/** Report keys that must be lists when present (null allowed where the agent uses it for "not available") */
export const LIST_KEYS = ['networkInterfaces', 'diskIo', 'filesystems', 'appChecks'] as const;
export const NULLABLE_LIST_KEYS = ['pm2', 'listeningPorts'] as const;
export const NULLABLE_OBJECT_KEYS = ['pressure', 'ntp', 'system', 'failedUnits'] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Finite number within [min, max] rounded to `digits`, otherwise null */
export function optNum(v: unknown, min: number, max: number, digits = 1): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
const optInt = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);
const optStr = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const optBool = (v: unknown) => (typeof v === 'boolean' ? v : null);
const optIso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const list = (v: unknown, max: number): Obj[] => (Array.isArray(v) ? v.slice(0, max).filter(isObj) : []);

const PM2_STATUSES: Pm2Status[] = ['online', 'stopping', 'stopped', 'launching', 'errored', 'one-launch-status', 'waiting restart', 'unknown'];

// PM2 restart counters seen recently, to detect restart spikes (in memory: a restart of
// Scholario Ops only resets the window, it never invents restarts)
const pm2RestartLog = new Map<string, Array<{ t: number; count: number }>>();

function recentRestarts(key: string, count: number | null, now: number): number | null {
  if (count === null) return null;
  const windowMs = THRESHOLDS.pm2Restarts.restartWindowMinutes * 60_000;
  let log = pm2RestartLog.get(key) ?? [];
  if (log.length && count < log[log.length - 1].count) log = []; // counter reset (pm2 reset / app re-created)
  log.push({ t: now, count });
  log = log.filter(e => now - e.t <= windowMs);
  pm2RestartLog.set(key, log);
  return count - log[0].count;
}

export function parsePm2(raw: Obj[], serverId: string, now: number): PM2ProcessTelemetry[] {
  return raw.slice(0, 60).map(p => {
    const name = optStr(p.name, 100) ?? '(unnamed)';
    const id = optInt(p.id, 0, 1e6);
    const owner = optStr(p.owner, 64);
    const restartCount = optInt(p.restartCount, 0, 1e9);
    return {
      id, name,
      status: PM2_STATUSES.includes(p.status as Pm2Status) ? p.status as Pm2Status : 'unknown',
      pid: optInt(p.pid, 1, 1e9),
      cpuPercent: optNum(p.cpuPercent, 0, 10_000),
      memoryMb: optNum(p.memoryMb, 0, 1e7),
      uptimeSec: optNum(p.uptimeSec, 0, 1e10, 0),
      startedAt: optIso(p.startedAt),
      restartCount,
      unstableRestarts: optInt(p.unstableRestarts, 0, 1e9),
      recentRestarts: recentRestarts(`${serverId}|${owner ?? ''}|${id ?? ''}|${name}`, restartCount, now),
      nodeVersion: optStr(p.nodeVersion, 32),
      interpreter: optStr(p.interpreter, 32),
      execMode: optStr(p.execMode, 16),
      instances: optInt(p.instances, -1, 1024),
      version: optStr(p.version, 40),
      release: optStr(p.release, 64),
      gitRevision: typeof p.gitRevision === 'string' && /^[0-9a-f]{7,40}$/.test(p.gitRevision) ? p.gitRevision.slice(0, 12) : null,
      owner,
      ports: Array.isArray(p.ports) ? p.ports.filter(x => optInt(x, 1, 65535) !== null).slice(0, 16) as number[] : [],
    };
  });
}

function parseInterfaces(raw: Obj[], previous: NetworkInterfaceTelemetry[] | undefined): NetworkInterfaceTelemetry[] {
  const cnt = (v: unknown) => optInt(v, 0, Number.MAX_SAFE_INTEGER);
  return raw.slice(0, 32).flatMap(i => {
    const name = optStr(i.name, 32);
    if (!name) return [];
    const rxErrors = cnt(i.rxErrors), txErrors = cnt(i.txErrors), rxDrops = cnt(i.rxDrops), txDrops = cnt(i.txDrops);
    const prev = previous?.find(p => p.name === name);
    // Increase since the previous report; null on the first report or after a counter reset (reboot)
    const delta = (a: number | null, b: number | null, pa: number | null | undefined, pb: number | null | undefined) =>
      a === null || b === null || pa == null || pb == null || a + b < pa + pb ? null : a + b - pa - pb;
    return [{
      name,
      rxBytesPerSec: optNum(i.rxBytesPerSec, 0, 1e12), txBytesPerSec: optNum(i.txBytesPerSec, 0, 1e12),
      rxPacketsPerSec: optNum(i.rxPacketsPerSec, 0, 1e10), txPacketsPerSec: optNum(i.txPacketsPerSec, 0, 1e10),
      rxErrors, txErrors, rxDrops, txDrops,
      newErrors: delta(rxErrors, txErrors, prev?.rxErrors, prev?.txErrors),
      newDrops: delta(rxDrops, txDrops, prev?.rxDrops, prev?.txDrops),
      operationalState: optStr(i.operationalState, 16),
      virtual: optBool(i.virtual),
    }];
  });
}

function parseDiskIo(raw: Obj[]): DiskIOTelemetry[] {
  return raw.slice(0, 16).flatMap(d => {
    const device = optStr(d.device, 32);
    if (!device) return [];
    return [{
      device,
      readBytesPerSec: optNum(d.readBytesPerSec, 0, 1e12, 0), writeBytesPerSec: optNum(d.writeBytesPerSec, 0, 1e12, 0),
      readOpsPerSec: optNum(d.readOpsPerSec, 0, 1e9), writeOpsPerSec: optNum(d.writeOpsPerSec, 0, 1e9),
      ioUtilizationPercent: optNum(d.ioUtilizationPercent, 0, 100),
      readLatencyMs: optNum(d.readLatencyMs, 0, 1e7, 2), writeLatencyMs: optNum(d.writeLatencyMs, 0, 1e7, 2),
    }];
  });
}

function parseFilesystems(raw: Obj[]): FilesystemTelemetry[] {
  return raw.slice(0, 30).flatMap(f => {
    const mountPoint = optStr(f.mountPoint, 256);
    if (!mountPoint) return [];
    const big = (v: unknown) => optInt(v, 0, Number.MAX_SAFE_INTEGER);
    return [{
      mountPoint, filesystem: optStr(f.filesystem, 32) ?? '', device: optStr(f.device, 128) ?? '',
      totalGb: optNum(f.totalGb, 0, 1e7, 2), usedGb: optNum(f.usedGb, 0, 1e7, 2), freeGb: optNum(f.freeGb, 0, 1e7, 2),
      usedPercent: optNum(f.usedPercent, 0, 100),
      inodeTotal: big(f.inodeTotal), inodeUsed: big(f.inodeUsed), inodeFree: big(f.inodeFree), inodePercent: optNum(f.inodePercent, 0, 100),
    }];
  });
}

function parseAppChecks(raw: Obj[], previous: ApplicationHealthTelemetry[] | undefined, now: string): ApplicationHealthTelemetry[] {
  return raw.slice(0, 20).flatMap(c => {
    const port = optInt(c.port, 1, 65535);
    if (port === null) return [];
    const status = c.status === 'HEALTHY' || c.status === 'DOWN' ? c.status : 'UNKNOWN';
    const applicationId = optStr(c.applicationId, 64) ?? '';
    const prev = previous?.find(p => p.applicationId === applicationId && p.port === port);
    return [{
      applicationId, name: optStr(c.name, 100) ?? '', environment: c.environment === 'PRD' || c.environment === 'DR' ? c.environment : null,
      port, path: optStr(c.path, 200) ?? '/', listening: optBool(c.listening), status,
      statusCode: optInt(c.statusCode, 100, 599), latencyMs: optNum(c.latencyMs, 0, 600_000), error: optStr(c.error, 300),
      checkedAt: optIso(c.checkedAt) ?? now,
      consecutiveFailures: status === 'DOWN' ? (prev?.status === 'DOWN' ? prev.consecutiveFailures + 1 : 1) : 0,
    }];
  });
}

function parseListening(raw: Obj[]): ListeningPortTelemetry[] {
  return raw.slice(0, 100).flatMap(l => {
    const port = optInt(l.port, 1, 65535);
    if (port === null) return [];
    return [{
      address: optStr(l.address, 64) ?? '*', port, process: optStr(l.process, 64),
      pids: Array.isArray(l.pids) ? l.pids.filter(x => optInt(x, 1, 1e9) !== null).slice(0, 8) as number[] : [],
      scope: l.scope === 'loopback' || l.scope === 'all' || l.scope === 'address' ? l.scope : 'address',
    }];
  });
}

function parsePressure(p: Obj): PressureTelemetry {
  return { cpu: optNum(p.cpu, 0, 100, 2), memory: optNum(p.memory, 0, 100, 2), io: optNum(p.io, 0, 100, 2) };
}

function parseNtp(n: Obj, observedAt: string): NtpTelemetry {
  return {
    synchronized: optBool(n.synchronized), ntpEnabled: optBool(n.ntpEnabled), service: optStr(n.service, 32),
    clockOffsetMs: optNum(n.clockOffsetMs, -1e9, 1e9, 3), clockDriftPpm: optNum(n.clockDriftPpm, -1e6, 1e6, 3), observedAt,
  };
}

function parseSystem(s: Obj): SystemInfoTelemetry {
  return {
    kernelVersion: optStr(s.kernelVersion, 120), architecture: optStr(s.architecture, 32), bootTime: optIso(s.bootTime),
    timezone: optStr(s.timezone, 64), osName: optStr(s.osName, 80), osVersion: optStr(s.osVersion, 80),
    nodeVersion: optStr(s.nodeVersion, 32), npmVersion: optStr(s.npmVersion, 32),
  };
}

function parseFailedUnits(f: Obj, observedAt: string): FailedUnitsTelemetry | null {
  const count = optInt(f.count, 0, 100_000);
  if (count === null) return null;
  return { count, units: Array.isArray(f.units) ? f.units.map(u => optStr(u, 128)).filter((u): u is string => Boolean(u)).slice(0, 25) : [], observedAt };
}

/**
 * Applies the agent >= 3.3 sections of a report to the server record. `srv.telemetry` must already
 * hold the core values of this report. `receivedMs` = server receive time.
 */
export function applyExtendedReport(srv: ServerRecord, r: ExtendedAgentReport, observedAt: string, receivedMs: number) {
  const t = srv.telemetry;
  t.cpuIowaitPercent = optNum(r.cpuIowaitPercent, 0, 100);
  t.cpuStealPercent = optNum(r.cpuStealPercent, 0, 100);
  t.loadPerCore = srv.cpuCores > 0 ? Math.round((t.loadAvg[0] / srv.cpuCores) * 100) / 100 : null;
  t.swapTotalMb = optNum(r.swapTotalMb, 0, 1e8, 0);
  t.swapUsedMb = optNum(r.swapUsedMb, 0, 1e8, 0);
  t.swapFreeMb = optNum(r.swapFreeMb, 0, 1e8, 0);
  t.swapPercent = optNum(r.swapPercent, 0, 100);
  t.pressure = isObj(r.pressure) ? parsePressure(r.pressure) : null;

  if (Array.isArray(r.networkInterfaces)) srv.networkInterfaces = parseInterfaces(list(r.networkInterfaces, 32), srv.networkInterfaces);
  if (Array.isArray(r.diskIo)) {
    srv.diskIo = parseDiskIo(list(r.diskIo, 16));
    const sum = (k: keyof DiskIOTelemetry) => {
      const v = srv.diskIo!.map(d => d[k]).filter((x): x is number => typeof x === 'number');
      return v.length ? Math.round(v.reduce((a, b) => a + b, 0) * 10) / 10 : null;
    };
    const util = srv.diskIo.map(d => d.ioUtilizationPercent).filter((x): x is number => x !== null);
    t.diskReadBytesPerSec = sum('readBytesPerSec');
    t.diskWriteBytesPerSec = sum('writeBytesPerSec');
    t.diskReadOpsPerSec = sum('readOpsPerSec');
    t.diskWriteOpsPerSec = sum('writeOpsPerSec');
    t.diskUtilPercent = util.length ? Math.max(...util) : null;
  } else {
    t.diskReadBytesPerSec = t.diskWriteBytesPerSec = t.diskReadOpsPerSec = t.diskWriteOpsPerSec = t.diskUtilPercent = null;
  }
  if (Array.isArray(r.filesystems)) srv.filesystems = parseFilesystems(list(r.filesystems, 30));
  if (r.pm2 === null) { srv.pm2 = null; srv.pm2ObservedAt = observedAt; }
  else if (Array.isArray(r.pm2)) { srv.pm2 = parsePm2(list(r.pm2, 60), srv.id, receivedMs); srv.pm2ObservedAt = observedAt; }
  if (Array.isArray(r.appChecks)) srv.appHealth = parseAppChecks(list(r.appChecks, 20), srv.appHealth, observedAt);
  if (r.listeningPorts === null) srv.listeningPorts = null;
  else if (Array.isArray(r.listeningPorts)) srv.listeningPorts = parseListening(list(r.listeningPorts, 100));
  if (r.ntp === null) srv.ntp = null;
  else if (isObj(r.ntp)) srv.ntp = parseNtp(r.ntp, observedAt);
  if (isObj(r.system)) srv.system = parseSystem(r.system);
  if (r.failedUnits === null) srv.failedUnits = null;
  else if (isObj(r.failedUnits)) srv.failedUnits = parseFailedUnits(r.failedUnits, observedAt);

  // Delivery timing: half the previous round trip ≈ one-way delay; skew = receive − send − delay
  const sentAt = optIso(r.sentAt);
  const rtt = optNum(r.lastReportRttMs, 0, 600_000);
  const transportDelayMs = rtt === null ? null : Math.round(rtt / 2);
  srv.agentTiming = {
    sentAt,
    transportDelayMs,
    clockSkewMs: sentAt ? Math.round(receivedMs - Date.parse(sentAt) - (transportDelayMs ?? 0)) : null,
  };
}

const SAFE_PATH = /^\/[A-Za-z0-9._~\-/?=&%:+,]*$/;

/** Local health checks the agent on this server should run: applications whose PRD/DR server it is and that have an app port. */
export function appChecksFor(srv: ServerRecord): Array<{ applicationId: string; name: string; environment: 'PRD' | 'DR'; port: number; path: string }> {
  const out: Array<{ applicationId: string; name: string; environment: 'PRD' | 'DR'; port: number; path: string }> = [];
  for (const app of db.applications) {
    for (const env of ['PRD', 'DR'] as const) {
      if ((env === 'PRD' ? app.prdServerId : app.drServerId) !== srv.id) continue;
      const inv = app.environments?.[env];
      if (!inv?.appPort) continue;
      const path = inv.healthPath && SAFE_PATH.test(inv.healthPath) && inv.healthPath.length <= 200 ? inv.healthPath : '/';
      out.push({ applicationId: app.id, name: app.name, environment: env, port: inv.appPort, path });
    }
  }
  return out.slice(0, 20);
}

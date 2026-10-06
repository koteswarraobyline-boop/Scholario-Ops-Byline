import fs from 'fs';
import path from 'path';
import {
  Application, VpsServer, Monitor, Incident, AuditLog, CommunicationChannel,
  EscalationPolicy, MaintenanceWindow, Runbook, Deployment, BackupRecord, OpsUser, ServerMetricPoint,
} from '../src/types/index.ts';
import { DATA_DIR } from './config.ts';

export interface ServerRecord extends VpsServer {
  /** Secret the telemetry agent uses to authenticate. Never sent to the browser. */
  agentToken: string;
  createdAt: string;
  hostingerVmId?: number;
  hostingerState?: string;
}

export interface UserRecord extends OpsUser {
  passwordHash: string;
  /** Incremented on password change / forced logout to invalidate all issued tokens */
  tokenVersion: number;
}

/** Hourly aggregate of monitor check results, used for uptime + error rate (30-day window) */
export interface MonitorBucket { h: number; total: number; ok: number; latSum: number }

export interface RefreshTokenRecord { id: string; userId: string; expiresAt: number }

export interface StoreData {
  version: 1;
  servers: ServerRecord[];
  applications: Application[];
  monitors: Monitor[];
  monitorBuckets: Record<string, MonitorBucket[]>;
  incidents: Incident[];
  incidentSeq: number;
  auditLogs: AuditLog[];
  users: UserRecord[];
  refreshTokens: RefreshTokenRecord[];
  channels: CommunicationChannel[];
  escalationPolicies: EscalationPolicy[];
  maintenanceWindows: MaintenanceWindow[];
  runbooks: Runbook[];
  deployments: Deployment[];
  backups: BackupRecord[];
}

const STORE_FILE = path.join(DATA_DIR, 'ops-store.json');
const METRICS_FILE = path.join(DATA_DIR, 'metrics.json');

function emptyStore(): StoreData {
  return {
    version: 1,
    servers: [],
    applications: [],
    monitors: [],
    monitorBuckets: {},
    incidents: [],
    incidentSeq: 1000,
    auditLogs: [],
    users: [],
    refreshTokens: [],
    channels: [],
    escalationPolicies: [],
    maintenanceWindows: [],
    runbooks: [],
    deployments: [],
    backups: [],
  };
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw) as T;
}

function loadStore(): StoreData {
  try {
    const data = readJson<StoreData>(STORE_FILE);
    if (data) return { ...emptyStore(), ...data };
  } catch (err) {
    console.error(`[store] ${STORE_FILE} is corrupt (${(err as Error).message}) — trying backup`);
    try {
      const bak = readJson<StoreData>(`${STORE_FILE}.bak`);
      if (bak) {
        fs.copyFileSync(STORE_FILE, `${STORE_FILE}.corrupt-${Date.now()}`);
        console.error('[store] Restored data from backup file');
        return { ...emptyStore(), ...bak };
      }
    } catch (bakErr) {
      console.error(`[store] Backup is also unreadable: ${(bakErr as Error).message}`);
    }
    // Refuse to start with empty data on top of a corrupt file: that would silently wipe it.
    throw new Error(`Data file ${STORE_FILE} is corrupt and no valid backup exists. Fix or move it before starting.`);
  }
  return emptyStore();
}

export const db: StoreData = loadStore();

/** In-memory time series (5s resolution, last hour) + persisted 1-minute rollups */
export const liveMetrics: Record<string, ServerMetricPoint[]> = {};
export let minuteMetrics: Record<string, ServerMetricPoint[]> = {};
try {
  minuteMetrics = readJson<Record<string, ServerMetricPoint[]>>(METRICS_FILE) ?? {};
} catch (err) {
  console.error(`[store] metrics file unreadable, starting fresh: ${(err as Error).message}`);
  minuteMetrics = {};
}

function atomicWrite(file: string, content: string) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(tmp, file);
}

let dirty = false;
let saveTimer: NodeJS.Timeout | null = null;

export function persist() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(flush, 1000);
}

export function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!dirty) return;
  dirty = false;
  try {
    atomicWrite(STORE_FILE, JSON.stringify(db));
  } catch (err) {
    dirty = true;
    console.error(`[store] Failed to save data: ${(err as Error).message}`);
  }
}

export function flushMetrics() {
  try {
    atomicWrite(METRICS_FILE, JSON.stringify(minuteMetrics));
  } catch (err) {
    console.error(`[store] Failed to save metrics: ${(err as Error).message}`);
  }
}

setInterval(flushMetrics, 60_000).unref();

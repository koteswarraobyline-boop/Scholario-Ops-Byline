/**
 * Data store backed by PostgreSQL (the single source of truth).
 *
 * At startup the whole working set is loaded from PostgreSQL into `db`. Code mutates `db`
 * and calls persist(); within ~1 s the changed rows are written back in one transaction
 * (row-level diff: only rows whose content changed are upserted, removed rows are deleted).
 * Administrator-entered configuration (servers, applications, Cloudflare LB mapping,
 * monitors) is stored in real columns, see server/migrations/001_init.sql.
 */
import fs from 'fs';
import path from 'path';
import type pg from 'pg';
import {
  Application, VpsServer, Monitor, Incident, AuditLog, CommunicationChannel,
  EscalationPolicy, MaintenanceWindow, Runbook, Deployment, BackupRecord, OpsUser, ServerMetricPoint, CheckRecord,
} from '../src/types/index.ts';
import { DATA_DIR, config } from './config.ts';
import { query, withTransaction, migrate, T } from './db.ts';
import { log } from './logger.ts';

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

function emptyStore(): StoreData {
  return {
    version: 1, servers: [], applications: [], monitors: [], monitorBuckets: {}, incidents: [], incidentSeq: 1000,
    auditLogs: [], users: [], refreshTokens: [], channels: [], escalationPolicies: [], maintenanceWindows: [],
    runbooks: [], deployments: [], backups: [],
  };
}

/** In-memory working set. Populated by initStore(); empty until then. */
export const db: StoreData = emptyStore();

/** In-memory time series (5s resolution, last hour) + persisted 1-minute rollups */
export const liveMetrics: Record<string, ServerMetricPoint[]> = {};
export const minuteMetrics: Record<string, ServerMetricPoint[]> = {};

// ─────────────────────────────────────────────────────────────────────────────
// Row mapping
// ─────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
interface TableDef<T> {
  table: string;
  key: string[];
  columns: string[];
  rows: (d: StoreData) => Array<{ k: string; values: unknown[] }>;
  load: (rows: Row[], d: StoreData) => void;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : '');
const isoOrNull = (s: string | null | undefined) => (s ? s : null);
const uuidOrNull = (s: string | null | undefined) => (s ? s : null);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const omit = <O extends object>(o: O, keys: readonly string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

const SERVER_CONFIG_KEYS = ['id', 'hostname', 'ip', 'environment', 'applicationId', 'provider', 'region', 'plan', 'planSpec', 'notes', 'agentToken', 'hostingerVmId', 'hostingerState', 'createdAt'] as const;
const APP_CONFIG_KEYS = ['id', 'name', 'codeName', 'description', 'tier', 'rtoTargetMin', 'rpoTargetMin', 'prdServerId', 'drServerId', 'prdUrl', 'drUrl', 'cloudflareZone', 'dnsRecordName', 'autoFailover', 'failoverState', 'lastFailoverAt', 'healthCheck', 'loadBalancer', 'environments'] as const;
const MONITOR_CONFIG_KEYS = ['id', 'applicationId', 'serverId', 'name', 'type', 'target', 'environment', 'intervalSec', 'timeoutSec', 'retries', 'warningThresholdMs', 'criticalThresholdMs', 'failureConfirmationThreshold', 'recoveryConfirmationThreshold', 'expectedStatusCode', 'expectedBodyContains', 'enabled', 'runbookId', 'heartbeatToken', 'managedBy'] as const;
const INCIDENT_COLUMN_KEYS = ['id', 'title', 'severity', 'status', 'applicationId', 'environment', 'fingerprint', 'rootCause', 'startedAt', 'resolvedAt', 'durationMinutes', 'owner', 'acknowledged', 'acknowledgedAt', 'acknowledgedBy', 'recoveryStatus', 'runbookId', 'mitigationActionTaken'] as const;

const docTable = <K extends 'channels' | 'escalationPolicies' | 'maintenanceWindows' | 'runbooks' | 'deployments' | 'backups'>(table: string, prop: K): TableDef<unknown> => ({
  table, key: ['id'], columns: ['id', 'data'],
  rows: d => (d[prop] as Array<{ id: string }>).map(x => ({ k: x.id, values: [x.id, JSON.stringify(x)] })),
  load: (rows, d) => { (d[prop] as unknown[]) = rows.map(r => r.data); },
});

const TABLES: TableDef<unknown>[] = [
  {
    table: 'users', key: ['id'],
    columns: ['id', 'email', 'full_name', 'display_name', 'role_name', 'is_active', 'is_on_call', 'password_hash', 'token_version', 'created_at', 'last_login_at'],
    rows: d => d.users.map(u => ({ k: u.id, values: [u.id, u.email, u.fullName, u.displayName ?? null, u.roleName, u.isActive, u.isOnCall, u.passwordHash, u.tokenVersion, isoOrNull(u.createdAt), isoOrNull(u.lastLoginAt ?? null)] })),
    load: (rows, d) => {
      d.users = rows.map(r => ({
        id: r.id as string, email: r.email as string, fullName: r.full_name as string, displayName: (r.display_name as string) ?? undefined,
        roleName: r.role_name as UserRecord['roleName'], isActive: r.is_active as boolean, isOnCall: r.is_on_call as boolean,
        passwordHash: r.password_hash as string, tokenVersion: r.token_version as number,
        createdAt: r.created_at ? iso(r.created_at) : undefined, lastLoginAt: r.last_login_at ? iso(r.last_login_at) : null,
      }));
    },
  },
  {
    table: 'refresh_tokens', key: ['id'], columns: ['id', 'user_id', 'expires_at'],
    rows: d => d.refreshTokens.map(t => ({ k: t.id, values: [t.id, t.userId, t.expiresAt] })),
    load: (rows, d) => { d.refreshTokens = rows.map(r => ({ id: r.id as string, userId: r.user_id as string, expiresAt: Number(r.expires_at) })); },
  },
  {
    table: 'servers', key: ['id'],
    columns: ['id', 'hostname', 'ip', 'environment', 'application_id', 'provider', 'region', 'plan_name', 'plan_cpu_cores', 'plan_ram_gb', 'plan_disk_gb', 'plan_source', 'notes', 'agent_token', 'hostinger_vm_id', 'hostinger_state', 'created_at', 'state'],
    rows: d => d.servers.map(s => ({
      k: s.id,
      values: [s.id, s.hostname, s.ip, s.environment, uuidOrNull(s.applicationId), s.provider ?? '', s.region ?? '', s.plan ?? '',
        s.planSpec?.cpuCores ?? null, s.planSpec?.ramGb ?? null, s.planSpec?.diskGb ?? null, s.planSpec?.source ?? null,
        s.notes ?? '', s.agentToken, s.hostingerVmId ?? null, s.hostingerState ?? null, s.createdAt || new Date().toISOString(),
        JSON.stringify(omit(s, SERVER_CONFIG_KEYS))],
    })),
    load: (rows, d) => {
      d.servers = rows.map(r => {
        const cpu = num(r.plan_cpu_cores), ram = num(r.plan_ram_gb), disk = num(r.plan_disk_gb);
        return {
          ...(r.state as object),
          id: r.id as string, hostname: r.hostname as string, ip: r.ip as string, environment: r.environment as 'PRD' | 'DR',
          applicationId: (r.application_id as string) ?? '', provider: r.provider as string, region: r.region as string, plan: r.plan_name as string,
          planSpec: cpu && ram && disk ? { name: r.plan_name as string, cpuCores: cpu, ramGb: ram, diskGb: disk, source: (r.plan_source as 'manual' | 'config' | 'hostinger') ?? 'manual' } : undefined,
          notes: r.notes as string, agentToken: r.agent_token as string,
          hostingerVmId: r.hostinger_vm_id === null ? undefined : Number(r.hostinger_vm_id), hostingerState: (r.hostinger_state as string) ?? undefined,
          createdAt: iso(r.created_at),
        } as ServerRecord;
      });
    },
  },
  {
    table: 'applications', key: ['id'],
    columns: ['id', 'name', 'code_name', 'description', 'tier', 'rto_target_min', 'rpo_target_min', 'prd_server_id', 'dr_server_id', 'prd_url', 'dr_url',
      'cloudflare_zone', 'dns_record_name', 'auto_failover', 'failover_state', 'last_failover_at', 'hc_expected_status', 'hc_interval_sec', 'hc_timeout_sec', 'hc_ssl_monitoring', 'state'],
    rows: d => d.applications.map(a => ({
      k: a.id,
      values: [a.id, a.name, a.codeName, a.description ?? '', a.tier, a.rtoTargetMin, a.rpoTargetMin, uuidOrNull(a.prdServerId), uuidOrNull(a.drServerId),
        a.prdUrl || null, a.drUrl || null, a.cloudflareZone ?? '', a.dnsRecordName || null, Boolean(a.autoFailover), a.failoverState, isoOrNull(a.lastFailoverAt),
        a.healthCheck?.expectedStatus ?? null, a.healthCheck?.intervalSec ?? 30, a.healthCheck?.timeoutSec ?? 15, a.healthCheck?.sslMonitoring ?? true,
        JSON.stringify(omit(a, APP_CONFIG_KEYS))],
    })),
    load: (rows, d) => {
      d.applications = rows.map(r => ({
        ...(r.state as object),
        id: r.id as string, name: r.name as string, codeName: r.code_name as string, description: r.description as string,
        tier: r.tier as Application['tier'], rtoTargetMin: r.rto_target_min as number, rpoTargetMin: r.rpo_target_min as number,
        prdServerId: (r.prd_server_id as string) ?? '', drServerId: (r.dr_server_id as string) ?? '',
        prdUrl: (r.prd_url as string) ?? undefined, drUrl: (r.dr_url as string) ?? undefined,
        cloudflareZone: r.cloudflare_zone as string, dnsRecordName: (r.dns_record_name as string) ?? undefined,
        autoFailover: r.auto_failover as boolean, failoverState: r.failover_state as Application['failoverState'],
        lastFailoverAt: r.last_failover_at ? iso(r.last_failover_at) : undefined,
        healthCheck: { expectedStatus: num(r.hc_expected_status), intervalSec: r.hc_interval_sec as number, timeoutSec: r.hc_timeout_sec as number, sslMonitoring: r.hc_ssl_monitoring as boolean },
      }) as Application);
    },
  },
  {
    table: 'application_load_balancers', key: ['application_id'], columns: ['application_id', 'account_id', 'hostname', 'prd_pool_id', 'dr_pool_id'],
    rows: d => d.applications.filter(a => a.loadBalancer).map(a => ({ k: a.id, values: [a.id, a.loadBalancer!.accountId, a.loadBalancer!.hostname, a.loadBalancer!.prdPoolId, a.loadBalancer!.drPoolId] })),
    // Loaded after applications (TABLES order) and attached to them
    load: (rows, d) => {
      for (const r of rows) {
        const app = d.applications.find(a => a.id === r.application_id);
        if (app) app.loadBalancer = { accountId: r.account_id as string, hostname: r.hostname as string, prdPoolId: r.prd_pool_id as string, drPoolId: r.dr_pool_id as string };
      }
    },
  },
  {
    table: 'application_environments', key: ['application_id', 'environment'],
    columns: ['application_id', 'environment', 'app_port', 'health_path', 'web_server', 'process_manager', 'routing', 'db_engine', 'db_name', 'db_port', 'replication_max_lag_sec', 'backup_max_age_hours', 'notes'],
    rows: d => d.applications.flatMap(a => (['PRD', 'DR'] as const).filter(env => a.environments?.[env]).map(env => {
      const e = a.environments![env]!;
      return { k: `${a.id}|${env}`, values: [a.id, env, e.appPort, e.healthPath, e.webServer, e.processManager, e.routing, e.dbEngine, e.dbName, e.dbPort, e.replicationMaxLagSec, e.backupMaxAgeHours, e.notes ?? ''] };
    })),
    // Loaded after applications (TABLES order) and attached to them
    load: (rows, d) => {
      for (const r of rows) {
        const app = d.applications.find(a => a.id === r.application_id);
        if (!app) continue;
        (app.environments ??= {})[r.environment as 'PRD' | 'DR'] = {
          appPort: num(r.app_port), healthPath: (r.health_path as string) ?? null, webServer: (r.web_server as string) ?? null,
          processManager: (r.process_manager as string) ?? null, routing: (r.routing as string) ?? null,
          dbEngine: (r.db_engine as 'mysql' | 'mariadb' | 'postgresql') ?? null, dbName: (r.db_name as string) ?? null, dbPort: num(r.db_port),
          replicationMaxLagSec: num(r.replication_max_lag_sec), backupMaxAgeHours: num(r.backup_max_age_hours), notes: (r.notes as string) ?? '',
        };
      }
    },
  },
  {
    table: 'monitors', key: ['id'],
    columns: ['id', 'application_id', 'server_id', 'name', 'type', 'target', 'environment', 'interval_sec', 'timeout_sec', 'retries', 'warning_threshold_ms', 'critical_threshold_ms',
      'failure_confirmation', 'recovery_confirmation', 'expected_status_code', 'expected_body_contains', 'enabled', 'runbook_id', 'heartbeat_token', 'managed_by', 'state'],
    rows: d => d.monitors.map(m => ({
      k: m.id,
      values: [m.id, uuidOrNull(m.applicationId), uuidOrNull(m.serverId), m.name, m.type, m.target, m.environment, m.intervalSec, m.timeoutSec, m.retries,
        m.warningThresholdMs, m.criticalThresholdMs, m.failureConfirmationThreshold, m.recoveryConfirmationThreshold, m.expectedStatusCode ?? null,
        m.expectedBodyContains ?? null, m.enabled, m.runbookId ?? null, m.heartbeatToken ?? null, m.managedBy ?? null, JSON.stringify(omit(m, MONITOR_CONFIG_KEYS))],
    })),
    load: (rows, d) => {
      d.monitors = rows.map(r => ({
        ...(r.state as object),
        id: r.id as string, applicationId: (r.application_id as string) ?? '', serverId: (r.server_id as string) ?? undefined,
        name: r.name as string, type: r.type as Monitor['type'], target: r.target as string, environment: r.environment as 'PRD' | 'DR',
        intervalSec: r.interval_sec as number, timeoutSec: r.timeout_sec as number, retries: r.retries as number,
        warningThresholdMs: r.warning_threshold_ms as number, criticalThresholdMs: r.critical_threshold_ms as number,
        failureConfirmationThreshold: r.failure_confirmation as number, recoveryConfirmationThreshold: r.recovery_confirmation as number,
        expectedStatusCode: (r.expected_status_code as number) ?? undefined, expectedBodyContains: (r.expected_body_contains as string) ?? undefined,
        enabled: r.enabled as boolean, runbookId: (r.runbook_id as string) ?? undefined, heartbeatToken: (r.heartbeat_token as string) ?? undefined,
        managedBy: (r.managed_by as Monitor['managedBy']) ?? undefined,
      }) as Monitor);
    },
  },
  {
    table: 'monitor_buckets', key: ['monitor_id', 'hour'], columns: ['monitor_id', 'hour', 'total', 'ok', 'lat_sum'],
    rows: d => Object.entries(d.monitorBuckets).flatMap(([id, list]) => list.map(b => ({ k: `${id}|${b.h}`, values: [id, b.h, b.total, b.ok, b.latSum] }))),
    load: (rows, d) => {
      d.monitorBuckets = {};
      for (const r of rows) (d.monitorBuckets[r.monitor_id as string] ??= []).push({ h: r.hour as number, total: r.total as number, ok: r.ok as number, latSum: Number(r.lat_sum) });
      for (const list of Object.values(d.monitorBuckets)) list.sort((a, b) => a.h - b.h);
    },
  },
  {
    table: 'incidents', key: ['id'],
    columns: ['id', 'title', 'severity', 'status', 'application_id', 'environment', 'fingerprint', 'root_cause', 'started_at', 'resolved_at', 'duration_minutes', 'owner',
      'acknowledged', 'acknowledged_at', 'acknowledged_by', 'recovery_status', 'runbook_id', 'mitigation', 'details'],
    rows: d => d.incidents.map(i => ({
      k: i.id,
      values: [i.id, i.title, i.severity, i.status, i.applicationId ?? '', i.environment, i.fingerprint, i.rootCause ?? '', i.startedAt, isoOrNull(i.resolvedAt),
        i.durationMinutes ?? 0, i.owner ?? '', i.acknowledged, isoOrNull(i.acknowledgedAt), i.acknowledgedBy ?? null, i.recoveryStatus ?? '', i.runbookId ?? null,
        i.mitigationActionTaken ?? null, JSON.stringify(omit(i, INCIDENT_COLUMN_KEYS))],
    })),
    load: (rows, d) => {
      d.incidents = rows.map(r => ({
        ...(r.details as object),
        id: r.id as string, title: r.title as string, severity: r.severity as Incident['severity'], status: r.status as Incident['status'],
        applicationId: r.application_id as string, environment: r.environment as 'PRD' | 'DR', fingerprint: r.fingerprint as string, rootCause: r.root_cause as string,
        startedAt: iso(r.started_at), resolvedAt: r.resolved_at ? iso(r.resolved_at) : undefined, durationMinutes: r.duration_minutes as number, owner: r.owner as string,
        acknowledged: r.acknowledged as boolean, acknowledgedAt: r.acknowledged_at ? iso(r.acknowledged_at) : undefined, acknowledgedBy: (r.acknowledged_by as string) ?? undefined,
        recoveryStatus: r.recovery_status as string, runbookId: (r.runbook_id as string) ?? undefined, mitigationActionTaken: (r.mitigation as string) ?? undefined,
      }) as Incident).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },
  },
  {
    table: 'audit_logs', key: ['id'], columns: ['id', 'ts', 'operator', 'action', 'category', 'target_id', 'details'],
    rows: d => d.auditLogs.map(a => ({ k: a.id, values: [a.id, a.timestamp, a.operator, a.action, a.category, a.targetId ?? '', a.details ?? ''] })),
    load: (rows, d) => {
      d.auditLogs = rows.map(r => ({ id: r.id as string, timestamp: iso(r.ts), operator: r.operator as string, action: r.action as string, category: r.category as AuditLog['category'], targetId: r.target_id as string, details: r.details as string }))
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    },
  },
  docTable('channels', 'channels'),
  docTable('escalation_policies', 'escalationPolicies'),
  docTable('maintenance_windows', 'maintenanceWindows'),
  docTable('runbooks', 'runbooks'),
  docTable('deployments', 'deployments'),
  docTable('backups', 'backups'),
  {
    table: 'meta', key: ['key'], columns: ['key', 'value'],
    rows: d => [{ k: 'incident_seq', values: ['incident_seq', String(d.incidentSeq)] }, ...[...metaExtra].map(([k, v]) => ({ k, values: [k, v] }))],
    load: (rows, d) => {
      for (const r of rows) {
        if (r.key === 'incident_seq') d.incidentSeq = Number(r.value) || 1000;
        else metaExtra.set(r.key as string, r.value as string);
      }
    },
  },
];

/** Other key/value metadata (e.g. migration markers) */
const metaExtra = new Map<string, string>();

// ─────────────────────────────────────────────────────────────────────────────
// Diff-based write-back
// ─────────────────────────────────────────────────────────────────────────────
const lastHashes = new Map<string, Map<string, string>>();

function snapshot(def: TableDef<unknown>) {
  const out = new Map<string, { values: unknown[]; hash: string }>();
  for (const r of def.rows(db)) out.set(r.k, { values: r.values, hash: JSON.stringify(r.values) });
  return out;
}

async function upsert(c: pg.PoolClient, def: TableDef<unknown>, rows: unknown[][]) {
  const nonKey = def.columns.filter(col => !def.key.includes(col));
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const params: unknown[] = [];
    const tuples = batch.map(vals => `(${vals.map(v => { params.push(v); return `$${params.length}`; }).join(',')})`);
    await c.query(
      `INSERT INTO ${T(def.table)} (${def.columns.join(',')}) VALUES ${tuples.join(',')}
       ON CONFLICT (${def.key.join(',')}) DO ${nonKey.length ? `UPDATE SET ${nonKey.map(col => `${col}=EXCLUDED.${col}`).join(',')}` : 'NOTHING'}`,
      params,
    );
  }
}

async function remove(c: pg.PoolClient, def: TableDef<unknown>, keys: string[]) {
  for (let i = 0; i < keys.length; i += 500) {
    const batch = keys.slice(i, i + 500).map(k => (def.key.length > 1 ? k.split('|') : [k]));
    const params: unknown[] = [];
    const tuples = batch.map(parts => `(${parts.map((p, idx) => { params.push(def.key[idx] === 'hour' ? Number(p) : p); return `$${params.length}`; }).join(',')})`);
    await c.query(`DELETE FROM ${T(def.table)} WHERE (${def.key.join(',')}) IN (${tuples.join(',')})`, params);
  }
}

let dirty = false;
let saveTimer: NodeJS.Timeout | null = null;
let flushing: Promise<void> | null = null;
let ready = false;

export function persist() {
  dirty = true;
  if (saveTimer || !ready) return;
  saveTimer = setTimeout(() => { saveTimer = null; void flush(); }, 1000);
}

let lastFlushOk = true;

/** Writes all changed rows to PostgreSQL. Safe to call concurrently. Resolves to false if the write failed. */
export async function flush(): Promise<boolean> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (flushing) { await flushing; if (!dirty) return lastFlushOk; }
  if (!dirty || !ready) return lastFlushOk;
  dirty = false;
  const snaps = TABLES.map(def => ({ def, snap: snapshot(def) }));
  flushing = (async () => {
    try {
      await withTransaction(async c => {
        for (const { def, snap } of snaps) {
          const prev = lastHashes.get(def.table) ?? new Map();
          const changed = [...snap.entries()].filter(([k, v]) => prev.get(k) !== v.hash).map(([, v]) => v.values);
          const removed = [...prev.keys()].filter(k => !snap.has(k));
          if (removed.length) await remove(c, def, removed);
          if (changed.length) await upsert(c, def, changed);
        }
      });
      for (const { def, snap } of snaps) lastHashes.set(def.table, new Map([...snap].map(([k, v]) => [k, v.hash])));
      lastFlushOk = true;
    } catch (err) {
      dirty = true;
      lastFlushOk = false;
      log.error('store', `Failed to save to PostgreSQL: ${(err as Error).message}`);
      if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; void flush(); }, 5000);
    } finally {
      flushing = null;
    }
  })();
  await flushing;
  return lastFlushOk;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics (1-minute rollups)
// ─────────────────────────────────────────────────────────────────────────────
const metricQueue: Array<[string, ServerMetricPoint]> = [];

export function queueMetric(serverId: string, p: ServerMetricPoint) { metricQueue.push([serverId, p]); }

export async function flushMetrics(): Promise<void> {
  if (!ready || metricQueue.length === 0) return;
  const batch = metricQueue.splice(0, metricQueue.length);
  try {
    for (let i = 0; i < batch.length; i += 200) {
      const params: unknown[] = [];
      const tuples = batch.slice(i, i + 200).map(([id, p]) => {
        params.push(id, p.t, p.cpu, p.ram, p.disk, p.load1, p.netIn, p.netOut,
          p.swap ?? null, p.iowait ?? null, p.steal ?? null, p.diskRead ?? null, p.diskWrite ?? null, p.diskUtil ?? null);
        const n = params.length;
        return `(${Array.from({ length: 14 }, (_, k) => `${n - 13 + k}`).join(',')})`;
      });
      await query(`INSERT INTO ${T('server_metrics')} (server_id,t,cpu,ram,disk,load1,net_in,net_out,swap,iowait,steal,disk_read,disk_write,disk_util) VALUES ${tuples.join(',')} ON CONFLICT DO NOTHING`, params);
    }
  } catch (err) {
    metricQueue.unshift(...batch);
    log.error('store', `Failed to save metrics: ${(err as Error).message}`);
  }
}

export async function deleteServerMetrics(serverId: string) {
  delete liveMetrics[serverId];
  delete minuteMetrics[serverId];
  await query(`DELETE FROM ${T('server_metrics')} WHERE server_id = $1`, [serverId]).catch(err => log.error('store', `${(err as Error).message}`));
}

// ─────────────────────────────────────────────────────────────────────────────
// Startup: migrate, import legacy JSON once, load
// ─────────────────────────────────────────────────────────────────────────────
const LEGACY_STORE = path.join(DATA_DIR, 'ops-store.json');
const LEGACY_METRICS = path.join(DATA_DIR, 'metrics.json');
const LEGACY_CHECKS = path.join(DATA_DIR, 'checks');

async function tableIsEmpty(table: string) {
  return (await query(`SELECT 1 FROM ${T(table)} LIMIT 1`)).rowCount === 0;
}

/**
 * One-time import of the previous JSON file store (DATA_DIR/ops-store.json, metrics.json, checks/*.jsonl).
 * Runs only when PostgreSQL has no users, servers or applications yet. The JSON files are renamed
 * afterwards so they are clearly no longer used.
 */
async function importLegacyJson(): Promise<string | null> {
  if (metaExtra.has('legacy_json_imported') || !fs.existsSync(LEGACY_STORE)) return null;
  if (!(await tableIsEmpty('users')) || !(await tableIsEmpty('servers')) || !(await tableIsEmpty('applications'))) return null;
  const legacy = JSON.parse(fs.readFileSync(LEGACY_STORE, 'utf8')) as Partial<StoreData>;
  Object.assign(db, emptyStore(), legacy);
  // Applications created by the old ICT bootstrap carried URL monitors: mark them as managed by the app URLs
  for (const m of db.monitors) {
    const app = db.applications.find(a => a.id === m.applicationId);
    if (!app || m.managedBy) continue;
    const url = m.environment === 'PRD' ? app.prdUrl : app.drUrl;
    if (!url) continue;
    if (m.target === url && ['HTTP', 'HTTPS'].includes(m.type)) m.managedBy = 'app-url';
    try { if (m.type === 'SSL' && m.target === new URL(url).hostname) m.managedBy = 'app-ssl'; } catch { /* invalid URL: leave unmanaged */ }
  }
  // Drop dangling references so foreign keys hold
  const appIds = new Set(db.applications.map(a => a.id));
  const srvIds = new Set(db.servers.map(s => s.id));
  for (const m of db.monitors) {
    if (m.applicationId && !appIds.has(m.applicationId)) m.applicationId = '';
    if (m.serverId && !srvIds.has(m.serverId)) m.serverId = undefined;
  }
  for (const a of db.applications) {
    if (a.prdServerId && !srvIds.has(a.prdServerId)) a.prdServerId = '';
    if (a.drServerId && !srvIds.has(a.drServerId)) a.drServerId = '';
  }
  const userIds = new Set(db.users.map(u => u.id));
  db.refreshTokens = db.refreshTokens.filter(t => userIds.has(t.userId));
  for (const app of db.applications) {
    app.healthCheck ??= { expectedStatus: db.monitors.find(m => m.applicationId === app.id && m.managedBy === 'app-url')?.expectedStatusCode ?? null, intervalSec: 30, timeoutSec: 15, sslMonitoring: true };
  }
  metaExtra.set('legacy_json_imported', new Date().toISOString());
  dirty = true;
  ready = true;
  await flush();

  let checks = 0;
  if (fs.existsSync(LEGACY_CHECKS)) {
    for (const f of fs.readdirSync(LEGACY_CHECKS).filter(x => x.endsWith('.jsonl'))) {
      const recs = fs.readFileSync(path.join(LEGACY_CHECKS, f), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) as CheckRecord; } catch { return null; } }).filter((r): r is CheckRecord => Boolean(r));
      for (let i = 0; i < recs.length; i += 200) {
        const params: unknown[] = [];
        const tuples = recs.slice(i, i + 200).map(r => {
          params.push(r.t, r.monitorId, r.applicationId ?? '', r.environment, r.target, r.ok, r.probeStatus, r.statusCode, r.latencyMs, r.reason ?? '');
          const n = params.length;
          return `(${Array.from({ length: 10 }, (_, k) => `$${n - 9 + k}`).join(',')})`;
        });
        await query(`INSERT INTO ${T('check_results')} (t,monitor_id,application_id,environment,target,ok,probe_status,status_code,latency_ms,reason) VALUES ${tuples.join(',')}`, params);
      }
      checks += recs.length;
    }
  }
  let metricPoints = 0;
  if (fs.existsSync(LEGACY_METRICS)) {
    const m = JSON.parse(fs.readFileSync(LEGACY_METRICS, 'utf8')) as Record<string, ServerMetricPoint[]>;
    for (const [id, pts] of Object.entries(m)) for (const p of pts) { queueMetric(id, p); metricPoints++; }
    await flushMetrics();
  }
  const suffix = `.imported-to-postgres-${new Date().toISOString().slice(0, 10)}`;
  for (const p of [LEGACY_STORE, LEGACY_METRICS, LEGACY_CHECKS]) if (fs.existsSync(p)) fs.renameSync(p, p + suffix);
  return `${db.servers.length} server(s), ${db.applications.length} application(s), ${db.monitors.length} monitor(s), ${db.incidents.length} incident(s), ${db.auditLogs.length} audit entr(ies), ${checks} check record(s), ${metricPoints} metric point(s)`;
}

async function loadAll() {
  const fresh = emptyStore();
  for (const def of TABLES) {
    const res = await query(`SELECT * FROM ${T(def.table)}`);
    def.load(res.rows, fresh);
  }
  Object.assign(db, fresh);
  for (const def of TABLES) lastHashes.set(def.table, new Map([...snapshot(def)].map(([k, v]) => [k, v.hash])));
  const since = new Date(Date.now() - config.metricsRetentionHours * 3600 * 1000).toISOString();
  const m = await query(`SELECT server_id, t, cpu, ram, disk, load1, net_in, net_out, swap, iowait, steal, disk_read, disk_write, disk_util FROM ${T('server_metrics')} WHERE t >= $1 ORDER BY t`, [since]);
  for (const k of Object.keys(minuteMetrics)) delete minuteMetrics[k];
  const opt = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  for (const r of m.rows) {
    (minuteMetrics[r.server_id as string] ??= []).push({
      t: iso(r.t), cpu: Number(r.cpu), ram: Number(r.ram), disk: Number(r.disk), load1: Number(r.load1), netIn: Number(r.net_in), netOut: Number(r.net_out),
      swap: opt(r.swap), iowait: opt(r.iowait), steal: opt(r.steal), diskRead: opt(r.disk_read), diskWrite: opt(r.disk_write), diskUtil: opt(r.disk_util),
    });
  }
}

export async function initStore(): Promise<{ migrations: string[]; imported: string | null }> {
  const migrations = await migrate();
  // Load meta first so the import marker is known
  for (const r of (await query(`SELECT key, value FROM ${T('meta')}`)).rows) if (r.key !== 'incident_seq') metaExtra.set(r.key, r.value);
  const imported = await importLegacyJson();
  await loadAll();
  ready = true;
  setInterval(() => { void flushMetrics(); }, 10_000).unref();
  setInterval(() => {
    const cutoff = new Date(Date.now() - config.metricsRetentionHours * 3600 * 1000).toISOString();
    void query(`DELETE FROM ${T('server_metrics')} WHERE t < $1`, [cutoff]).catch(() => {});
  }, 3600_000).unref();
  return { migrations, imported };
}

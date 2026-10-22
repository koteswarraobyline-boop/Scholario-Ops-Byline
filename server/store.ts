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
  RegistryComponent, DependencyLink, ProviderConnectionRecord, ProviderInstanceRecord, ResourceLimit, WorkerRoutingEvent,
} from '../src/types/index.ts';
import { normalizeRouting } from '../src/lib/trafficHealth.ts';
import { DATA_DIR, config } from './config.ts';
import { query, withTransaction, migrate, T } from './db.ts';
import { log, scrub } from './logger.ts';
import { sealSecret, openSecret, isSealed, noteEncryptedData, keyFingerprint, setKeyFingerprintMismatch } from './secrets.ts';
import { registryNameCollisions, registryNameKey } from './registryName.ts';

/**
 * Encrypts for storage. Without a usable key (lost key file) the value is written exactly as it is
 * in memory: stored ciphertext stays ciphertext, and nothing new can arrive in plaintext because
 * channel saves are refused while the key is missing (routes).
 */
let sealWarned = false;
function sealOrKeep(v: string): string {
  try { return sealSecret(v); } catch (err) {
    if (!sealWarned) { sealWarned = true; log.error('secrets', `channel secrets cannot be encrypted: ${(err as Error).message}`); }
    return v;
  }
}

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
  registry: RegistryComponent[];
  dependencyLinks: DependencyLink[];
  providerConnections: ProviderConnectionRecord[];
  providerInstances: ProviderInstanceRecord[];
  resources: ResourceLimit[];
  workerEvents: WorkerRoutingEvent[];
}

function emptyStore(): StoreData {
  return {
    version: 1, servers: [], applications: [], monitors: [], monitorBuckets: {}, incidents: [], incidentSeq: 1000,
    auditLogs: [], users: [], refreshTokens: [], channels: [], escalationPolicies: [], maintenanceWindows: [],
    runbooks: [], deployments: [], backups: [], registry: [], dependencyLinks: [],
    providerConnections: [], providerInstances: [], resources: [], workerEvents: [],
  };
}

/** In-memory working set. Populated by initStore(); empty until then. */
export const db: StoreData = emptyStore();

/** Keeps the newest AUDIT_RETENTION_ENTRIES rows in memory (default 5000). Newest first. */
export function applyAuditRetention(): boolean {
  if (db.auditLogs.length <= config.auditRetention) return false;
  db.auditLogs.length = config.auditRetention;
  return true;
}

/** Deletes audit rows beyond AUDIT_RETENTION_ENTRIES in PostgreSQL. Returns how many rows were removed. */
export async function pruneAuditLog(): Promise<number> {
  const res = await query(
    `DELETE FROM ${T('audit_logs')} WHERE id IN (SELECT id FROM ${T('audit_logs')} ORDER BY ts DESC, id DESC OFFSET $1)`,
    [config.auditRetention],
  );
  return res.rowCount ?? 0;
}

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
  /** Keys of loaded rows whose stored form differs from what rows() writes; rewritten with the next save */
  stale?: (rows: Row[]) => string[];
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : '');
const isoOrNull = (s: string | null | undefined) => (s ? s : null);
const uuidOrNull = (s: string | null | undefined) => (s ? s : null);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const omit = <O extends object>(o: O, keys: readonly string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

const SERVER_CONFIG_KEYS = ['id', 'hostname', 'ip', 'environment', 'applicationId', 'provider', 'region', 'plan', 'planSpec', 'notes', 'agentToken', 'hostingerVmId', 'hostingerState', 'createdAt'] as const;
const APP_CONFIG_KEYS = ['id', 'name', 'codeName', 'description', 'tier', 'rtoTargetMin', 'rpoTargetMin', 'prdServerId', 'drServerId', 'prdUrl', 'drUrl', 'cloudflareZone', 'dnsRecordName', 'autoFailover', 'failoverState', 'lastFailoverAt', 'healthCheck', 'loadBalancer', 'environments', 'trafficRouting'] as const;
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
    table: 'application_routing', key: ['application_id'],
    columns: ['application_id', 'method', 'direct', 'worker', 'custom'],
    rows: d => d.applications.map(a => {
      const cfg = normalizeRouting(a);
      return { k: a.id, values: [a.id, cfg.method, JSON.stringify(cfg.direct), JSON.stringify(cfg.worker), JSON.stringify(cfg.custom)] };
    }),
    load: (rows, d) => {
      const obj = <T>(v: unknown): Partial<T> => {
        if (!v) return {};
        if (typeof v === 'string') { try { return JSON.parse(v) as Partial<T>; } catch { return {}; } }
        return typeof v === 'object' ? v as Partial<T> : {};
      };
      for (const r of rows) {
        const app = d.applications.find(a => a.id === r.application_id);
        if (!app) continue;
        app.trafficRouting = normalizeRouting({
          loadBalancer: app.loadBalancer,
          trafficRouting: {
            method: r.method as import('../src/types/index.ts').TrafficRoutingMethod,
            direct: obj(r.direct) as import('../src/types/index.ts').TrafficRoutingConfig['direct'],
            worker: obj(r.worker) as import('../src/types/index.ts').TrafficRoutingConfig['worker'],
            custom: obj(r.custom) as import('../src/types/index.ts').TrafficRoutingConfig['custom'],
          },
        });
      }
    },
  },
  {
    table: 'worker_events', key: ['id'],
    columns: ['id', 'application_id', 'kind', 'origin', 'prd_health', 'dr_health', 'detail', 'observed_at', 'received_at'],
    rows: d => d.workerEvents.map(e => ({
      k: e.id,
      values: [e.id, e.applicationId, e.kind, e.origin, e.prdHealth, e.drHealth, e.detail, e.observedAt, e.receivedAt],
    })),
    load: (rows, d) => {
      d.workerEvents = rows.map(r => ({
        id: r.id as string,
        applicationId: r.application_id as string,
        kind: r.kind as WorkerRoutingEvent['kind'],
        origin: (r.origin as string) ?? null,
        prdHealth: (r.prd_health as WorkerRoutingEvent['prdHealth']) ?? null,
        drHealth: (r.dr_health as WorkerRoutingEvent['drHealth']) ?? null,
        detail: (r.detail as string) ?? '',
        observedAt: iso(r.observed_at),
        receivedAt: iso(r.received_at),
        source: 'worker_event' as const,
      })).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
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
  // Channel targets (webhook URLs, PagerDuty keys, recipients) are encrypted at rest (server/secrets.ts)
  {
    table: 'channels', key: ['id'], columns: ['id', 'data'],
    rows: d => d.channels.map(c => ({ k: c.id, values: [c.id, JSON.stringify({ ...c, targetEndpoint: sealOrKeep(c.targetEndpoint) })] })),
    load: (rows, d) => {
      const list = rows.map(r => r.data as CommunicationChannel);
      if (list.some(c => isSealed(c.targetEndpoint))) noteEncryptedData(); // a missing key is then a lost key
      d.channels = list.map(c => ({ ...c, targetEndpoint: openSecret(c.targetEndpoint) }));
    },
  },
  docTable('escalation_policies', 'escalationPolicies'),
  docTable('maintenance_windows', 'maintenanceWindows'),
  docTable('runbooks', 'runbooks'),
  docTable('deployments', 'deployments'),
  docTable('backups', 'backups'),
  // Links before components: removed links must be gone before a component delete lets
  // PostgreSQL null their feature_id, which could otherwise collide with a remaining link
  {
    table: 'dependency_links', key: ['id'], columns: ['id', 'from_id', 'to_id', 'link_type', 'feature_id', 'notes', 'created_at'],
    rows: d => d.dependencyLinks.map(l => ({ k: l.id, values: [l.id, l.fromId, l.toId, l.type, uuidOrNull(l.featureId), l.notes, l.createdAt] })),
    load: (rows, d) => {
      d.dependencyLinks = rows.map(r => ({
        id: r.id as string, fromId: r.from_id as string, toId: r.to_id as string, type: r.link_type as DependencyLink['type'],
        featureId: (r.feature_id as string) ?? null, notes: r.notes as string, createdAt: iso(r.created_at),
      })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
  },
  {
    table: 'registry_components', key: ['id'],
    columns: ['id', 'kind', 'name', 'name_key', 'owner', 'tier', 'description', 'application_id', 'server_id', 'user_count', 'served', 'created_at', 'updated_at'],
    rows: d => d.registry.map(c => ({
      k: c.id,
      values: [c.id, c.kind, c.name, registryNameKey(c.name), c.owner, c.tier, c.description, uuidOrNull(c.applicationId), uuidOrNull(c.serverId), c.userCount, JSON.stringify(c.served), c.createdAt, c.updatedAt],
    })),
    // e.g. keys backfilled by migration 008 with PostgreSQL's lower()
    stale: rows => rows.filter(r => r.name_key !== registryNameKey(r.name as string)).map(r => r.id as string),
    load: (rows, d) => {
      d.registry = rows.map(r => ({
        id: r.id as string, kind: r.kind as RegistryComponent['kind'], name: r.name as string, owner: r.owner as string, tier: r.tier as RegistryComponent['tier'],
        description: r.description as string, applicationId: (r.application_id as string) ?? null, serverId: (r.server_id as string) ?? null,
        userCount: num(r.user_count), served: (r.served as string[]) ?? [], createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
      })).sort((a, b) => a.name.localeCompare(b.name));
    },
  },
  {
    table: 'provider_connections', key: ['id'],
    columns: ['id', 'name', 'provider', 'token_env', 'sync_enabled', 'legacy', 'status', 'last_sync_at', 'last_success_at', 'last_error', 'created_at', 'updated_at'],
    rows: d => d.providerConnections.map(c => ({
      k: c.id,
      values: [c.id, c.name, c.provider, c.tokenEnv, c.syncEnabled, c.legacy, c.status, isoOrNull(c.lastSyncAt), isoOrNull(c.lastSuccessAt), c.lastError, c.createdAt, c.updatedAt],
    })),
    load: (rows, d) => {
      d.providerConnections = rows.map(r => ({
        id: r.id as string, name: r.name as string, provider: r.provider as ProviderConnectionRecord['provider'], tokenEnv: r.token_env as string,
        syncEnabled: r.sync_enabled as boolean, legacy: r.legacy as boolean, status: r.status as ProviderConnectionRecord['status'],
        lastSyncAt: r.last_sync_at ? iso(r.last_sync_at) : null, lastSuccessAt: r.last_success_at ? iso(r.last_success_at) : null,
        lastError: (r.last_error as string) ?? null, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
      }));
    },
  },
  {
    table: 'provider_instances', key: ['id'],
    columns: ['id', 'connection_id', 'provider_vm_id', 'hostname', 'ipv4', 'ipv6', 'os', 'region', 'plan', 'cpu', 'ram_gb', 'disk_gb', 'power_state', 'status', 'fetched_at', 'last_seen_at', 'absent'],
    rows: d => d.providerInstances.map(i => ({
      k: i.id,
      values: [i.id, i.connectionId, i.providerVmId, i.hostname, JSON.stringify(i.ipv4), JSON.stringify(i.ipv6), i.os, i.region, i.plan, i.cpu, i.ramGb, i.diskGb, i.powerState, i.status, isoOrNull(i.fetchedAt), isoOrNull(i.lastSeenAt), i.absent],
    })),
    load: (rows, d) => {
      const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
      d.providerInstances = rows.map(r => ({
        id: r.id as string, connectionId: r.connection_id as string, providerVmId: r.provider_vm_id as string,
        hostname: (r.hostname as string) ?? null, ipv4: list(r.ipv4), ipv6: list(r.ipv6), os: (r.os as string) ?? null,
        region: (r.region as string) ?? null, plan: (r.plan as string) ?? null, cpu: num(r.cpu), ramGb: num(r.ram_gb), diskGb: num(r.disk_gb),
        powerState: (r.power_state as string) ?? null, status: r.status as ProviderInstanceRecord['status'],
        fetchedAt: r.fetched_at ? iso(r.fetched_at) : null, lastSeenAt: r.last_seen_at ? iso(r.last_seen_at) : null, absent: r.absent as boolean,
      }));
    },
  },
  {
    table: 'resource_limits', key: ['id'],
    columns: ['id', 'resource_key', 'kind', 'name', 'description', 'owner', 'server_id', 'application_id', 'capacity', 'unlimited', 'usage', 'unit', 'source',
      'threshold_mode', 'warning_value', 'critical_value', 'hard_limit', 'recovery_margin', 'quota_window', 'measured_at', 'last_sync_at', 'freshness', 'sync_error',
      'enabled', 'alert_state', 'alert_since', 'managed_by', 'last_measurement_id', 'created_at', 'updated_at'],
    rows: d => d.resources.map(r => ({
      k: r.id,
      values: [r.id, r.resourceKey, r.kind, r.name, r.description, r.owner, uuidOrNull(r.serverId), uuidOrNull(r.applicationId), r.capacity, r.unlimited, r.usage, r.unit, r.source,
        r.thresholdMode, r.warningValue, r.criticalValue, r.hardLimit, r.recoveryMargin, r.quotaWindow, isoOrNull(r.measuredAt), isoOrNull(r.lastSyncAt), r.freshness, r.syncError,
        r.enabled, r.alertState, isoOrNull(r.alertSince), r.managedBy, r.lastMeasurementId, r.createdAt, r.updatedAt],
    })),
    load: (rows, d) => {
      d.resources = rows.map(r => ({
        id: r.id as string,
        resourceKey: r.resource_key as string,
        kind: r.kind as ResourceLimit['kind'],
        name: r.name as string,
        description: (r.description as string) ?? '',
        owner: r.owner as string,
        serverId: (r.server_id as string) ?? null,
        applicationId: (r.application_id as string) ?? null,
        capacity: num(r.capacity),
        unlimited: Boolean(r.unlimited),
        usage: num(r.usage),
        unit: r.unit as ResourceLimit['unit'],
        source: r.source as ResourceLimit['source'],
        thresholdMode: r.threshold_mode as ResourceLimit['thresholdMode'],
        warningValue: num(r.warning_value),
        criticalValue: num(r.critical_value),
        hardLimit: num(r.hard_limit),
        recoveryMargin: Number(r.recovery_margin),
        quotaWindow: (r.quota_window as ResourceLimit['quotaWindow']) ?? null,
        measuredAt: r.measured_at ? iso(r.measured_at) : null,
        lastSyncAt: r.last_sync_at ? iso(r.last_sync_at) : null,
        freshness: r.freshness as ResourceLimit['freshness'],
        syncError: (r.sync_error as string) ?? '',
        enabled: Boolean(r.enabled),
        alertState: r.alert_state as ResourceLimit['alertState'],
        alertSince: r.alert_since ? iso(r.alert_since) : null,
        managedBy: (r.managed_by as ResourceLimit['managedBy']) ?? null,
        lastMeasurementId: (r.last_measurement_id as string) ?? null,
        createdAt: iso(r.created_at),
        updatedAt: iso(r.updated_at),
      }));
    },
  },
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

const KEY_FP = 'notify_secrets_key_fp';
/**
 * Stores the secrets-key fingerprint once every channel target is readable with the current key.
 * While targets from another key remain, the old fingerprint is kept and the mismatch is reported.
 * Must not run inside a table's rows(): the startup baseline snapshot would then count a new
 * fingerprint as already stored, and it would never be written. Returns true when meta changed.
 */
function recordKeyFingerprint(channels: CommunicationChannel[]): boolean {
  const current = keyFingerprint();
  if (!current || !channels.some(c => c.targetEndpoint)) return false;
  const stored = metaExtra.get(KEY_FP);
  if (stored === current) { setKeyFingerprintMismatch(null); return false; }
  if (channels.some(c => isSealed(c.targetEndpoint))) {
    if (stored) setKeyFingerprintMismatch({ stored, current });
    return false;
  }
  metaExtra.set(KEY_FP, current);
  setKeyFingerprintMismatch(null);
  return true;
}

/** Startup check: a different key than the one the stored targets were written with. Returns true when meta changed. */
function checkKeyFingerprint(channels: CommunicationChannel[]): boolean {
  const stored = metaExtra.get(KEY_FP);
  const current = keyFingerprint();
  if (stored && current && stored !== current) {
    setKeyFingerprintMismatch({ stored, current });
    log.error('secrets', `the notification secrets key changed (fingerprint ${stored} → ${current}); stored channel targets were written with the previous key — restore it, or re-enter every channel target`);
  }
  return recordKeyFingerprint(channels);
}

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
  // Permanent and exhausted failures fail the same way again. Background changes call persist()
  // every few seconds, so they must not keep a timer running. The next explicit flush tries again.
  if (saveFailure?.kind === 'REJECTED') return;
  if (saveFailure?.kind === 'CONFLICT' && conflictAttempts >= saveRetry.conflictLimit) return;
  saveTimer = setTimeout(() => { saveTimer = null; void flush(); }, 1000);
}

let lastFlushOk = true;

/**
 * UNREACHABLE: the connection itself failed (refused, reset, shutdown, too many connections).
 *   Retried every few seconds until a save succeeds. The rows stay in memory.
 * CONFLICT: the database was reached but the transaction could not finish (lock timeout,
 *   deadlock, serialization, statement cancel). Retried a few times, then the timer stops.
 *   The rows stay in memory. The next explicit flush tries again.
 * REJECTED: PostgreSQL refused the data (constraint, invalid value, schema mismatch) or the save
 *   itself failed in code. Retrying cannot help, so there is no timer.
 */
export type SaveFailureKind = 'UNREACHABLE' | 'CONFLICT' | 'REJECTED';
export interface SaveFailure {
  kind: SaveFailureKind;
  /** SQLSTATE or Node error code */
  code: string | null;
  constraint: string | null;
  table: string | null;
  message: string;
  at: string;
}
/** The database process is going away or cannot accept a connection yet. Same recovery as a dropped connection. */
const SHUTDOWN_SQLSTATES = new Set(['57P01', '57P02', '57P03']);
/** Transaction conflicts. Bounded retries — a lock that is never released must not retry forever. */
const CONFLICT_SQLSTATES = new Set(['40001', '40P01', '55P03', '57014']);
/** Delays and the conflict retry budget. Tests may shorten the delays; production uses these defaults. */
export const saveRetry = {
  unreachableMs: 5_000,
  conflictMs: 5_000,
  /** Failed conflict attempts before the timer stops. An explicit flush still tries again. */
  conflictLimit: 3,
};

export function classifySaveError(err: unknown): SaveFailureKind {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && !code.startsWith('E')) {
    if (code.startsWith('08') || code.startsWith('53') || SHUTDOWN_SQLSTATES.has(code)) return 'UNREACHABLE';
    if (CONFLICT_SQLSTATES.has(code)) return 'CONFLICT';
    return 'REJECTED';
  }
  if (err instanceof TypeError || err instanceof RangeError || err instanceof ReferenceError || err instanceof SyntaxError) return 'REJECTED';
  // Node socket errors (ECONNREFUSED, ECONNRESET, ETIMEDOUT…), pool timeouts, "Connection terminated"
  return 'UNREACHABLE';
}

/** Loaded data cannot be saved safely. Startup stops instead of retrying, and nothing is written. */
export class StoreDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreDataError';
  }
}

let saveFailure: SaveFailure | null = null;
let saveAttempts = 0;
let conflictAttempts = 0;
let loggedFailure = '';
/** Test only. While set, every save transaction throws this after BEGIN and before any write, so the transaction rolls back. */
let injectedSaveError: unknown = null;

/** Test only: the next save transactions throw this until cleared with null. */
export function injectSaveErrorForTests(err: unknown): void {
  injectedSaveError = err;
}

function scrubSaveMessage(message: string): string {
  return scrub(message).replace(/\b(password|passwd|pwd)\s*[:=]\s*\S+/gi, '$1=[redacted]').slice(0, 300);
}

/** Outcome of the latest save to PostgreSQL. attempts counts every save transaction started. */
export function saveState(): { ok: boolean; attempts: number; failure: SaveFailure | null; conflictAttempts: number } {
  return { ok: saveFailure === null, attempts: saveAttempts, failure: saveFailure, conflictAttempts };
}

/** What /api/health reports for the latest save. Distinct from connection loss, a lock, and a rejected row. */
export function databaseSaveStatus(): 'OK' | 'RETRYING' | 'CONFLICT' | 'REJECTED' {
  if (!saveFailure) return 'OK';
  if (saveFailure.kind === 'REJECTED') return 'REJECTED';
  if (saveFailure.kind === 'CONFLICT') return 'CONFLICT';
  return 'RETRYING';
}

/** Response for a write whose flush did not commit. Never includes the database error text. */
export function saveFailureClient(): { status: number; code: string; message: string } | null {
  const failure = saveFailure;
  if (!failure) return null;
  if (failure.kind === 'REJECTED') {
    return {
      status: failure.code?.startsWith('23') ? 409 : 500,
      code: 'SAVE_REJECTED',
      message: `Not saved: PostgreSQL rejected the save${failure.constraint ? ` (constraint ${failure.constraint})` : ''}. Nothing from it was written to the database. `
        + 'Scholario Ops still shows the change, but it is lost on restart; correct or remove the conflicting entry — until then no further changes can be saved.',
    };
  }
  if (failure.kind === 'CONFLICT') {
    const stopped = conflictAttempts >= saveRetry.conflictLimit;
    return {
      status: 503,
      code: 'SAVE_CONFLICT',
      message: stopped
        ? `Not saved: PostgreSQL could not finish the transaction${failure.code ? ` (${failure.code})` : ''} (lock timeout, deadlock, or serialization). Nothing from it was written. The change is still only in memory. Automatic retry has stopped; the next save tries again.`
        : `Not saved: PostgreSQL could not finish the transaction${failure.code ? ` (${failure.code})` : ''} (lock timeout, deadlock, or serialization). Nothing from it was written. The change is still only in memory and will be tried again a few times.`,
    };
  }
  return {
    status: 503,
    code: 'SAVE_UNREACHABLE',
    message: 'The change was applied but is not in the database yet (PostgreSQL unreachable) — it is saved automatically when the database is back. Do not repeat it.',
  };
}

/** Writes all changed rows to PostgreSQL. Safe to call concurrently. Resolves to false if the write failed. */
export async function flush(): Promise<boolean> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  // Wait for every flush in progress (another caller may start a new one that includes our change)
  while (flushing) await flushing;
  if (!dirty || !ready) return lastFlushOk;
  dirty = false;
  recordKeyFingerprint(db.channels);
  const snaps = TABLES.map(def => ({ def, snap: snapshot(def) }));
  flushing = (async () => {
    saveAttempts++;
    try {
      await withTransaction(async c => {
        if (injectedSaveError) throw injectedSaveError;
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
      if (saveFailure) log.info('store', 'Saving to PostgreSQL works again; all pending changes are saved');
      saveFailure = null;
      conflictAttempts = 0;
      loggedFailure = '';
    } catch (err) {
      dirty = true;
      lastFlushOk = false;
      const e = err as { code?: unknown; constraint?: unknown; table?: unknown; message?: unknown; detail?: unknown };
      const kind = classifySaveError(err);
      if (kind === 'CONFLICT') conflictAttempts++;
      saveFailure = {
        kind,
        code: typeof e.code === 'string' ? e.code : null,
        constraint: typeof e.constraint === 'string' ? e.constraint : null,
        table: typeof e.table === 'string' ? e.table : null,
        message: scrubSaveMessage(String(e.message ?? err)),
        at: new Date().toISOString(),
      };
      const stopped = kind === 'CONFLICT' && conflictAttempts >= saveRetry.conflictLimit;
      // Once when a failure starts, and once when a conflict's automatic retries stop.
      const signature = `${kind}|${saveFailure.code}|${saveFailure.constraint}|${stopped ? 'stopped' : 'open'}`;
      if (signature !== loggedFailure) {
        loggedFailure = signature;
        const where = { code: saveFailure.code, constraint: saveFailure.constraint, table: saveFailure.table };
        if (kind === 'REJECTED') {
          log.error('store', `PostgreSQL rejected the save — nothing from it was written and it is not retried automatically: ${saveFailure.message}`, where);
        } else if (kind === 'CONFLICT') {
          log.error('store', stopped
            ? `PostgreSQL could not finish the save (${saveFailure.code ?? 'lock or serialization'}). Nothing was written. Automatic retry has stopped after ${conflictAttempts} attempts; the change is still only in memory and the next explicit save will try again.`
            : `PostgreSQL could not finish the save (${saveFailure.code ?? 'lock or serialization'}). Nothing was written. The change is still only in memory. Retry ${conflictAttempts} of ${saveRetry.conflictLimit}.`, where);
        } else {
          const every = saveRetry.unreachableMs >= 1000 ? `${Math.round(saveRetry.unreachableMs / 1000)}s` : `${saveRetry.unreachableMs}ms`;
          log.error('store', `PostgreSQL could not be reached — nothing was written. The change stays in memory and is retried every ${every}: ${saveFailure.message}`, { code: saveFailure.code });
        }
      }
      const retryMs = kind === 'UNREACHABLE' ? saveRetry.unreachableMs : kind === 'CONFLICT' && !stopped ? saveRetry.conflictMs : 0;
      if (retryMs > 0 && !saveTimer) saveTimer = setTimeout(() => { saveTimer = null; void flush(); }, retryMs);
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
  let written = 0;
  try {
    for (let i = 0; i < batch.length; i += 200) {
      const params: unknown[] = [];
      const tuples = batch.slice(i, i + 200).map(([id, p]) => {
        params.push(id, p.t, p.cpu, p.ram, p.disk, p.load1, p.netIn, p.netOut,
          p.swap ?? null, p.iowait ?? null, p.steal ?? null, p.diskRead ?? null, p.diskWrite ?? null, p.diskUtil ?? null);
        const n = params.length;
        return `(${Array.from({ length: 14 }, (_, k) => `$${n - 13 + k}`).join(',')})`;
      });
      await query(`INSERT INTO ${T('server_metrics')} (server_id,t,cpu,ram,disk,load1,net_in,net_out,swap,iowait,steal,disk_read,disk_write,disk_util) VALUES ${tuples.join(',')} ON CONFLICT DO NOTHING`, params);
      written = i + 200;
    }
  } catch (err) {
    // Re-queue only what was not written, bounded (1-minute rollups: 50k ≈ a day for 30 servers)
    const rest = batch.slice(written).concat(metricQueue.splice(0, metricQueue.length));
    metricQueue.push(...rest.slice(Math.max(0, rest.length - 50_000)));
    log.error('store', `Failed to save metrics: ${(err as Error).message}`);
  }
}

/** Deletes server metric rollups older than METRICS_RETENTION_HOURS (default 48). Returns how many rows were removed. */
export async function pruneServerMetrics(): Promise<number> {
  const cutoffMs = Date.now() - config.metricsRetentionHours * 3600 * 1000;
  const cutoff = new Date(cutoffMs).toISOString();
  for (const id of Object.keys(minuteMetrics)) {
    const series = minuteMetrics[id];
    let i = 0;
    while (i < series.length && Date.parse(series[i].t) < cutoffMs) i++;
    if (i > 0) minuteMetrics[id] = series.slice(i);
  }
  const res = await query(`DELETE FROM ${T('server_metrics')} WHERE t < $1`, [cutoff]);
  return res.rowCount ?? 0;
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
  // Never rename the source files unless the data is really in PostgreSQL
  if (!(await flush())) { ready = false; throw new Error('Legacy JSON import could not be saved to PostgreSQL — the JSON files were left in place; fix the error above and restart'); }

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
  const stale = new Map<string, string[]>();
  for (const def of TABLES) {
    const res = await query(`SELECT * FROM ${T(def.table)}`);
    def.load(res.rows, fresh);
    if (def.stale) stale.set(def.table, def.stale(res.rows));
  }
  Object.assign(db, fresh);
  // A reload replaces memory with what PostgreSQL actually has. An unsaved change from the
  // previous process is gone; the failure that blocked it does not apply to the loaded rows.
  dirty = false;
  saveFailure = null;
  conflictAttempts = 0;
  loggedFailure = '';
  lastFlushOk = true;
  for (const def of TABLES) lastHashes.set(def.table, new Map([...snapshot(def)].map(([k, v]) => [k, v.hash])));
  for (const [table, keys] of stale) {
    for (const k of keys) lastHashes.get(table)!.delete(k);
    if (keys.length) dirty = true;
  }
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
  const collisions = registryNameCollisions(db.registry);
  if (collisions.length) {
    dirty = false;
    throw new StoreDataError(`Dependency register names are the same under the shared name key (${collisions.slice(0, 5).join('; ')}). Rename one of each pair in the database. Nothing was written.`);
  }
  const fingerprintAdded = checkKeyFingerprint(db.channels);
  ready = true;
  // LOCAL_UI_SAFE_MODE=true (set by `npm run dev:prodcopy`, never in production): no metric rollup
  // writes or pruning on a local copy of production data, so its history stays as it was copied.
  const localCopy = process.env.LOCAL_UI_SAFE_MODE === 'true';
  const auditTrimmed = localCopy ? false : applyAuditRetention();
  // An install from before fingerprints (encrypted targets, no fingerprint yet): store it now.
  // Not on a local production copy: no write at startup, it is stored with the next save.
  if ((fingerprintAdded || auditTrimmed) && !localCopy) { dirty = true; await flush(); }
  if (!localCopy) {
    setInterval(() => { void flushMetrics(); }, 10_000).unref();
    const pruneMetrics = () => { void pruneServerMetrics().catch(err => log.error('store', `metrics prune failed: ${(err as Error).message}`)); };
    await pruneServerMetrics().catch(err => log.error('store', `metrics prune failed: ${(err as Error).message}`));
    setInterval(pruneMetrics, 3600_000).unref();
    await pruneAuditLog().catch(err => log.error('store', `audit prune failed: ${(err as Error).message}`));
  }
  return { migrations, imported };
}

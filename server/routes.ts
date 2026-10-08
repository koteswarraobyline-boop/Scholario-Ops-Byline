import express, { Request, Response, NextFunction, Router } from 'express';
import crypto from 'crypto';
import net from 'net';
import {
  Application, Monitor, Incident, CommunicationChannel, EscalationPolicy, MaintenanceWindow, Runbook,
  Deployment, BackupRecord, IncidentStatus, IncidentSeverity, MonitorType, IntegrationStatus, CheckRecord,
} from '../src/types/index.ts';
import { config, isCloudflareConfigured, isHostingerConfigured, isSmtpConfigured } from './config.ts';
import { db, persist, flush, liveMetrics, minuteMetrics, deleteServerMetrics, ServerRecord, UserRecord } from './store.ts';
import { broadcast, audit, addSseClient } from './events.ts';
import {
  requireAuth, requireRole, operatorName, hashPassword, verifyPassword, validatePasswordStrength, issueTokens,
  consumeRefreshToken, revokeRefreshToken, safeUser, loginRateLimited, recordLoginFailure, clearLoginFailures, ROLES, Role, issueStreamTicket,
} from './auth.ts';
import {
  ValidationError, body, reqStr, optStr, optInt, optBool, oneOf, optOneOf, optDate, strArray, isHostname, isDomain, isEmail,
} from './validate.ts';
import {
  HTTP_TYPES, TCP_TYPES, INFRA_TYPES, PUSH_TYPES, runMonitorNow, registerNewMonitor, recomputeDerived,
  ingestAgentReport, publicServer, performFailover, FailoverError, deadMan, nextIncidentId, AgentReport, closeMonitorIncident,
} from './engine.ts';
import { httpProbe, tcpProbe, dnsProbe, sslProbe, parseHostPort, normalizeUrl } from './probes.ts';
import { sendToChannel, notifyIncident } from './notify.ts';
import { cfState, syncCloudflare, CloudflareError, listCloudflareAccounts, listLoadBalancerPools } from './cloudflare.ts';
import { hostingerState, syncHostinger } from './hostinger.ts';
import { buildInstaller, buildUninstaller, AGENT_VERSION } from './agent.ts';
import { appChecksFor, LIST_KEYS, NULLABLE_LIST_KEYS, NULLABLE_OBJECT_KEYS } from './telemetry.ts';
import { agentHealth, serverHealth } from './telemetryHealth.ts';
import { lbState, syncLoadBalancers, PERMISSION_HINT } from './loadbalancer.ts';
import { syncAppUrlMonitors, DEFAULT_HEALTH_CHECK } from './appMonitors.ts';
import { readiness, failoverPreflight, applicationAvailability } from './readiness.ts';
import { readChecks } from './history.ts';
import { backupStatus, databaseHealth, agentState } from './health.ts';
import { notificationStatus } from './alerts.ts';
import { log } from './logger.ts';

const VERSION = '3.0.0';
const startedAt = Date.now();

const MONITOR_TYPES: MonitorType[] = ['HTTP', 'HTTPS', 'DNS', 'TCP', 'SSL', 'APP_HEALTH', 'APP_READINESS', 'API_BUSINESS', 'CRON_HEARTBEAT', 'WORKER_HEARTBEAT', 'INFRA_CPU', 'INFRA_RAM', 'INFRA_DISK', 'DB_CONN', 'DB_REPLICATION', 'BACKUP_FRESHNESS', 'DEAD_MAN'];
const ENVS = ['PRD', 'DR'] as const;
const SEVERITIES: IncidentSeverity[] = ['INFO', 'WARNING', 'HIGH', 'CRITICAL', 'EMERGENCY'];
const INCIDENT_STATUSES: IncidentStatus[] = ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'MITIGATING', 'MONITORING', 'RESOLVED', 'CLOSED'];
const CHANNEL_TYPES = ['TEAMS', 'EMAIL', 'WEBHOOK', 'PAGERDUTY'] as const;

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

/** Upper bound for one agent report (the global JSON limit is 1 MB) */
const AGENT_REPORT_MAX_BYTES = 512 * 1024;
const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });
const fail = (res: Response, status: number, message: string) => res.status(status).json({ success: false, message });
const newToken = () => crypto.randomBytes(24).toString('hex');
const nowIso = () => new Date().toISOString();

function paginate<T>(req: Request, list: T[], defaultSize = 25) {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(500, Math.max(1, Number.parseInt(String(req.query.pageSize ?? defaultSize), 10) || defaultSize));
  const total = list.length;
  return {
    success: true,
    data: list.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

function publicBaseUrl(req: Request) {
  if (config.publicUrl) return config.publicUrl;
  return `${req.protocol}://${req.get('host')}`;
}

const ROLE_LEVEL: Record<Role, number> = { viewer: 1, operator: 2, it_administrator: 3, super_admin: 4 };
const isAdmin = (req: Request) => (req.user ? ROLE_LEVEL[req.user.roleName] >= 3 : false);

/** Hides push-monitor secrets from users who cannot manage monitors */
function monitorView(req: Request, m: Monitor): Monitor {
  if (isAdmin(req)) return m;
  const { heartbeatToken: _t, ...rest } = m;
  return rest;
}

function integrationStatus(req: Request): IntegrationStatus {
  return {
    cloudflare: { configured: isCloudflareConfigured(), lastSyncAt: cfState.lastSyncAt, lastError: cfState.lastError, zoneCount: cfState.zones.length },
    hostinger: { configured: isHostingerConfigured(), lastSyncAt: hostingerState.lastSyncAt, lastError: hostingerState.lastError, vmCount: hostingerState.vms.length, status: hostingerState.status },
    notifications: notificationStatus(),
    loadBalancing: { configured: isCloudflareConfigured(), status: lbState.status, lastSyncAt: lbState.lastSyncAt, lastError: lbState.lastError, poolCount: lbState.pools.filter(p => p.found).length },
    smtp: { configured: isSmtpConfigured() },
    deadMan: { configured: Boolean(config.deadManHeartbeatUrl) },
    publicUrl: publicBaseUrl(req),
  };
}

function summary() {
  const open = db.incidents.filter(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  const critical = open.filter(i => i.severity === 'CRITICAL' || i.severity === 'EMERGENCY');
  // Cloudflare: never "HEALTHY" without data. LB origin health counts when an app is LB-mapped.
  const lbOriginsUnhealthy = lbState.pools.some(p => p.found && (p.healthy === false || p.origins.some(o => o.healthy === false || o.health.some(x => x.healthy === false))));
  const cloudflareStatus: 'HEALTHY' | 'DEGRADED' | 'NOT_CONFIGURED' | 'UNKNOWN' = !isCloudflareConfigured() ? 'NOT_CONFIGURED'
    : cfState.lastError || lbOriginsUnhealthy || lbState.status === 'ERROR' || cfState.zones.some(z => z.status !== 'ACTIVE') ? 'DEGRADED'
      : lbState.status === 'PERMISSION_REQUIRED' || (!cfState.lastSyncAt && lbState.status !== 'OK') ? 'UNKNOWN' : 'HEALTHY';
  const drReady = db.applications.filter(a => readiness(a).overall === 'READY').length;
  const dayAgo = Date.now() - 26 * 3600 * 1000;
  const backupsCurrent = db.backups.filter(b => b.status === 'SUCCESS' && Date.parse(b.completedAt) > dayAgo).length;
  const unhealthyApps = db.applications.filter(a => a.status === 'CRITICAL' || a.status === 'WARNING').length;
  const criticalApps = db.applications.filter(a => a.status === 'CRITICAL').length;
  const unknownApps = db.applications.filter(a => a.status === 'UNKNOWN' || a.status === 'STALE').length;
  // Data sources that are not reporting: health below is based on partial information
  const visibilityGaps: string[] = [];
  const silent = db.servers.filter(x => x.agentStatus !== 'CONNECTED');
  if (silent.length) visibilityGaps.push(`VPS telemetry missing for ${silent.map(x => x.ip).join(', ')}`);
  if (db.applications.some(a => a.loadBalancer) && lbState.status !== 'OK') visibilityGaps.push(`Cloudflare load balancing: ${lbState.status.replace('_', ' ').toLowerCase()}`);
  return {
    totalApps: db.applications.length,
    healthyApps: db.applications.filter(a => a.status === 'HEALTHY').length,
    totalServers: db.servers.length,
    healthyServers: db.servers.filter(s => s.status === 'HEALTHY').length,
    totalMonitors: db.monitors.length,
    healthyMonitors: db.monitors.filter(m => m.status === 'HEALTHY').length,
    openIncidents: open.length,
    criticalIncidents: critical.length,
    drReadinessCount: drReady,
    backupsCurrentCount: backupsCurrent,
    cloudflareStatus,
    deadManStatus: deadMan.status,
    deadManLastHeartbeat: deadMan.lastHeartbeatReceivedAt || null,
    overallHealth: critical.length > 0 || criticalApps > 0 || deadMan.status === 'CRITICAL_SILENCE' ? 'CRITICAL'
      : open.length > 0 || unhealthyApps > 0 ? 'WARNING'
        : db.applications.length === 0 || unknownApps > 0 ? 'UNKNOWN' : 'OPERATIONAL',
    visibilityGaps,
    generatedAt: nowIso(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation for entities
// ─────────────────────────────────────────────────────────────────────────────
function validateMonitorTarget(type: MonitorType, target: string, serverId?: string): string {
  if (HTTP_TYPES.includes(type)) {
    const url = normalizeUrl(target);
    try {
      const u = new URL(url);
      if (!u.hostname) throw new Error();
    } catch {
      throw new ValidationError('Target must be a valid http(s) URL, e.g. https://app.example.com/health');
    }
    return url;
  }
  if (TCP_TYPES.includes(type)) {
    const hp = parseHostPort(target);
    if (!hp || !(net.isIP(hp.host) || isHostname(hp.host))) throw new ValidationError('Target must be host:port, e.g. 203.0.113.10:3306');
    return `${hp.host.includes(':') ? `[${hp.host}]` : hp.host}:${hp.port}`;
  }
  if (type === 'DNS') {
    const host = target.replace(/^[a-z]+:\/\//i, '').replace(/[/:].*$/, '');
    if (!isHostname(host)) throw new ValidationError('Target must be a hostname, e.g. app.example.com');
    return host;
  }
  if (type === 'SSL') {
    const hp = parseHostPort(target, 443);
    if (!hp || !isHostname(hp.host)) throw new ValidationError('Target must be a hostname (optionally :port), e.g. app.example.com');
    return hp.port === 443 ? hp.host : `${hp.host}:${hp.port}`;
  }
  if (INFRA_TYPES.includes(type)) {
    if (!serverId || !db.servers.some(s => s.id === serverId)) throw new ValidationError('Select the server this resource monitor watches');
    return serverId;
  }
  return target || 'push';
}

function buildMonitor(req: Request, existing?: Monitor): Monitor {
  const b = body(req);
  const type = existing ? (optOneOf(b, 'type', 'Type', MONITOR_TYPES) ?? existing.type) : oneOf(b, 'type', 'Type', MONITOR_TYPES);
  const isPush = PUSH_TYPES.includes(type);
  const name = existing ? (optStr(b, 'name', 'Name', 120) ?? existing.name) : reqStr(b, 'name', 'Name', 120);
  if (!name) throw new ValidationError('Name is required');

  let serverId = existing?.serverId;
  if (b.serverId !== undefined) serverId = b.serverId === null || b.serverId === '' ? undefined : optStr(b, 'serverId', 'Server', 64);
  if (serverId && !db.servers.some(s => s.id === serverId)) throw new ValidationError('Selected server does not exist');

  const rawTarget = optStr(b, 'target', 'Target', 500) ?? existing?.target ?? '';
  if (!rawTarget && !isPush && !INFRA_TYPES.includes(type)) throw new ValidationError('Target is required');
  const target = validateMonitorTarget(type, rawTarget, serverId);

  const applicationId = b.applicationId !== undefined ? (optStr(b, 'applicationId', 'Application', 64) ?? '') : existing?.applicationId ?? '';
  if (applicationId && !db.applications.some(a => a.id === applicationId)) throw new ValidationError('Selected application does not exist');

  const intervalSec = optInt(b, 'intervalSec', 'Interval', 10, 7 * 86400) ?? existing?.intervalSec ?? (isPush ? 300 : 30);
  const timeoutSec = optInt(b, 'timeoutSec', 'Timeout', 1, isPush ? 86400 : 60) ?? existing?.timeoutSec ?? (isPush ? 60 : 10);
  if (!isPush && timeoutSec >= intervalSec) throw new ValidationError('Timeout must be shorter than the check interval');
  const expectedStatusCode = b.expectedStatusCode === null || b.expectedStatusCode === '' ? undefined
    : optInt(b, 'expectedStatusCode', 'Expected status code', 100, 599) ?? existing?.expectedStatusCode;

  return {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    type,
    target,
    applicationId,
    environment: optOneOf(b, 'environment', 'Environment', ENVS) ?? existing?.environment ?? 'PRD',
    intervalSec,
    timeoutSec,
    retries: optInt(b, 'retries', 'Retries', 1, 5) ?? existing?.retries ?? 2,
    warningThresholdMs: optInt(b, 'warningThresholdMs', 'Warning threshold', 0, 3_600_000) ?? existing?.warningThresholdMs ?? (INFRA_TYPES.includes(type) ? 80 : 1000),
    criticalThresholdMs: optInt(b, 'criticalThresholdMs', 'Critical threshold', 0, 3_600_000) ?? existing?.criticalThresholdMs ?? (INFRA_TYPES.includes(type) ? 95 : 5000),
    failureConfirmationThreshold: optInt(b, 'failureConfirmationThreshold', 'Failure confirmation', 1, 10) ?? existing?.failureConfirmationThreshold ?? 3,
    recoveryConfirmationThreshold: optInt(b, 'recoveryConfirmationThreshold', 'Recovery confirmation', 1, 10) ?? existing?.recoveryConfirmationThreshold ?? 2,
    consecutiveFailures: existing?.consecutiveFailures ?? 0,
    consecutiveRecoveries: existing?.consecutiveRecoveries ?? 0,
    status: existing?.status ?? 'UNKNOWN',
    lastCheck: existing?.lastCheck ?? '',
    lastSuccess: existing?.lastSuccess ?? '',
    lastFailure: existing?.lastFailure,
    responseTimeMs: existing?.responseTimeMs ?? 0,
    uptimePercent: existing?.uptimePercent ?? 100,
    history: existing?.history ?? [],
    runbookId: b.runbookId !== undefined ? (optStr(b, 'runbookId', 'Runbook', 64) || undefined) : existing?.runbookId,
    enabled: optBool(b, 'enabled') ?? existing?.enabled ?? true,
    activeMaintenance: existing?.activeMaintenance ?? false,
    serverId,
    expectedStatusCode,
    expectedBodyContains: b.expectedBodyContains !== undefined ? (optStr(b, 'expectedBodyContains', 'Expected body text', 200) || undefined) : existing?.expectedBodyContains,
    heartbeatToken: isPush ? (existing?.heartbeatToken ?? newToken()) : undefined,
    lastPingAt: existing?.lastPingAt,
    lastValue: existing?.lastValue,
  };
}

function buildApplication(req: Request, existing?: Application): Application {
  const b = body(req);
  const name = existing ? (optStr(b, 'name', 'Name', 120) ?? existing.name) : reqStr(b, 'name', 'Name', 120);
  const codeName = (existing ? (optStr(b, 'codeName', 'Code name', 60) ?? existing.codeName) : reqStr(b, 'codeName', 'Code name', 60)).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(codeName)) throw new ValidationError('Code name may only contain lower-case letters, numbers and dashes');
  if (db.applications.some(a => a.codeName === codeName && a.id !== existing?.id)) throw new ValidationError(`Code name "${codeName}" is already used`);

  const prdServerId = b.prdServerId !== undefined ? (optStr(b, 'prdServerId', 'PRD server', 64) ?? '') : existing?.prdServerId ?? '';
  const drServerId = b.drServerId !== undefined ? (optStr(b, 'drServerId', 'DR server', 64) ?? '') : existing?.drServerId ?? '';
  if (prdServerId && !db.servers.some(s => s.id === prdServerId)) throw new ValidationError('PRD server does not exist');
  if (drServerId && !db.servers.some(s => s.id === drServerId)) throw new ValidationError('DR server does not exist');
  if (prdServerId && prdServerId === drServerId) throw new ValidationError('PRD and DR must be different servers');

  const cloudflareZone = (b.cloudflareZone !== undefined ? (optStr(b, 'cloudflareZone', 'Cloudflare zone', 253) ?? '') : existing?.cloudflareZone ?? '').toLowerCase();
  if (cloudflareZone && !isDomain(cloudflareZone)) throw new ValidationError('Cloudflare zone must be a domain, e.g. example.com');
  const dnsRecordName = (b.dnsRecordName !== undefined ? (optStr(b, 'dnsRecordName', 'DNS record', 253) ?? '') : existing?.dnsRecordName ?? '').toLowerCase();
  if (dnsRecordName) {
    if (!cloudflareZone) throw new ValidationError('Set the Cloudflare zone before the DNS record');
    if (!isHostname(dnsRecordName) || !(dnsRecordName === cloudflareZone || dnsRecordName.endsWith(`.${cloudflareZone}`))) {
      throw new ValidationError(`DNS record must be ${cloudflareZone} or a sub-domain of it`);
    }
  }
  // Origin / application URLs (drive the managed URL monitors)
  const appUrl = (key: 'prdUrl' | 'drUrl', label: string): string | undefined => {
    if (b[key] === undefined) return existing?.[key];
    const raw = optStr(b, key, label, 2000);
    if (!raw) return undefined;
    let u: URL;
    try { u = new URL(raw); } catch { throw new ValidationError(`${label} must be a full http(s) URL, e.g. https://app.example.com/login`); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ValidationError(`${label} must start with https:// or http://`);
    if (!u.hostname || !(net.isIP(u.hostname.replace(/^\[|\]$/g, '')) || isHostname(u.hostname))) throw new ValidationError(`${label} has an invalid host`);
    return u.toString();
  };
  const prdUrl = appUrl('prdUrl', 'PRD URL');
  const drUrl = appUrl('drUrl', 'DR URL');

  // Cloudflare Load Balancer mapping (null / {} removes it)
  let loadBalancer = existing?.loadBalancer;
  if (b.loadBalancer !== undefined) {
    const lb = (b.loadBalancer ?? null) as Record<string, unknown> | null;
    const vals = lb ? ['accountId', 'hostname', 'prdPoolId', 'drPoolId'].map(k => String(lb[k] ?? '').trim()) : [];
    if (!lb || vals.every(v => v === '')) {
      loadBalancer = undefined;
    } else {
      const [accountId, hostname, prdPoolId, drPoolId] = [vals[0].toLowerCase(), vals[1].toLowerCase(), vals[2].toLowerCase(), vals[3].toLowerCase()];
      const hex32 = /^[0-9a-f]{32}$/;
      if (!hex32.test(accountId)) throw new ValidationError('Cloudflare Account ID must be the 32-character hex ID from the Cloudflare dashboard');
      if (!hostname || !isHostname(hostname)) throw new ValidationError('Load Balancer hostname must be a valid hostname, e.g. app.example.com');
      if (!hex32.test(prdPoolId)) throw new ValidationError('PRD pool ID is required (32-character hex) — use "Load pools" to pick it');
      if (!hex32.test(drPoolId)) throw new ValidationError('DR pool ID is required (32-character hex) — use "Load pools" to pick it');
      if (prdPoolId === drPoolId) throw new ValidationError('PRD and DR must use different Cloudflare pools');
      const clash = db.applications.find(a => a.id !== existing?.id && a.loadBalancer && (a.loadBalancer.hostname === hostname || [a.loadBalancer.prdPoolId, a.loadBalancer.drPoolId].some(x => x === prdPoolId || x === drPoolId)));
      if (clash) throw new ValidationError(`That Load Balancer hostname or pool is already mapped to ${clash.name}`);
      loadBalancer = { accountId, hostname, prdPoolId, drPoolId };
    }
  }

  // Health-check settings for the managed URL monitors
  let healthCheck = existing?.healthCheck ?? { ...DEFAULT_HEALTH_CHECK };
  if (b.healthCheck !== undefined && b.healthCheck !== null) {
    const hc = b.healthCheck as Record<string, unknown>;
    const expectedStatus = hc.expectedStatus === null || hc.expectedStatus === '' || hc.expectedStatus === undefined ? null
      : optInt(hc, 'expectedStatus', 'Expected status code', 100, 599) ?? null;
    const intervalSec = optInt(hc, 'intervalSec', 'Check interval', 10, 86400) ?? healthCheck.intervalSec;
    const timeoutSec = optInt(hc, 'timeoutSec', 'Check timeout', 1, 60) ?? healthCheck.timeoutSec;
    if (timeoutSec >= intervalSec) throw new ValidationError('Check timeout must be shorter than the check interval');
    healthCheck = { expectedStatus, intervalSec, timeoutSec, sslMonitoring: optBool(hc, 'sslMonitoring') ?? healthCheck.sslMonitoring };
  }

  // Per-environment inventory: every field optional, empty = unknown / pending (never guessed)
  let environments = existing?.environments;
  if (b.environments !== undefined && b.environments !== null) {
    const src = b.environments as Record<string, Record<string, unknown> | null | undefined>;
    const next: NonNullable<Application['environments']> = { ...(existing?.environments ?? {}) };
    for (const env of ['PRD', 'DR'] as const) {
      const e = src[env];
      if (e === undefined) continue;
      if (e === null) { delete next[env]; continue; }
      const sv = (k: string, label: string, max = 200) => { const v = optStr(e, k, label, max); return v ? v : null; };
      const port = (k: string, label: string) => (e[k] === null || e[k] === '' || e[k] === undefined ? null : optInt(e, k, label, 1, 65535) ?? null);
      const engine = e.dbEngine === null || e.dbEngine === '' || e.dbEngine === undefined ? null : oneOf(e, 'dbEngine', `${env} database type`, ['mysql', 'mariadb', 'postgresql'] as const);
      const healthPath = sv('healthPath', `${env} health endpoint`, 500);
      if (healthPath && !healthPath.startsWith('/')) throw new ValidationError(`${env} health endpoint must be a path starting with /, e.g. /login/index.php`);
      next[env] = {
        appPort: port('appPort', `${env} application port`),
        healthPath,
        webServer: sv('webServer', `${env} web server`, 60),
        processManager: sv('processManager', `${env} process manager`, 60),
        routing: sv('routing', `${env} routing`, 300),
        dbEngine: engine,
        dbName: sv('dbName', `${env} database name`, 128),
        dbPort: port('dbPort', `${env} database port`),
        replicationMaxLagSec: e.replicationMaxLagSec === null || e.replicationMaxLagSec === '' || e.replicationMaxLagSec === undefined ? null : optInt(e, 'replicationMaxLagSec', `${env} max replication lag`, 0, 86400) ?? null,
        backupMaxAgeHours: e.backupMaxAgeHours === null || e.backupMaxAgeHours === '' || e.backupMaxAgeHours === undefined ? null : optInt(e, 'backupMaxAgeHours', `${env} max backup age`, 1, 8760) ?? null,
        notes: optStr(e, 'notes', `${env} notes`, 1000) ?? '',
      };
    }
    environments = next;
  }

  const autoFailover = optBool(b, 'autoFailover') ?? existing?.autoFailover ?? false;
  if (autoFailover && loadBalancer) throw new ValidationError('Automatic failover is not available for Load-Balancer-managed applications — traffic is switched in Cloudflare');
  if (autoFailover && (!dnsRecordName || !drServerId || !prdServerId)) throw new ValidationError('Auto-failover needs PRD server, DR server and a DNS record');

  return {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    codeName,
    description: b.description !== undefined ? (optStr(b, 'description', 'Description', 1000) ?? '') : existing?.description ?? '',
    tier: optOneOf(b, 'tier', 'Tier', ['TIER_1', 'TIER_2', 'TIER_3'] as const) ?? existing?.tier ?? 'TIER_2',
    status: existing?.status ?? 'UNKNOWN',
    uptime24h: existing?.uptime24h ?? null,
    uptime7d: existing?.uptime7d ?? null,
    uptime30d: existing?.uptime30d ?? null,
    rtoTargetMin: optInt(b, 'rtoTargetMin', 'RTO', 1, 10080) ?? existing?.rtoTargetMin ?? 30,
    rpoTargetMin: optInt(b, 'rpoTargetMin', 'RPO', 0, 10080) ?? existing?.rpoTargetMin ?? 15,
    currentReplicationLagSec: existing?.currentReplicationLagSec ?? null,
    prdServerId,
    drServerId,
    failoverState: existing?.failoverState ?? 'PRIMARY_ACTIVE',
    p50Ms: existing?.p50Ms ?? null,
    p95Ms: existing?.p95Ms ?? null,
    p99Ms: existing?.p99Ms ?? null,
    errorRatePercent: existing?.errorRatePercent ?? null,
    lastChecked: existing?.lastChecked ?? '',
    cloudflareZone,
    dnsRecordName: dnsRecordName || undefined,
    autoFailover,
    lastFailoverAt: existing?.lastFailoverAt,
    dependencies: existing?.dependencies ?? [],
    recentDeploymentVersion: existing?.recentDeploymentVersion,
    lastTestedRecoveryDate: existing?.lastTestedRecoveryDate,
    lastTestedRecoveryDurationMin: existing?.lastTestedRecoveryDurationMin,
    prdUrl,
    drUrl,
    loadBalancer,
    healthCheck,
    environments,
  };
}

function buildServer(req: Request, existing?: ServerRecord): ServerRecord {
  const b = body(req);
  const hostname = (existing ? (optStr(b, 'hostname', 'Hostname', 253) ?? existing.hostname) : reqStr(b, 'hostname', 'Hostname', 253)).toLowerCase();
  if (!isHostname(hostname)) throw new ValidationError('Hostname is not valid');
  const ip = existing ? (optStr(b, 'ip', 'IP address', 64) ?? existing.ip) : reqStr(b, 'ip', 'IP address', 64);
  if (!net.isIP(ip)) throw new ValidationError('IP address is not a valid IPv4/IPv6 address');
  if (db.servers.some(s => s.hostname === hostname && s.id !== existing?.id)) throw new ValidationError(`Hostname ${hostname} is already registered`);
  if (db.servers.some(s => s.ip === ip && s.id !== existing?.id)) throw new ValidationError(`IP ${ip} is already registered`);
  const applicationId = b.applicationId !== undefined ? (optStr(b, 'applicationId', 'Application', 64) ?? '') : existing?.applicationId ?? '';
  if (applicationId && !db.applications.some(a => a.id === applicationId)) throw new ValidationError('Selected application does not exist');

  // Purchased plan capacity (live usage comes from the agent). All three numbers or none.
  const planName = b.plan !== undefined ? (optStr(b, 'plan', 'Plan', 120) ?? '') : existing?.plan ?? '';
  const capKeys = ['planCpuCores', 'planRamGb', 'planDiskGb'] as const;
  let planSpec = existing?.planSpec;
  if (capKeys.some(k => b[k] !== undefined)) {
    const raw = capKeys.map(k => (b[k] === '' || b[k] === null ? undefined : b[k]));
    if (raw.every(v => v === undefined)) planSpec = undefined;
    else {
      if (raw.some(v => v === undefined)) throw new ValidationError('Enter CPU cores, RAM and disk together (or leave all three empty)');
      const [cpu, ram, disk] = raw.map(Number);
      if (!Number.isInteger(cpu) || cpu < 1 || cpu > 1024) throw new ValidationError('CPU cores must be a whole number between 1 and 1024');
      if (!Number.isFinite(ram) || ram <= 0 || ram > 65536) throw new ValidationError('RAM (GB) must be a positive number');
      if (!Number.isFinite(disk) || disk <= 0 || disk > 1_000_000) throw new ValidationError('Disk (GB) must be a positive number');
      const same = planSpec && planSpec.cpuCores === cpu && planSpec.ramGb === ram && planSpec.diskGb === disk;
      planSpec = { name: planName, cpuCores: cpu, ramGb: ram, diskGb: disk, source: same ? planSpec!.source : 'manual' };
    }
  }
  if (planSpec) planSpec = { ...planSpec, name: planName };
  const now = nowIso();
  return {
    id: existing?.id ?? crypto.randomUUID(),
    hostname,
    ip,
    applicationId,
    environment: optOneOf(b, 'environment', 'Environment', ENVS) ?? existing?.environment ?? 'PRD',
    provider: b.provider !== undefined ? (optStr(b, 'provider', 'Provider', 60) ?? '') : existing?.provider ?? '',
    region: b.region !== undefined ? (optStr(b, 'region', 'Region', 60) ?? '') : existing?.region ?? '',
    plan: planName,
    planSpec,
    cpuCores: existing?.cpuCores ?? 0,
    ramGb: existing?.ramGb ?? 0,
    diskGb: existing?.diskGb ?? 0,
    os: existing?.os ?? '',
    status: existing?.status ?? 'UNKNOWN',
    agentVersion: existing?.agentVersion ?? '',
    agentStatus: existing?.agentStatus ?? 'DISCONNECTED',
    uptimeDays: existing?.uptimeDays ?? 0,
    lastSeen: existing?.lastSeen ?? '',
    notes: b.notes !== undefined ? (optStr(b, 'notes', 'Notes', 2000) ?? '') : existing?.notes,
    telemetry: existing?.telemetry ?? { cpuPercent: 0, ramPercent: 0, diskPercent: 0, loadAvg: [0, 0, 0], networkInKbps: 0, networkOutKbps: 0, observedAt: '', receivedAt: '' },
    processes: existing?.processes ?? [],
    services: existing?.services ?? [],
    logs: existing?.logs ?? [],
    agentToken: existing?.agentToken ?? newToken(),
    createdAt: existing?.createdAt ?? now,
    hostingerVmId: existing?.hostingerVmId,
    hostingerState: existing?.hostingerState,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
export function buildRouter(): Router {
  const r = express.Router();
  // API responses carry live data or secrets for admins: never cache them
  r.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  // ── Public: health ─────────────────────────────────────────────────────────
  const health = (req: Request, res: Response) => {
    const s = summary();
    res.json({
      status: s.criticalIncidents > 0 ? 'degraded' : 'ok',
      service: 'scholario-ops-api',
      version: VERSION,
      timestamp: nowIso(),
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      environment: process.env.NODE_ENV || 'development',
      cluster: config.publicUrl || req.get('host') || '',
      healthCheckEndpoint: '/api/health',
      reachable: true,
      checks: {
        api_gateway: 'UP',
        edge_ingress: 'UP',
        deadman_watchdog: deadMan.status,
        cloudflare_sync: !isCloudflareConfigured() ? 'NOT_CONFIGURED' : cfState.lastError ? 'ERROR' : s.cloudflareStatus,
        cloudflare_load_balancing: lbState.status,
        vps_telemetry_stream: `${db.servers.filter(x => x.agentStatus === 'CONNECTED').length}/${db.servers.length} agents connected`,
        continuous_probes: `${s.healthyMonitors}/${s.totalMonitors} HEALTHY`,
      },
      counts: {
        applications: s.totalApps,
        servers: s.totalServers,
        monitors: s.totalMonitors,
        openIncidents: s.openIncidents,
        criticalIncidents: s.criticalIncidents,
      },
    });
  };
  r.get('/health', health);

  // ── Public: auth ───────────────────────────────────────────────────────────
  r.post('/auth/login', h((req, res) => {
    const b = body(req);
    const email = String(b.email ?? '').trim().toLowerCase();
    const password = String(b.password ?? '');
    const ipKey = `ip:${req.ip}`;
    const acctKey = `acct:${email}`;
    if (loginRateLimited(ipKey) || loginRateLimited(acctKey)) return fail(res, 429, 'Too many login attempts. Try again in 15 minutes.');
    if (!email || !password) return fail(res, 400, 'Email and password are required');
    const user = db.users.find(u => u.email === email);
    if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
      recordLoginFailure(ipKey);
      recordLoginFailure(acctKey);
      if (user) audit(email, 'LOGIN_FAILED', 'AUTH', user.id, `Failed login from ${req.ip}`);
      return fail(res, 401, 'Invalid email or password');
    }
    clearLoginFailures(acctKey);
    user.lastLoginAt = nowIso();
    const tokens = issueTokens(user);
    audit(user.displayName || user.email, 'LOGIN', 'AUTH', user.id, `Signed in from ${req.ip}`);
    ok(res, { user: safeUser(user), tokens });
  }));

  r.post('/auth/refresh', h((req, res) => {
    const token = String(body(req).refreshToken ?? '');
    const user = token ? consumeRefreshToken(token) : null;
    if (!user) return fail(res, 401, 'Session expired — sign in again');
    ok(res, { user: safeUser(user), tokens: issueTokens(user) });
  }));

  r.post('/auth/logout', h((req, res) => {
    const token = String(body(req).refreshToken ?? '');
    if (token) revokeRefreshToken(token);
    ok(res, { loggedOut: true });
  }));

  // ── Public (token-authenticated): agent, heartbeats, CI reports ────────────
  const agentServer = (req: Request): ServerRecord | undefined => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return undefined;
    return db.servers.find(s => s.agentToken.length === token.length && crypto.timingSafeEqual(Buffer.from(s.agentToken), Buffer.from(token)));
  };

  r.post('/v1/agent/ingest', h((req, res) => {
    const srv = agentServer(req);
    if (!srv) return fail(res, 401, 'Invalid agent token');
    // A real report is a few KB (≈ 50 KB with many PM2 apps / filesystems); refuse anything far larger
    if (Number(req.headers['content-length'] ?? 0) > AGENT_REPORT_MAX_BYTES) return fail(res, 413, `Report larger than ${AGENT_REPORT_MAX_BYTES} bytes`);
    const b = body(req) as unknown as AgentReport;
    const pctOk = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
    if (!pctOk(b.cpuPercent) || !pctOk(b.ramPercent) || !pctOk(b.diskPercent)) {
      return fail(res, 400, 'cpuPercent, ramPercent and diskPercent are required numbers between 0 and 100');
    }
    if (typeof b.observedAt !== 'string' || Number.isNaN(Date.parse(b.observedAt))) {
      return fail(res, 400, 'observedAt (ISO-8601 timestamp) is required — update the agent (reinstall from Setup)');
    }
    const skewSec = Math.abs(Date.now() - Date.parse(b.observedAt)) / 1000;
    if (skewSec > config.agentMaxClockSkewSec) {
      return fail(res, 400, `Report timestamp is ${Math.round(skewSec)}s away from server time (max ${config.agentMaxClockSkewSec}s) — check NTP on the VPS`);
    }
    for (const k of ['load', 'processes', 'services', 'logs', 'errors', 'databases', ...LIST_KEYS] as const) {
      if (b[k] !== undefined && !Array.isArray(b[k])) return fail(res, 400, `${k} must be a list`);
    }
    for (const k of NULLABLE_LIST_KEYS) {
      if (b[k] !== undefined && b[k] !== null && !Array.isArray(b[k])) return fail(res, 400, `${k} must be a list or null`);
    }
    for (const k of NULLABLE_OBJECT_KEYS) {
      const v = b[k];
      if (v !== undefined && v !== null && (typeof v !== 'object' || Array.isArray(v))) return fail(res, 400, `${k} must be an object or null`);
    }
    ingestAgentReport(srv, b, { sourceIp: req.ip });
    // appChecks: local application health checks the agent should run on this host (agent >= 3.3)
    ok(res, { accepted: true, serverId: srv.id, appChecks: appChecksFor(srv) });
  }));

  r.get('/v1/agent/install/:serverId', h((req, res) => {
    const srv = db.servers.find(s => s.id === req.params.serverId);
    const key = String(req.query.key ?? '');
    if (!srv || key.length !== srv.agentToken.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(srv.agentToken))) {
      return res.status(404).type('text/plain').send('echo "Unknown server or invalid key" >&2; exit 1\n');
    }
    const services = String(req.query.services ?? 'nginx apache2 mysql mariadb postgresql redis-server docker php8.3-fpm php8.2-fpm php8.1-fpm pm2-root');
    res.type('text/plain').send(buildInstaller({ serverUrl: publicBaseUrl(req), agentToken: srv.agentToken, hostname: srv.hostname, services }));
  }));

  r.get('/v1/agent/uninstall', (_req, res) => { res.type('text/plain').send(buildUninstaller()); });

  const heartbeat = h((req, res) => {
    const token = req.params.token;
    const m = db.monitors.find(x => x.heartbeatToken && x.heartbeatToken === token);
    if (!m) return fail(res, 404, 'Unknown heartbeat token');
    const raw = req.query.value ?? (body(req).value as unknown);
    if (raw !== undefined && raw !== '') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return fail(res, 400, 'value must be numeric');
      m.lastValue = n;
    }
    m.lastPingAt = nowIso();
    persist();
    void runMonitorNow(m);
    ok(res, { received: true, monitor: m.name });
  });
  r.get('/v1/heartbeat/:token', heartbeat);
  r.post('/v1/heartbeat/:token', heartbeat);

  r.post('/v1/deployments/report', h((req, res) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!config.deployReportToken || token.length !== config.deployReportToken.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(config.deployReportToken))) {
      return fail(res, 401, 'Invalid deploy report token');
    }
    const b = body(req);
    const codeName = reqStr(b, 'application', 'application (code name)', 60).toLowerCase();
    const app = db.applications.find(a => a.codeName === codeName || a.id === codeName);
    if (!app) return fail(res, 404, `Unknown application ${codeName}`);
    const id = optStr(b, 'id', 'Deployment id', 100) || crypto.randomUUID();
    const existing = db.deployments.find(d => d.id === id);
    const status = oneOf(b, 'status', 'Status', ['BUILDING', 'DEPLOYING', 'HEALTH_CHECK', 'SMOKE_TEST', 'SUCCESS', 'FAILED', 'ROLLED_BACK'] as const);
    const dep: Deployment = {
      id,
      applicationId: app.id,
      version: reqStr(b, 'version', 'Version', 100),
      commitHash: optStr(b, 'commitHash', 'Commit hash', 64) ?? existing?.commitHash ?? '',
      commitMessage: optStr(b, 'commitMessage', 'Commit message', 500) ?? existing?.commitMessage ?? '',
      environment: oneOf(b, 'environment', 'Environment', ENVS, 'PRD'),
      author: optStr(b, 'author', 'Author', 120) ?? existing?.author ?? 'CI',
      startedAt: existing?.startedAt ?? optDate(b, 'startedAt', 'startedAt') ?? nowIso(),
      completedAt: ['SUCCESS', 'FAILED', 'ROLLED_BACK'].includes(status) ? nowIso() : undefined,
      durationSec: 0,
      status,
      rollbackAvailable: optBool(b, 'rollbackAvailable') ?? existing?.rollbackAvailable ?? false,
    };
    dep.durationSec = Math.max(0, Math.round(((dep.completedAt ? Date.parse(dep.completedAt) : Date.now()) - Date.parse(dep.startedAt)) / 1000));
    if (existing) Object.assign(existing, dep); else db.deployments.unshift(dep);
    if (db.deployments.length > 1000) db.deployments.length = 1000;
    persist();
    audit(dep.author, `DEPLOYMENT_${status}`, 'DEPLOYMENT', dep.id, `${app.name} ${dep.version} → ${dep.environment}: ${status}`);
    broadcast('deployments_changed', null);
    recomputeDerived();
    ok(res, dep, existing ? 200 : 201);
  }));

  r.post('/v1/backups/report', h((req, res) => {
    const srv = agentServer(req);
    if (!srv) return fail(res, 401, 'Invalid agent token');
    const b = body(req);
    const appId = optStr(b, 'applicationId', 'applicationId', 64) || srv.applicationId;
    const codeName = optStr(b, 'application', 'application', 60)?.toLowerCase();
    const app = db.applications.find(a => a.id === appId || (codeName && a.codeName === codeName));
    const rec: BackupRecord = {
      id: crypto.randomUUID(),
      applicationId: app?.id ?? '',
      serverId: srv.id,
      type: oneOf(b, 'type', 'type', ['DAILY_SNAPSHOT', 'MYSQL_DUMP', 'FILE_STORAGE'] as const),
      sizeGb: Number(b.sizeGb) || 0,
      destination: optStr(b, 'destination', 'destination', 300) ?? '',
      retentionDays: optInt(b, 'retentionDays', 'retentionDays', 0, 3650) ?? 0,
      encrypted: optBool(b, 'encrypted') ?? false,
      integrityVerified: Boolean(optStr(b, 'integrityHash', 'integrityHash', 200)),
      integrityHash: optStr(b, 'integrityHash', 'integrityHash', 200) ?? '',
      restoreTestedAt: optDate(b, 'restoreTestedAt', 'restoreTestedAt') ?? '',
      restoreDurationMin: optInt(b, 'restoreDurationMin', 'restoreDurationMin', 0, 100000) ?? 0,
      restoreStatus: optOneOf(b, 'restoreStatus', 'restoreStatus', ['VERIFIED', 'FAILED', 'PENDING'] as const) ?? 'PENDING',
      status: oneOf(b, 'status', 'status', ['SUCCESS', 'FAILED', 'RUNNING', 'STALE', 'UNKNOWN'] as const),
      completedAt: optDate(b, 'completedAt', 'completedAt') ?? nowIso(),
    };
    db.backups.unshift(rec);
    if (db.backups.length > 2000) db.backups.length = 2000;
    persist();
    audit(`Agent ${srv.hostname}`, `BACKUP_${rec.status}`, 'BACKUP', rec.id, `${rec.type} ${rec.sizeGb}GB → ${rec.destination || 'unknown destination'}`);
    broadcast('backups_changed', null);
    ok(res, rec, 201);
  }));

  // ── Everything below requires a signed-in user ─────────────────────────────
  r.use(requireAuth);

  // Every authenticated change is committed to PostgreSQL before the response is sent,
  // so "Saved" in the browser means the data is in the database.
  r.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const send = res.json.bind(res);
    res.json = ((payload: unknown) => {
      void flush().then(saved => {
        if (!saved && res.statusCode < 400) { res.status(503); send({ success: false, message: 'The change could not be saved to the database — check the PostgreSQL connection and try again' }); return; }
        send(payload);
      });
      return res;
    }) as typeof res.json;
    next();
  });

  r.get('/auth/me', (req, res) => { ok(res, safeUser(req.user!)); });

  r.post('/auth/change-password', h((req, res) => {
    const b = body(req);
    const user = req.user!;
    if (!verifyPassword(String(b.currentPassword ?? ''), user.passwordHash)) return fail(res, 400, 'Current password is incorrect');
    const err = validatePasswordStrength(String(b.newPassword ?? ''));
    if (err) return fail(res, 400, err);
    user.passwordHash = hashPassword(String(b.newPassword));
    user.tokenVersion += 1;
    db.refreshTokens = db.refreshTokens.filter(t => t.userId !== user.id);
    persist();
    audit(operatorName(req), 'PASSWORD_CHANGED', 'AUTH', user.id, 'Password changed; all sessions signed out');
    ok(res, { user: safeUser(user), tokens: issueTokens(user) });
  }));

  r.post('/v1/realtime/ticket', (req, res) => { ok(res, { ticket: issueStreamTicket(req.user!), expiresInSec: 60 }); });
  r.get('/v1/realtime/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`event: connected\ndata: ${JSON.stringify({ connected: true, serverTime: nowIso() })}\n\n`);
    addSseClient(res, req.user!);
  });

  r.get('/v1/bootstrap', (req, res) => {
    ok(res, {
      applications: db.applications,
      servers: db.servers.map(publicServer),
      monitors: db.monitors.map(m => monitorView(req, m)),
      incidents: db.incidents.slice(0, 500),
      channels: isAdmin(req) ? db.channels : db.channels.map(c => ({ ...c, targetEndpoint: c.targetEndpoint ? '••••••' : '' })),
      escalationPolicies: db.escalationPolicies,
      maintenanceWindows: db.maintenanceWindows,
      runbooks: db.runbooks,
      deployments: db.deployments.slice(0, 200),
      backups: db.backups.slice(0, 200),
      auditLogs: db.auditLogs.slice(0, 200),
      cloudflareZones: cfState.zones,
      loadBalancer: lbState,
      deadMan,
      integrations: integrationStatus(req),
      summary: summary(),
    });
  });

  r.get('/v1/integrations', (req, res) => { ok(res, integrationStatus(req)); });
  r.get('/v1/system/summary', (_req, res) => { ok(res, summary()); });
  r.get('/v1/deadman/status', (_req, res) => { ok(res, deadMan); });

  // ── Servers ────────────────────────────────────────────────────────────────
  r.get('/v1/servers', (_req, res) => { ok(res, db.servers.map(publicServer)); });
  r.get('/v1/servers/:id', (req, res) => {
    const s = db.servers.find(x => x.id === req.params.id);
    return s ? ok(res, publicServer(s)) : fail(res, 404, 'Server not found');
  });
  r.get('/v1/servers/:id/metrics', (req, res) => {
    if (!db.servers.some(x => x.id === req.params.id)) return fail(res, 404, 'Server not found');
    const range = String(req.query.range ?? '1h');
    const data = range === '1h' ? (liveMetrics[req.params.id] ?? []) : (minuteMetrics[req.params.id] ?? []).filter(p => Date.parse(p.t) > Date.now() - (range === '6h' ? 6 : range === '24h' ? 24 : 48) * 3600 * 1000);
    ok(res, data);
  });
  r.post('/v1/servers', requireRole('it_administrator'), h((req, res) => {
    const srv = buildServer(req);
    db.servers.push(srv);
    persist();
    audit(operatorName(req), 'SERVER_REGISTERED', 'INFRASTRUCTURE', srv.id, `${srv.hostname} (${srv.ip}) ${srv.environment} · ${srv.provider} ${srv.region}`);
    broadcast('servers_changed', null);
    if (isHostingerConfigured()) void syncHostinger().catch(() => {});
    ok(res, publicServer(srv), 201);
  }));
  r.patch('/v1/servers/:id', requireRole('it_administrator'), h((req, res) => {
    const idx = db.servers.findIndex(x => x.id === req.params.id);
    if (idx === -1) return fail(res, 404, 'Server not found');
    const prev = db.servers[idx];
    const updated = buildServer(req, prev);
    db.servers[idx] = updated;
    persist();
    const sdiff = (['hostname', 'ip', 'environment', 'provider', 'region', 'plan', 'notes'] as const)
      .filter(k => String(prev[k] ?? '') !== String(updated[k] ?? '')).map(k => `${k}: ${prev[k] || '—'} → ${updated[k] || '—'}`);
    if (JSON.stringify(prev.planSpec ?? null) !== JSON.stringify(updated.planSpec ?? null)) sdiff.push(`capacity: ${updated.planSpec ? `${updated.planSpec.cpuCores} CPU / ${updated.planSpec.ramGb} GB / ${updated.planSpec.diskGb} GB` : '—'}`);
    audit(operatorName(req), 'SERVER_UPDATED', 'INFRASTRUCTURE', updated.id, `${updated.hostname} (${updated.ip}): ${sdiff.join('; ') || 'no field changes'}`);
    // The IP may have changed: Cloudflare origin matching and readiness use it on the next cycle
    if (prev.ip !== updated.ip) void syncLoadBalancers().catch(() => {});
    recomputeDerived();
    broadcast('servers_changed', null);
    ok(res, publicServer(updated));
  }));
  r.delete('/v1/servers/:id', requireRole('it_administrator'), h((req, res) => {
    const srv = db.servers.find(x => x.id === req.params.id);
    if (!srv) return fail(res, 404, 'Server not found');
    const usedBy = db.applications.filter(a => a.prdServerId === srv.id || a.drServerId === srv.id);
    if (usedBy.length) return fail(res, 409, `Server is used by ${usedBy.map(a => a.name).join(', ')} — unlink it first`);
    const removedMonitors = db.monitors.filter(m => m.serverId === srv.id);
    db.monitors = db.monitors.filter(m => m.serverId !== srv.id);
    for (const m of removedMonitors) delete db.monitorBuckets[m.id];
    db.servers = db.servers.filter(x => x.id !== srv.id);
    void deleteServerMetrics(srv.id);
    persist();
    audit(operatorName(req), 'SERVER_REMOVED', 'INFRASTRUCTURE', srv.id, `${srv.hostname} (${srv.ip}) removed with ${removedMonitors.length} monitor(s)`);
    broadcast('servers_changed', null);
    broadcast('monitors_changed', null);
    ok(res, { deleted: true, removedMonitors: removedMonitors.length });
  }));
  r.get('/v1/servers/:id/agent', requireRole('it_administrator'), (req, res) => {
    const srv = db.servers.find(x => x.id === req.params.id);
    if (!srv) return fail(res, 404, 'Server not found');
    const base = publicBaseUrl(req);
    const url = `${base}/api/v1/agent/install/${srv.id}?key=${srv.agentToken}`;
    ok(res, {
      installCommand: `curl -fsSL '${url}' | sudo bash`,
      uninstallCommand: `curl -fsSL '${base}/api/v1/agent/uninstall' | sudo bash`,
      ingestUrl: `${base}/api/v1/agent/ingest`,
      agentVersion: AGENT_VERSION,
      publicUrlConfigured: Boolean(config.publicUrl),
    });
  });
  r.post('/v1/servers/:id/rotate-token', requireRole('it_administrator'), (req, res) => {
    const srv = db.servers.find(x => x.id === req.params.id);
    if (!srv) return fail(res, 404, 'Server not found');
    srv.agentToken = newToken();
    persist();
    audit(operatorName(req), 'AGENT_TOKEN_ROTATED', 'INFRASTRUCTURE', srv.id, `${srv.hostname}: old agent token revoked — reinstall the agent`);
    ok(res, { rotated: true });
  });

  // ── Applications ───────────────────────────────────────────────────────────
  r.get('/v1/applications', (_req, res) => { ok(res, db.applications); });
  r.get('/v1/applications/:id', (req, res) => {
    const a = db.applications.find(x => x.id === req.params.id);
    return a ? ok(res, a) : fail(res, 404, 'Application not found');
  });
  r.get('/v1/applications/:id/dr-readiness', (req, res) => {
    const a = db.applications.find(x => x.id === req.params.id);
    if (!a) return fail(res, 404, 'Application not found');
    const rd = readiness(a);
    ok(res, { appId: a.id, appName: a.name, failoverState: a.failoverState, checks: rd.checks, overall: rd.overall, overallReady: rd.overall === 'READY', passed: rd.passed, total: rd.total, evaluatedAt: rd.evaluatedAt });
  });
  r.get('/v1/applications/:id/availability', h(async (req, res) => {
    const a = db.applications.find(x => x.id === req.params.id);
    if (!a) return fail(res, 404, 'Application not found');
    const ranges: Record<string, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30, '90d': 24 * 90 };
    ok(res, await applicationAvailability(a, ranges[String(req.query.range ?? '24h')] ?? 24));
  }));
  r.get('/v1/applications/:id/failover/preflight', requireRole('operator'), (req, res) => {
    const a = db.applications.find(x => x.id === req.params.id);
    if (!a) return fail(res, 404, 'Application not found');
    const target = req.query.target === 'PRIMARY' ? 'PRIMARY' : 'DR';
    const pf = failoverPreflight(a, target);
    const failing = pf.checks.filter(c => c.status === 'FAIL').map(c => c.label);
    audit(operatorName(req), 'FAILOVER_PREFLIGHT_VIEWED', 'FAILOVER', a.id,
      `${a.name} → ${target}: ${failing.length ? 'FAILING checks: ' + failing.join(', ') : 'no failing checks'}`);
    ok(res, pf);
  });
  r.post('/v1/applications/:id/failover/decision', requireRole('super_admin'), h((req, res) => {
    const a = db.applications.find(x => x.id === req.params.id);
    if (!a) return fail(res, 404, 'Application not found');
    const b = body(req);
    const target = oneOf(b, 'target', 'Target', ['DR', 'PRIMARY'] as const);
    const decision = oneOf(b, 'decision', 'Decision', ['APPROVED', 'REJECTED'] as const);
    const reason = reqStr(b, 'reason', 'Reason', 1000);
    const pf = failoverPreflight(a, target);
    const failing = pf.checks.filter(c => c.status === 'FAIL').map(c => c.label);
    // Recording a decision never changes traffic: for LB-managed apps the switch is made in Cloudflare by the operator
    audit(operatorName(req), decision === 'APPROVED' ? 'FAILOVER_APPROVED' : 'FAILOVER_REJECTED', 'FAILOVER', a.id,
      `${a.name} → ${target} ${decision}. Reason: ${reason}. Pre-flight: ${failing.length ? 'FAILING ' + failing.join(', ') : 'no failing checks'}; target readiness ${pf.drOverall}. Mode: ${pf.mode}`);
    ok(res, { recorded: true, decision, preflight: pf });
  }));
  r.post('/v1/applications', requireRole('it_administrator'), h((req, res) => {
    const app = buildApplication(req);
    db.applications.push(app);
    for (const sid of [app.prdServerId, app.drServerId]) {
      const srv = db.servers.find(s => s.id === sid);
      if (srv && !srv.applicationId) srv.applicationId = app.id;
    }
    persist();
    const monitorChanges = syncAppUrlMonitors(app, operatorName(req));
    recomputeDerived();
    audit(operatorName(req), 'APPLICATION_CREATED', 'APPLICATION', app.id, `${app.name} (${app.codeName}) · PRD URL ${app.prdUrl || '—'} · DR URL ${app.drUrl || '—'} · LB ${app.loadBalancer ? `${app.loadBalancer.hostname} pools ${app.loadBalancer.prdPoolId}/${app.loadBalancer.drPoolId}` : '—'} · DNS ${app.dnsRecordName || '—'}${monitorChanges.length ? ` · monitors: ${monitorChanges.join('; ')}` : ''}`);
    broadcast('applications_changed', null);
    if (isCloudflareConfigured()) void syncCloudflare().catch(() => {});
    if (app.loadBalancer) void syncLoadBalancers().catch(() => {});
    ok(res, app, 201);
  }));
  r.patch('/v1/applications/:id', requireRole('it_administrator'), h((req, res) => {
    const idx = db.applications.findIndex(x => x.id === req.params.id);
    if (idx === -1) return fail(res, 404, 'Application not found');
    const before = db.applications[idx];
    const app = buildApplication(req, before);
    db.applications[idx] = app;
    persist();
    const monitorChanges = syncAppUrlMonitors(app, operatorName(req));
    recomputeDerived();
    const diff = (['name', 'codeName', 'tier', 'prdServerId', 'drServerId', 'rtoTargetMin', 'rpoTargetMin', 'prdUrl', 'drUrl', 'cloudflareZone', 'dnsRecordName', 'autoFailover'] as const)
      .filter(k => String(before[k] ?? '') !== String(app[k] ?? '')).map(k => `${k}: ${before[k] ?? '—'} → ${app[k] ?? '—'}`);
    if (JSON.stringify(before.loadBalancer ?? null) !== JSON.stringify(app.loadBalancer ?? null)) diff.push(`Cloudflare LB: ${before.loadBalancer ? JSON.stringify(before.loadBalancer) : '—'} → ${app.loadBalancer ? JSON.stringify(app.loadBalancer) : '—'}`);
    if (JSON.stringify(before.healthCheck ?? null) !== JSON.stringify(app.healthCheck ?? null)) diff.push(`health check: ${JSON.stringify(app.healthCheck)}`);
    if (JSON.stringify(before.environments ?? null) !== JSON.stringify(app.environments ?? null)) diff.push('environment details updated');
    audit(operatorName(req), 'APPLICATION_UPDATED', 'APPLICATION', app.id, `${app.name}: ${diff.join('; ') || 'no field changes'}${monitorChanges.length ? ` · monitors: ${monitorChanges.join('; ')}` : ''}`);
    broadcast('applications_changed', null);
    if (isCloudflareConfigured()) void syncCloudflare().catch(() => {});
    if (app.loadBalancer || before.loadBalancer) void syncLoadBalancers().catch(() => {});
    ok(res, app);
  }));
  r.delete('/v1/applications/:id', requireRole('it_administrator'), h((req, res) => {
    const app = db.applications.find(x => x.id === req.params.id);
    if (!app) return fail(res, 404, 'Application not found');
    const removed = db.monitors.filter(m => m.applicationId === app.id);
    db.monitors = db.monitors.filter(m => m.applicationId !== app.id);
    for (const m of removed) delete db.monitorBuckets[m.id];
    db.applications = db.applications.filter(a => a.id !== app.id);
    for (const s of db.servers) if (s.applicationId === app.id) s.applicationId = '';
    persist();
    audit(operatorName(req), 'APPLICATION_DELETED', 'APPLICATION', app.id, `${app.name} deleted with ${removed.length} monitor(s)`);
    broadcast('applications_changed', null);
    broadcast('monitors_changed', null);
    ok(res, { deleted: true, removedMonitors: removed.length });
  }));
  r.post('/v1/applications/:id/failover', requireRole('super_admin'), h(async (req, res) => {
    const app = db.applications.find(x => x.id === req.params.id);
    if (!app) return fail(res, 404, 'Application not found');
    const b = body(req);
    const target = oneOf(b, 'target', 'Target', ['DR', 'PRIMARY'] as const);
    const reason = optStr(b, 'reason', 'Reason', 500) || 'Manual failover';
    try {
      const result = await performFailover(app, target, operatorName(req), reason);
      ok(res, result);
    } catch (err) {
      if (err instanceof FailoverError) return fail(res, err.status, err.message);
      throw err;
    }
  }));

  // ── Monitors ───────────────────────────────────────────────────────────────
  r.get('/v1/monitors', (req, res) => { ok(res, db.monitors.map(m => monitorView(req, m))); });
  r.get('/v1/monitors/:id', (req, res) => {
    const m = db.monitors.find(x => x.id === req.params.id);
    return m ? ok(res, monitorView(req, m)) : fail(res, 404, 'Monitor not found');
  });
  r.post('/v1/monitors', requireRole('it_administrator'), h((req, res) => {
    const m = buildMonitor(req);
    db.monitors.unshift(m);
    registerNewMonitor(m);
    persist();
    audit(operatorName(req), 'MONITOR_CREATED', 'MONITOR', m.id, `${m.name} [${m.type}] → ${m.target} (${m.environment})`);
    broadcast('monitor_update', m);
    if (m.enabled && !PUSH_TYPES.includes(m.type)) void runMonitorNow(m);
    ok(res, m, 201);
  }));
  r.patch('/v1/monitors/:id', requireRole('it_administrator'), h((req, res) => {
    const idx = db.monitors.findIndex(x => x.id === req.params.id);
    if (idx === -1) return fail(res, 404, 'Monitor not found');
    const before = db.monitors[idx];
    const m = buildMonitor(req, before);
    if (m.type !== before.type || m.target !== before.target) {
      closeMonitorIncident(before, operatorName(req), `monitor reconfigured (${before.target} → ${m.target})`);
      m.status = 'UNKNOWN'; m.consecutiveFailures = 0; m.consecutiveRecoveries = 0; m.history = [];
      delete db.monitorBuckets[m.id];
    }
    db.monitors[idx] = m;
    persist();
    audit(operatorName(req), 'MONITOR_UPDATED', 'MONITOR', m.id, `${m.name} [${m.type}] → ${m.target}`);
    broadcast('monitor_update', m);
    if (m.enabled && !PUSH_TYPES.includes(m.type)) void runMonitorNow(m);
    ok(res, m);
  }));
  r.post('/v1/monitors/:id/toggle', requireRole('it_administrator'), (req, res) => {
    const m = db.monitors.find(x => x.id === req.params.id);
    if (!m) return fail(res, 404, 'Monitor not found');
    m.enabled = !m.enabled;
    if (!m.enabled) { closeMonitorIncident(m, operatorName(req), 'monitor paused'); m.status = 'UNKNOWN'; }
    persist();
    audit(operatorName(req), m.enabled ? 'MONITOR_RESUMED' : 'MONITOR_PAUSED', 'MONITOR', m.id, m.name);
    broadcast('monitor_update', m);
    recomputeDerived();
    if (m.enabled) void runMonitorNow(m);
    ok(res, m);
  });
  r.delete('/v1/monitors/:id', requireRole('it_administrator'), (req, res) => {
    const m = db.monitors.find(x => x.id === req.params.id);
    if (!m) return fail(res, 404, 'Monitor not found');
    closeMonitorIncident(m, operatorName(req), 'monitor deleted');
    db.monitors = db.monitors.filter(x => x.id !== m.id);
    delete db.monitorBuckets[m.id];
    persist();
    audit(operatorName(req), 'MONITOR_DELETED', 'MONITOR', m.id, `${m.name} (${m.target})`);
    broadcast('monitor_deleted', { id: m.id });
    recomputeDerived();
    ok(res, { deleted: true });
  });
  r.post('/v1/monitors/:id/probe', requireRole('operator'), h(async (req, res) => {
    const m = db.monitors.find(x => x.id === req.params.id);
    if (!m) return fail(res, 404, 'Monitor not found');
    const updated = await runMonitorNow(m);
    audit(operatorName(req), 'MONITOR_TRIGGERED', 'MONITOR', m.id, `${m.name}: ${updated.lastProbeStatus ?? updated.status} — ${updated.history[0]?.detail ?? ''}`);
    ok(res, monitorView(req, updated));
  }));
  r.get('/v1/monitors/:id/history', h(async (req, res) => {
    const m = db.monitors.find(x => x.id === req.params.id);
    if (!m) return fail(res, 404, 'Monitor not found');
    const ranges: Record<string, number> = { '1h': 1, '6h': 6, '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };
    const hours = ranges[String(req.query.range ?? '24h')] ?? 24;
    const recs = await readChecks(Date.now() - hours * 3600 * 1000, [m.id]);
    // Large ranges are downsampled into time buckets (real averages, nothing interpolated)
    const MAX = 720;
    if (recs.length <= MAX) return ok(res, { range: `${hours}h`, bucketSec: 0, points: recs });
    const bucketMs = Math.ceil((hours * 3600 * 1000) / MAX);
    const buckets = new Map<number, CheckRecord[]>();
    for (const rec of recs) {
      const k = Math.floor(Date.parse(rec.t) / bucketMs);
      const list = buckets.get(k);
      if (list) list.push(rec); else buckets.set(k, [rec]);
    }
    const points = [...buckets.entries()].sort((x, y) => x[0] - y[0]).map(([k, list]) => {
      const okList = list.filter(x => x.ok);
      const worst = list.find(x => !x.ok) ?? list[list.length - 1];
      return {
        ...worst,
        t: new Date(k * bucketMs).toISOString(),
        ok: okList.length === list.length,
        latencyMs: okList.length ? Math.round(okList.reduce((sum, x) => sum + x.latencyMs, 0) / okList.length) : worst.latencyMs,
        samples: list.length,
        okSamples: okList.length,
      };
    });
    ok(res, { range: `${hours}h`, bucketSec: Math.round(bucketMs / 1000), points });
  }));
  r.post('/v1/monitors/probe-all', requireRole('operator'), h(async (req, res) => {
    const targets = db.monitors.filter(m => m.enabled);
    await Promise.all(targets.map(m => runMonitorNow(m)));
    audit(operatorName(req), 'MONITORS_PROBED', 'MONITOR', 'all', `Manually ran ${targets.length} monitor(s)`);
    ok(res, db.monitors.map(m => monitorView(req, m)));
  }));

  // ── Diagnostic tools (live, nothing is stored) ─────────────────────────────
  r.post('/v1/tools/http', requireRole('operator'), h(async (req, res) => {
    const b = body(req);
    const url = reqStr(b, 'url', 'URL', 2000);
    const method = oneOf(b, 'method', 'Method', ['GET', 'HEAD', 'POST', 'PUT'] as const, 'GET');
    const timeoutSec = optInt(b, 'timeoutSec', 'Timeout', 1, 60) ?? 10;
    const result = await httpProbe(url, { timeoutMs: timeoutSec * 1000, method, body: optStr(b, 'body', 'Body', 100_000) });
    const { body: respBody, ...rest } = result;
    const expectedStatus = optInt(b, 'expectedStatus', 'Expected status', 100, 599);
    const matchText = optStr(b, 'matchText', 'Match text', 500);
    ok(res, {
      ...rest,
      expectedMatch: result.reachable && (expectedStatus ? result.statusCode === expectedStatus : (result.statusCode ?? 0) < 400) && (!matchText || respBody.includes(matchText)),
    });
  }));
  r.post('/v1/tools/tcp', requireRole('operator'), h(async (req, res) => {
    const b = body(req);
    const host = reqStr(b, 'host', 'Host', 253);
    if (!net.isIP(host) && !isHostname(host)) return fail(res, 400, 'Host must be an IP address or hostname');
    const port = optInt(b, 'port', 'Port', 1, 65535);
    if (!port) return fail(res, 400, 'Port is required');
    ok(res, await tcpProbe(host, port, (optInt(b, 'timeoutSec', 'Timeout', 1, 30) ?? 5) * 1000));
  }));
  r.post('/v1/tools/dns', requireRole('operator'), h(async (req, res) => {
    ok(res, await dnsProbe(reqStr(body(req), 'host', 'Host', 253), 5000));
  }));
  r.post('/v1/tools/ssl', requireRole('operator'), h(async (req, res) => {
    ok(res, await sslProbe(reqStr(body(req), 'host', 'Host', 260), 8000));
  }));

  // ── Incidents ──────────────────────────────────────────────────────────────
  const findIncident = (req: Request, res: Response): Incident | undefined => {
    const inc = db.incidents.find(i => i.id === req.params.id);
    if (!inc) fail(res, 404, 'Incident not found');
    return inc;
  };
  const event = (source: string, level: Incident['timeline'][number]['level'], message: string) =>
    ({ id: crypto.randomUUID(), timestamp: nowIso(), source, level, message });
  const saveIncident = (inc: Incident) => { persist(); broadcast('incident_update', inc); };

  r.get('/v1/incidents', (req, res) => { res.json(paginate(req, db.incidents, 500)); });
  r.get('/v1/incidents/:id', (req, res) => { const inc = findIncident(req, res); if (inc) ok(res, inc); });
  r.post('/v1/incidents', requireRole('operator'), h((req, res) => {
    const b = body(req);
    const applicationId = optStr(b, 'applicationId', 'Application', 64) ?? '';
    if (applicationId && !db.applications.some(a => a.id === applicationId)) return fail(res, 400, 'Application does not exist');
    const op = operatorName(req);
    const inc: Incident = {
      id: nextIncidentId(),
      title: reqStr(b, 'title', 'Title', 200),
      severity: oneOf(b, 'severity', 'Severity', SEVERITIES, 'HIGH'),
      status: 'OPEN',
      applicationId,
      environment: oneOf(b, 'environment', 'Environment', ENVS, 'PRD'),
      fingerprint: `manual:${crypto.randomUUID()}`,
      rootCause: optStr(b, 'description', 'Description', 4000) ?? '',
      startedAt: nowIso(),
      durationMinutes: 0,
      owner: op,
      acknowledged: true,
      acknowledgedAt: nowIso(),
      acknowledgedBy: op,
      affectedServices: [],
      affectedMonitors: [],
      dependentFailures: [],
      timeline: [event(op, 'WARN', 'Incident declared manually')],
      recoveryStatus: 'Investigating',
      notes: [],
    };
    db.incidents.unshift(inc);
    persist();
    broadcast('incident_created', inc);
    audit(op, 'INCIDENT_DECLARED', 'INCIDENT', inc.id, inc.title);
    notifyIncident(inc, 'FIRING');
    ok(res, inc, 201);
  }));
  r.post('/v1/incidents/:id/acknowledge', requireRole('operator'), (req, res) => {
    const inc = findIncident(req, res); if (!inc) return;
    const op = operatorName(req);
    inc.acknowledged = true;
    inc.acknowledgedAt = nowIso();
    inc.acknowledgedBy = op;
    if (inc.owner === 'Unassigned') inc.owner = op;
    if (inc.status === 'OPEN') inc.status = 'ACKNOWLEDGED';
    inc.timeline.push(event(op, 'INFO', `Acknowledged by ${op}`));
    saveIncident(inc);
    audit(op, 'INCIDENT_ACKNOWLEDGED', 'INCIDENT', inc.id, inc.title);
    ok(res, inc);
  });
  r.patch('/v1/incidents/:id/status', requireRole('operator'), h((req, res) => {
    const inc = findIncident(req, res); if (!inc) return;
    const status = oneOf(body(req), 'status', 'Status', INCIDENT_STATUSES);
    const op = operatorName(req);
    inc.status = status;
    if (status === 'RESOLVED' || status === 'CLOSED') {
      inc.resolvedAt ??= nowIso();
      inc.durationMinutes = Math.round((Date.parse(inc.resolvedAt) - Date.parse(inc.startedAt)) / 60000);
    } else {
      inc.resolvedAt = undefined;
    }
    inc.timeline.push(event(op, status === 'RESOLVED' ? 'SUCCESS' : 'INFO', `Status changed to ${status}`));
    saveIncident(inc);
    audit(op, 'INCIDENT_STATUS_CHANGED', 'INCIDENT', inc.id, `${inc.title} → ${status}`);
    ok(res, inc);
  }));
  r.patch('/v1/incidents/:id/severity', requireRole('operator'), h((req, res) => {
    const inc = findIncident(req, res); if (!inc) return;
    const severity = oneOf(body(req), 'severity', 'Severity', SEVERITIES);
    const op = operatorName(req);
    inc.timeline.push(event(op, 'WARN', `Severity changed ${inc.severity} → ${severity}`));
    inc.severity = severity;
    saveIncident(inc);
    audit(op, 'INCIDENT_SEVERITY_CHANGED', 'INCIDENT', inc.id, `${inc.title} → ${severity}`);
    ok(res, inc);
  }));
  r.patch('/v1/incidents/:id/assign', requireRole('operator'), h((req, res) => {
    const inc = findIncident(req, res); if (!inc) return;
    const owner = reqStr(body(req), 'owner', 'Owner', 120);
    const op = operatorName(req);
    inc.owner = owner;
    inc.timeline.push(event(op, 'INFO', `Assigned to ${owner}`));
    saveIncident(inc);
    audit(op, 'INCIDENT_ASSIGNED', 'INCIDENT', inc.id, `${inc.title} → ${owner}`);
    ok(res, inc);
  }));
  r.post('/v1/incidents/:id/notes', requireRole('operator'), h((req, res) => {
    const inc = findIncident(req, res); if (!inc) return;
    const content = reqStr(body(req), 'content', 'Note', 4000);
    const user = req.user!;
    const note = { id: crypto.randomUUID(), author: operatorName(req), role: user.roleName, timestamp: nowIso(), content };
    inc.notes.push(note);
    inc.timeline.push(event(note.author, 'INFO', `Note added: ${content.slice(0, 80)}${content.length > 80 ? '…' : ''}`));
    saveIncident(inc);
    ok(res, inc);
  }));
  r.post('/v1/incidents/:id/resolve', requireRole('operator'), h((req, res) => {
    const inc = findIncident(req, res); if (!inc) return;
    const summaryText = optStr(body(req), 'resolution', 'Resolution', 4000) || 'Resolved by operator';
    const op = operatorName(req);
    inc.status = 'RESOLVED';
    inc.resolvedAt = nowIso();
    inc.durationMinutes = Math.round((Date.parse(inc.resolvedAt) - Date.parse(inc.startedAt)) / 60000);
    inc.recoveryStatus = summaryText;
    inc.mitigationActionTaken = summaryText;
    inc.timeline.push(event(op, 'SUCCESS', `Resolved: ${summaryText}`));
    saveIncident(inc);
    audit(op, 'INCIDENT_RESOLVED', 'INCIDENT', inc.id, `${inc.title}: ${summaryText}`);
    notifyIncident(inc, 'RESOLVED', `Resolved by ${op}: ${summaryText}`);
    ok(res, inc);
  }));

  // ── Notification channels & escalation ─────────────────────────────────────
  const buildChannel = (req: Request, existing?: CommunicationChannel): CommunicationChannel => {
    const b = body(req);
    const type = existing ? (optOneOf(b, 'type', 'Type', CHANNEL_TYPES) ?? existing.type) : oneOf(b, 'type', 'Type', CHANNEL_TYPES);
    const target = existing ? (optStr(b, 'targetEndpoint', 'Target', 2000) ?? existing.targetEndpoint) : reqStr(b, 'targetEndpoint', 'Target', 2000);
    if (type === 'EMAIL') {
      const emails = target.split(/[,;\s]+/).filter(Boolean);
      if (!emails.length || !emails.every(isEmail)) throw new ValidationError('Enter one or more valid email addresses separated by commas');
    } else if (type === 'PAGERDUTY') {
      if (!/^[a-zA-Z0-9]{20,64}$/.test(target)) throw new ValidationError('Enter the PagerDuty Events v2 integration (routing) key');
    } else if (!/^https:\/\/\S+$/.test(target)) {
      throw new ValidationError('Webhook URL must start with https://');
    }
    return {
      id: existing?.id ?? crypto.randomUUID(),
      name: existing ? (optStr(b, 'name', 'Name', 120) ?? existing.name) : reqStr(b, 'name', 'Name', 120),
      type,
      enabled: optBool(b, 'enabled') ?? existing?.enabled ?? true,
      targetEndpoint: target,
      lastDeliveryAt: existing?.lastDeliveryAt ?? '',
      lastDeliveryStatus: existing?.lastDeliveryStatus ?? 'PENDING',
      failureCount: existing?.failureCount ?? 0,
    };
  };
  r.get('/v1/channels', (req, res) => {
    ok(res, isAdmin(req) ? db.channels : db.channels.map(c => ({ ...c, targetEndpoint: c.targetEndpoint ? '••••••' : '' })));
  });
  r.post('/v1/channels', requireRole('it_administrator'), h((req, res) => {
    const ch = buildChannel(req);
    db.channels.push(ch);
    persist();
    audit(operatorName(req), 'CHANNEL_CREATED', 'NOTIFICATION', ch.id, `${ch.type} channel ${ch.name}`);
    broadcast('channels_changed', null);
    ok(res, ch, 201);
  }));
  r.patch('/v1/channels/:id', requireRole('it_administrator'), h((req, res) => {
    const idx = db.channels.findIndex(c => c.id === req.params.id);
    if (idx === -1) return fail(res, 404, 'Channel not found');
    db.channels[idx] = buildChannel(req, db.channels[idx]);
    persist();
    audit(operatorName(req), 'CHANNEL_UPDATED', 'NOTIFICATION', db.channels[idx].id, db.channels[idx].name);
    broadcast('channels_changed', null);
    ok(res, db.channels[idx]);
  }));
  r.delete('/v1/channels/:id', requireRole('it_administrator'), (req, res) => {
    const ch = db.channels.find(c => c.id === req.params.id);
    if (!ch) return fail(res, 404, 'Channel not found');
    db.channels = db.channels.filter(c => c.id !== ch.id);
    for (const p of db.escalationPolicies) p.channels = p.channels.filter(id => id !== ch.id);
    persist();
    audit(operatorName(req), 'CHANNEL_DELETED', 'NOTIFICATION', ch.id, ch.name);
    broadcast('channels_changed', null);
    ok(res, { deleted: true });
  });
  r.post('/v1/channels/:id/test', requireRole('operator'), h(async (req, res) => {
    const ch = db.channels.find(c => c.id === req.params.id);
    if (!ch) return fail(res, 404, 'Channel not found');
    const result = await sendToChannel(ch, {
      title: 'Scholario Ops test notification',
      text: `Test message sent by ${operatorName(req)} at ${new Date().toUTCString()}.`,
      severity: 'INFO',
      status: 'TEST',
    });
    audit(operatorName(req), result.ok ? 'CHANNEL_TEST_DELIVERED' : 'CHANNEL_TEST_FAILED', 'NOTIFICATION', ch.id, result.ok ? ch.name : `${ch.name}: ${result.error}`);
    if (!result.ok) return fail(res, 502, `Delivery failed: ${result.error}`);
    ok(res, ch);
  }));
  r.get('/v1/escalation-policies', (_req, res) => { ok(res, db.escalationPolicies); });
  r.put('/v1/escalation-policies', requireRole('it_administrator'), h((req, res) => {
    const list = (req.body as { policies?: unknown }).policies;
    if (!Array.isArray(list)) return fail(res, 400, 'policies must be a list');
    const policies: EscalationPolicy[] = list.map(raw => {
      const b = (raw ?? {}) as Record<string, unknown>;
      const severity = oneOf(b, 'severity', 'Severity', SEVERITIES);
      const channels = strArray(b, 'channels', 'Channels') ?? [];
      if (channels.some(id => !db.channels.some(c => c.id === id))) throw new ValidationError('Policy references an unknown channel');
      return {
        id: optStr(b, 'id', 'id', 64) || crypto.randomUUID(),
        severity,
        channels,
        initialDelayMin: optInt(b, 'initialDelayMin', 'Initial delay', 0, 1440) ?? 0,
        repeatIntervalMin: optInt(b, 'repeatIntervalMin', 'Repeat interval', 0, 1440) ?? 0,
        autoEscalateAfterMin: optInt(b, 'autoEscalateAfterMin', 'Auto-escalate', 0, 1440) ?? 0,
        escalateToTeam: optStr(b, 'escalateToTeam', 'Escalate to', 120) ?? '',
      };
    });
    if (new Set(policies.map(p => p.severity)).size !== policies.length) return fail(res, 400, 'Only one policy per severity is allowed');
    db.escalationPolicies = policies;
    persist();
    audit(operatorName(req), 'ESCALATION_POLICIES_UPDATED', 'NOTIFICATION', 'policies', `${policies.length} policies saved`);
    broadcast('channels_changed', null);
    ok(res, policies);
  }));

  // ── Maintenance windows ────────────────────────────────────────────────────
  r.get('/v1/maintenance', (_req, res) => { ok(res, db.maintenanceWindows); });
  r.post('/v1/maintenance', requireRole('operator'), h((req, res) => {
    const b = body(req);
    const startTime = optDate(b, 'startTime', 'Start time');
    const endTime = optDate(b, 'endTime', 'End time');
    if (!startTime || !endTime) return fail(res, 400, 'Start and end time are required');
    if (Date.parse(endTime) <= Date.parse(startTime)) return fail(res, 400, 'End time must be after start time');
    const applicationId = optStr(b, 'applicationId', 'Application', 64) ?? '';
    if (applicationId && !db.applications.some(a => a.id === applicationId)) return fail(res, 400, 'Application does not exist');
    const suppress = strArray(b, 'suppressMonitors', 'Monitors') ?? [];
    if (suppress.some(id => !db.monitors.some(m => m.id === id))) return fail(res, 400, 'Unknown monitor in suppression list');
    if (!applicationId && suppress.length === 0) return fail(res, 400, 'Choose an application or specific monitors to suppress');
    const w: MaintenanceWindow = {
      id: crypto.randomUUID(),
      title: reqStr(b, 'title', 'Title', 200),
      applicationId,
      environment: oneOf(b, 'environment', 'Environment', ENVS, 'PRD'),
      startTime,
      endTime,
      expectedImpact: optStr(b, 'expectedImpact', 'Expected impact', 1000) ?? '',
      suppressMonitors: suppress,
      status: Date.now() < Date.parse(startTime) ? 'SCHEDULED' : 'IN_PROGRESS',
      approvedBy: operatorName(req),
      reason: optStr(b, 'reason', 'Reason', 1000) ?? '',
    };
    db.maintenanceWindows.unshift(w);
    persist();
    audit(operatorName(req), 'MAINTENANCE_SCHEDULED', 'MAINTENANCE', w.id, `${w.title} ${w.startTime} → ${w.endTime}`);
    broadcast('maintenance_update', w);
    ok(res, w, 201);
  }));
  r.post('/v1/maintenance/:id/complete', requireRole('operator'), (req, res) => {
    const w = db.maintenanceWindows.find(x => x.id === req.params.id);
    if (!w) return fail(res, 404, 'Maintenance window not found');
    w.status = 'COMPLETED';
    if (Date.parse(w.endTime) > Date.now()) w.endTime = nowIso();
    persist();
    audit(operatorName(req), 'MAINTENANCE_COMPLETED', 'MAINTENANCE', w.id, w.title);
    broadcast('maintenance_update', w);
    ok(res, w);
  });
  r.delete('/v1/maintenance/:id', requireRole('it_administrator'), (req, res) => {
    const w = db.maintenanceWindows.find(x => x.id === req.params.id);
    if (!w) return fail(res, 404, 'Maintenance window not found');
    db.maintenanceWindows = db.maintenanceWindows.filter(x => x.id !== w.id);
    persist();
    audit(operatorName(req), 'MAINTENANCE_DELETED', 'MAINTENANCE', w.id, w.title);
    broadcast('maintenance_deleted', { id: w.id });
    ok(res, { deleted: true });
  });

  // ── Runbooks ───────────────────────────────────────────────────────────────
  const buildRunbook = (req: Request, existing?: Runbook): Runbook => {
    const b = body(req);
    const rawSteps = b.steps;
    let steps = existing?.steps ?? [];
    if (rawSteps !== undefined) {
      if (!Array.isArray(rawSteps) || rawSteps.length === 0) throw new ValidationError('A runbook needs at least one step');
      steps = rawSteps.slice(0, 50).map((s, i) => {
        const o = (s ?? {}) as Record<string, unknown>;
        return { id: i + 1, title: reqStr(o, 'title', `Step ${i + 1} title`, 200), instruction: optStr(o, 'instruction', 'Instruction', 4000) ?? '', command: optStr(o, 'command', 'Command', 2000) || undefined, completed: false };
      });
    }
    if (steps.length === 0) throw new ValidationError('A runbook needs at least one step');
    return {
      id: existing?.id ?? crypto.randomUUID(),
      title: existing ? (optStr(b, 'title', 'Title', 200) ?? existing.title) : reqStr(b, 'title', 'Title', 200),
      description: b.description !== undefined ? (optStr(b, 'description', 'Description', 2000) ?? '') : existing?.description ?? '',
      category: optOneOf(b, 'category', 'Category', ['DATABASE', 'FAILOVER', 'WEB_SERVER', 'PERFORMANCE', 'DEAD_MAN'] as const) ?? existing?.category ?? 'WEB_SERVER',
      estimatedDurationMin: optInt(b, 'estimatedDurationMin', 'Duration', 1, 1440) ?? existing?.estimatedDurationMin ?? 15,
      steps,
    };
  };
  r.get('/v1/runbooks', (_req, res) => { ok(res, db.runbooks); });
  r.post('/v1/runbooks', requireRole('it_administrator'), h((req, res) => {
    const rb = buildRunbook(req);
    db.runbooks.push(rb);
    persist();
    audit(operatorName(req), 'RUNBOOK_CREATED', 'RUNBOOK', rb.id, rb.title);
    broadcast('runbooks_changed', null);
    ok(res, rb, 201);
  }));
  r.patch('/v1/runbooks/:id', requireRole('it_administrator'), h((req, res) => {
    const idx = db.runbooks.findIndex(x => x.id === req.params.id);
    if (idx === -1) return fail(res, 404, 'Runbook not found');
    db.runbooks[idx] = buildRunbook(req, db.runbooks[idx]);
    persist();
    audit(operatorName(req), 'RUNBOOK_UPDATED', 'RUNBOOK', req.params.id, db.runbooks[idx].title);
    broadcast('runbooks_changed', null);
    ok(res, db.runbooks[idx]);
  }));
  r.delete('/v1/runbooks/:id', requireRole('it_administrator'), (req, res) => {
    const rb = db.runbooks.find(x => x.id === req.params.id);
    if (!rb) return fail(res, 404, 'Runbook not found');
    db.runbooks = db.runbooks.filter(x => x.id !== rb.id);
    for (const m of db.monitors) if (m.runbookId === rb.id) m.runbookId = undefined;
    persist();
    audit(operatorName(req), 'RUNBOOK_DELETED', 'RUNBOOK', rb.id, rb.title);
    broadcast('runbooks_changed', null);
    ok(res, { deleted: true });
  });
  r.post('/v1/runbooks/:id/steps/:stepId/toggle', requireRole('operator'), (req, res) => {
    const rb = db.runbooks.find(x => x.id === req.params.id);
    const step = rb?.steps.find(s => s.id === Number(req.params.stepId));
    if (!rb || !step) return fail(res, 404, 'Runbook step not found');
    step.completed = !step.completed;
    step.completedAt = step.completed ? nowIso() : undefined;
    step.completedBy = step.completed ? operatorName(req) : undefined;
    persist();
    audit(operatorName(req), step.completed ? 'RUNBOOK_STEP_DONE' : 'RUNBOOK_STEP_REOPENED', 'RUNBOOK', rb.id, `${rb.title} · step ${step.id}: ${step.title}`);
    broadcast('runbooks_changed', null);
    ok(res, rb);
  });
  r.post('/v1/runbooks/:id/reset', requireRole('operator'), (req, res) => {
    const rb = db.runbooks.find(x => x.id === req.params.id);
    if (!rb) return fail(res, 404, 'Runbook not found');
    for (const s of rb.steps) { s.completed = false; s.completedAt = undefined; s.completedBy = undefined; }
    persist();
    broadcast('runbooks_changed', null);
    ok(res, rb);
  });

  // ── Deployments & backups (read; written by CI / agents above) ─────────────
  r.get('/v1/deployments', (req, res) => { res.json(paginate(req, db.deployments, 200)); });
  r.get('/v1/backups/status', (_req, res) => { ok(res, db.applications.map(a => backupStatus(a))); });
  // `data` keeps its original shape (a list); `summary` is an additive sibling
  r.get('/v1/health/databases', (_req, res) => {
    const rows = db.applications.flatMap(a => (['PRD', 'DR'] as const).map(env => {
      const d = databaseHealth(a, env);
      return { applicationId: a.id, applicationName: a.name, environment: env, status: d.status, detail: d.detail, report: d.report, observedAt: d.observedAt };
    }));
    const count = (pred: (r: typeof rows[number]) => boolean) => rows.filter(pred).length;
    res.json({
      success: true, data: rows,
      summary: {
        total: rows.length,
        healthy: count(r => r.status === 'HEALTHY'),
        warning: count(r => r.status === 'DEGRADED'),
        critical: count(r => r.status === 'DOWN'),
        unavailable: count(r => r.status === 'UNKNOWN'),
        notConfigured: count(r => r.status === 'NOT_CONFIGURED'),
      },
    });
  });
  r.get('/v1/health/agents', (_req, res) => {
    const rows = db.servers.map(s => {
      const a = agentHealth(s);
      const { warnings } = serverHealth(s);
      return {
        serverId: s.id, hostname: s.hostname, ip: s.ip, environment: s.environment, state: agentState(s), version: s.agentVersion || null,
        lastSeen: s.lastSeen || null, startedAt: s.agentStartedAt ?? null, restartCount: s.agentRestartCount ?? 0, errors: s.agentErrors ?? [],
        expectedVersion: AGENT_VERSION, outdated: a.outdated, clockSkewMs: a.clockSkewMs, transportDelayMs: a.transportDelayMs,
        ntpSynchronized: s.ntp?.synchronized ?? null,
        clockIssue: warnings.some(w => w.category === 'time'),
        failedServices: s.services.filter(x => x.status === 'failed').length,
        pm2Issues: (s.pm2 ?? []).filter(p => p.status !== 'online').length + warnings.filter(w => w.key.startsWith('pm2-restarts:')).length,
        dbIssues: warnings.filter(w => w.category === 'database').length,
        warnings: warnings.length,
        critical: warnings.filter(w => w.level === 'CRITICAL').length,
      };
    });
    const n = (pred: (r: typeof rows[number]) => boolean) => rows.filter(pred).length;
    res.json({
      success: true, data: rows,
      summary: {
        expectedVersion: AGENT_VERSION,
        total: rows.length,
        connected: n(r => r.state === 'ONLINE'),
        stale: n(r => r.state === 'STALE'),
        disconnected: n(r => r.state === 'OFFLINE'),
        neverConnected: n(r => r.state === 'NOT_CONNECTED'),
        outdated: n(r => r.outdated === true),
        clockIssues: n(r => r.clockIssue),
        withErrors: n(r => r.errors.length > 0),
        failedServices: rows.reduce((a, r) => a + r.failedServices, 0),
        pm2Issues: rows.reduce((a, r) => a + r.pm2Issues, 0),
        dbIssues: rows.reduce((a, r) => a + r.dbIssues, 0),
      },
    });
  });
  r.get('/v1/backups', (req, res) => { res.json(paginate(req, db.backups, 200)); });

  // ── Cloudflare / Hostinger ─────────────────────────────────────────────────
  r.get('/v1/cloudflare/zones', (req, res) => {
    res.json({ success: true, configured: isCloudflareConfigured(), lastSyncAt: cfState.lastSyncAt, lastError: cfState.lastError, data: cfState.zones });
  });
  r.post('/v1/cloudflare/sync', requireRole('operator'), h(async (req, res) => {
    if (!isCloudflareConfigured()) return fail(res, 400, 'Cloudflare is not configured — set CLOUDFLARE_API_TOKEN in .env and restart');
    try {
      await syncCloudflare();
      void syncLoadBalancers('manual').catch(() => {});
    } catch (err) {
      audit(operatorName(req), 'CLOUDFLARE_SYNC_FAILED', 'CLOUDFLARE', 'zones', (err as Error).message);
      if (err instanceof CloudflareError) return fail(res, 502, err.message);
      throw err;
    }
    audit(operatorName(req), 'CLOUDFLARE_SYNC', 'CLOUDFLARE', 'zones', `${cfState.zones.length} zone(s) synchronised`);
    ok(res, cfState.zones);
  }));
  r.get('/v1/loadbalancers', (_req, res) => { ok(res, lbState); });
  const cfFail = (res: Response, err: unknown) => {
    if (err instanceof CloudflareError && err.isPermission) return fail(res, 403, PERMISSION_HINT);
    return fail(res, 502, (err as Error).message);
  };
  r.get('/v1/cloudflare/accounts', requireRole('it_administrator'), h(async (_req, res) => {
    if (!isCloudflareConfigured()) return fail(res, 400, 'Cloudflare is not configured — set CLOUDFLARE_API_TOKEN in the server .env and restart');
    try { ok(res, await listCloudflareAccounts()); } catch (err) { cfFail(res, err); }
  }));
  r.get('/v1/cloudflare/lb-pools', requireRole('it_administrator'), h(async (req, res) => {
    if (!isCloudflareConfigured()) return fail(res, 400, 'Cloudflare is not configured — set CLOUDFLARE_API_TOKEN in the server .env and restart');
    const accountId = String(req.query.accountId ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(accountId)) return fail(res, 400, 'Enter the 32-character Cloudflare Account ID first');
    try {
      const pools = await listLoadBalancerPools(accountId);
      audit(operatorName(req), 'CLOUDFLARE_POOLS_LISTED', 'CLOUDFLARE', accountId, `${pools.length} pool(s) read for configuration`);
      ok(res, pools);
    } catch (err) { cfFail(res, err); }
  }));
  r.post('/v1/loadbalancers/sync', requireRole('operator'), h(async (_req, res) => {
    ok(res, await syncLoadBalancers('manual'));
  }));
  r.get('/v1/hostinger/vms', (_req, res) => {
    res.json({ success: true, configured: isHostingerConfigured(), status: hostingerState.status, lastSyncAt: hostingerState.lastSyncAt, lastSuccessAt: hostingerState.lastSuccessAt, lastError: hostingerState.lastError, data: hostingerState.vms });
  });
  r.post('/v1/hostinger/sync', requireRole('operator'), h(async (_req, res) => {
    if (!isHostingerConfigured()) return fail(res, 400, 'Hostinger is not configured — set HOSTINGER_API_TOKEN in .env and restart');
    try {
      await syncHostinger();
    } catch (err) {
      return fail(res, 502, (err as Error).message);
    }
    ok(res, hostingerState.vms);
  }));

  // ── Users ──────────────────────────────────────────────────────────────────
  r.get('/v1/users', requireRole('it_administrator'), (req, res) => { res.json(paginate(req, db.users.map(safeUser), 100)); });
  r.post('/v1/users', requireRole('it_administrator'), h((req, res) => {
    const b = body(req);
    const email = reqStr(b, 'email', 'Email', 254).toLowerCase();
    if (!isEmail(email)) return fail(res, 400, 'Email is not valid');
    if (db.users.some(u => u.email === email)) return fail(res, 409, 'A user with this email already exists');
    const password = String(b.password ?? '');
    const pwErr = validatePasswordStrength(password);
    if (pwErr) return fail(res, 400, pwErr);
    const roleName = oneOf(b, 'roleName', 'Role', ROLES, 'viewer');
    if (roleName === 'super_admin' && req.user!.roleName !== 'super_admin') return fail(res, 403, 'Only a super admin can create super admins');
    const fullName = reqStr(b, 'fullName', 'Full name', 120);
    const user: UserRecord = {
      id: crypto.randomUUID(),
      email,
      fullName,
      displayName: optStr(b, 'displayName', 'Display name', 60) || fullName,
      roleName,
      isActive: true,
      isOnCall: optBool(b, 'isOnCall') ?? false,
      createdAt: nowIso(),
      lastLoginAt: null,
      passwordHash: hashPassword(password),
      tokenVersion: 0,
    };
    db.users.push(user);
    persist();
    audit(operatorName(req), 'USER_CREATED', 'USER', user.id, `${email} as ${roleName}`);
    ok(res, safeUser(user), 201);
  }));
  r.patch('/v1/users/:id', requireRole('it_administrator'), h((req, res) => {
    const user = db.users.find(u => u.id === req.params.id);
    if (!user) return fail(res, 404, 'User not found');
    const b = body(req);
    const me = req.user!;
    const roleName = optOneOf(b, 'roleName', 'Role', ROLES);
    if ((roleName === 'super_admin' || user.roleName === 'super_admin') && me.roleName !== 'super_admin' && roleName !== undefined && roleName !== user.roleName) {
      return fail(res, 403, 'Only a super admin can change super admin roles');
    }
    const isActive = optBool(b, 'isActive');
    if (user.id === me.id && (isActive === false || (roleName && roleName !== user.roleName))) return fail(res, 400, 'You cannot deactivate or change the role of your own account');
    const remainingSupers = db.users.filter(u => u.roleName === 'super_admin' && u.isActive && u.id !== user.id).length;
    if (user.roleName === 'super_admin' && remainingSupers === 0 && ((roleName && roleName !== 'super_admin') || isActive === false)) {
      return fail(res, 400, 'At least one active super admin must remain');
    }
    if (roleName) user.roleName = roleName;
    if (isActive !== undefined) { user.isActive = isActive; if (!isActive) user.tokenVersion += 1; }
    const isOnCall = optBool(b, 'isOnCall'); if (isOnCall !== undefined) user.isOnCall = isOnCall;
    const fullName = optStr(b, 'fullName', 'Full name', 120); if (fullName) user.fullName = fullName;
    const displayName = optStr(b, 'displayName', 'Display name', 60); if (displayName) user.displayName = displayName;
    if (b.password !== undefined) {
      const pwErr = validatePasswordStrength(String(b.password));
      if (pwErr) return fail(res, 400, pwErr);
      user.passwordHash = hashPassword(String(b.password));
      user.tokenVersion += 1;
    }
    persist();
    audit(operatorName(req), 'USER_UPDATED', 'USER', user.id, `${user.email}: role ${user.roleName}, active ${user.isActive}`);
    ok(res, safeUser(user));
  }));
  r.delete('/v1/users/:id', requireRole('super_admin'), (req, res) => {
    const user = db.users.find(u => u.id === req.params.id);
    if (!user) return fail(res, 404, 'User not found');
    if (user.id === req.user!.id) return fail(res, 400, 'You cannot delete your own account');
    db.users = db.users.filter(u => u.id !== user.id);
    db.refreshTokens = db.refreshTokens.filter(t => t.userId !== user.id);
    persist();
    audit(operatorName(req), 'USER_DELETED', 'USER', user.id, user.email);
    ok(res, { deleted: true });
  });

  // ── Audit & reports ────────────────────────────────────────────────────────
  r.get('/v1/audit', (req, res) => {
    const category = String(req.query.category ?? '');
    const q = String(req.query.q ?? '').toLowerCase();
    let list = db.auditLogs;
    if (category) list = list.filter(l => l.category === category);
    if (q) list = list.filter(l => `${l.action} ${l.details} ${l.operator} ${l.targetId}`.toLowerCase().includes(q));
    res.json(paginate(req, list, 50));
  });
  r.get('/v1/reports/summary', (_req, res) => { ok(res, summary()); });
  r.get('/v1/reports/uptime', (_req, res) => {
    ok(res, db.applications.map(a => ({ id: a.id, name: a.name, uptime24h: a.uptime24h, uptime7d: a.uptime7d, uptime30d: a.uptime30d })));
  });
  r.get('/v1/reports/daily', (_req, res) => {
    const s = summary();
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const recent = db.incidents.filter(i => Date.parse(i.startedAt) > dayAgo);
    const fmt = (v: number | null) => (v === null ? 'no data' : `${v}%`);
    const lines = [
      'SCHOLARIO OPS — DAILY OPERATIONS REPORT',
      `Generated: ${new Date().toUTCString()}`,
      '',
      `Overall health:   ${s.overallHealth}`,
      `Applications:     ${s.healthyApps}/${s.totalApps} healthy`,
      `Servers:          ${s.healthyServers}/${s.totalServers} healthy, ${db.servers.filter(x => x.agentStatus === 'CONNECTED').length} agents connected`,
      `Monitors:         ${s.healthyMonitors}/${s.totalMonitors} passing`,
      `Open incidents:   ${s.openIncidents} (${s.criticalIncidents} critical)`,
      `DR ready:         ${s.drReadinessCount}/${s.totalApps} applications`,
      `Cloudflare:       ${isCloudflareConfigured() ? s.cloudflareStatus : 'not configured'}`,
      `Load balancing:   ${lbState.status}${lbState.lastSyncAt ? ` (last sync ${lbState.lastSyncAt})` : ''}`,
      ...lbState.pools.map(p => {
        const o = p.origins[0];
        const rtt = o?.health.map(x => x.rttMs).filter(x => x !== null) ?? [];
        return `  pool ${(p.name || p.id).padEnd(20)} ${p.role.padEnd(3)} enabled=${p.enabled ?? '?'} healthy=${p.healthy ?? '?'} origin ${o?.address ?? '—'} ${rtt.length ? `rtt ${rtt.join('/')}ms` : 'rtt n/a'}`;
      }),
      `Dead-man switch:  ${deadMan.status}`,
      '',
      'APPLICATION UPTIME (24h / 7d / 30d)',
      ...db.applications.map(a => `  ${a.name.padEnd(28)} ${fmt(a.uptime24h)} / ${fmt(a.uptime7d)} / ${fmt(a.uptime30d)}  [${a.failoverState}]`),
      '',
      `INCIDENTS IN LAST 24H (${recent.length})`,
      ...recent.map(i => `  ${i.id} ${i.severity.padEnd(9)} ${i.status.padEnd(13)} ${i.title} (${i.durationMinutes} min)`),
      '',
      'SERVERS',
      ...db.servers.map(x => `  ${x.hostname.padEnd(30)} ${x.ip.padEnd(16)} ${x.environment} ${x.status.padEnd(9)} agent ${x.agentStatus}  cpu ${x.telemetry.cpuPercent}% ram ${x.telemetry.ramPercent}% disk ${x.telemetry.diskPercent}%`),
    ];
    ok(res, { report: lines.join('\n'), generatedAt: nowIso() });
  });

  // ── Errors ─────────────────────────────────────────────────────────────────
  r.use((_req, res) => { fail(res, 404, 'API endpoint not found'); });
  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) return fail(res, 400, err.message);
    if ((err as { type?: string }).type === 'entity.parse.failed') return fail(res, 400, 'Request body is not valid JSON');
    log.error('api', 'unhandled error', { error: err as Error });
    fail(res, 500, 'Internal server error');
  });

  return r;
}

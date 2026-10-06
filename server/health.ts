/**
 * Health evaluation shared by DR readiness, alerts and the API.
 * Every function derives its answer from real evidence (monitor checks, agent reports,
 * backup reports, Cloudflare state). Missing evidence is UNKNOWN or NOT_CONFIGURED — never healthy.
 */
import { Application, BackupStatus, DatabaseHealth, DatabaseReport, EnvironmentInventory, Monitor } from '../src/types/index.ts';
import { config } from './config.ts';
import { db, ServerRecord } from './store.ts';

export type Env = 'PRD' | 'DR';
export type AgentState = 'ONLINE' | 'STALE' | 'OFFLINE' | 'NOT_CONNECTED';
export type AppHealth = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'UNKNOWN' | 'NOT_CONFIGURED';

const HTTP_MONITOR_TYPES: Monitor['type'][] = ['HTTP', 'HTTPS', 'APP_HEALTH', 'APP_READINESS', 'API_BUSINESS'];

export function serverFor(app: Application, env: Env): ServerRecord | undefined {
  return db.servers.find(s => s.id === (env === 'PRD' ? app.prdServerId : app.drServerId));
}

export function inventoryFor(app: Application, env: Env): EnvironmentInventory | undefined {
  return app.environments?.[env];
}

/** ONLINE = reporting now; STALE = missed a few reports; OFFLINE = stopped reporting; NOT_CONNECTED = never reported. */
export function agentState(srv: ServerRecord | undefined): AgentState {
  if (!srv || !srv.lastSeen) return 'NOT_CONNECTED';
  return srv.agentStatus === 'CONNECTED' ? 'ONLINE' : srv.agentStatus === 'STALE' ? 'STALE' : 'OFFLINE';
}

/** The application URL monitor of an environment (managed from the app URL first, then any HTTP monitor). */
export function urlMonitor(app: Application, env: Env): Monitor | undefined {
  const mons = db.monitors.filter(m => m.enabled && m.applicationId === app.id && m.environment === env && HTTP_MONITOR_TYPES.includes(m.type));
  return mons.find(m => m.managedBy === 'app-url') ?? mons[0];
}

export function sslMonitor(app: Application, env: Env): Monitor | undefined {
  const mons = db.monitors.filter(m => m.enabled && m.applicationId === app.id && m.environment === env && m.type === 'SSL');
  return mons.find(m => m.managedBy === 'app-ssl') ?? mons[0];
}

export function appHealth(app: Application, env: Env): { status: AppHealth; detail: string; observedAt: string | null } {
  const m = urlMonitor(app, env);
  if (!m) return { status: 'NOT_CONFIGURED', detail: `No ${env} application URL configured`, observedAt: null };
  if (!m.lastCheck || !m.lastProbeStatus) return { status: 'UNKNOWN', detail: `${m.name}: not checked yet`, observedAt: null };
  const detail = `${m.name}: ${m.lastProbeStatus}${m.lastStatusCode ? ` HTTP ${m.lastStatusCode}` : ''} — ${m.history[0]?.detail ?? ''}`;
  const status: AppHealth = m.status === 'HEALTHY' ? 'HEALTHY' : m.status === 'CRITICAL' ? 'DOWN' : m.status === 'WARNING' ? 'DEGRADED' : 'UNKNOWN';
  return { status, detail, observedAt: m.lastCheck };
}

/** Database health of an environment, from the agent's probe on that environment's server. */
export function databaseHealth(app: Application, env: Env): { status: DatabaseHealth; detail: string; report: DatabaseReport | null; observedAt: string | null } {
  const inv = inventoryFor(app, env);
  if (!inv?.dbEngine) return { status: 'NOT_CONFIGURED', detail: `Database type for ${env} not configured (Setup → application → environment details)`, report: null, observedAt: null };
  const srv = serverFor(app, env);
  if (!srv) return { status: 'NOT_CONFIGURED', detail: `No ${env} server linked`, report: null, observedAt: null };
  const state = agentState(srv);
  const report = (srv.databases ?? []).find(d => d.engine === inv.dbEngine || (inv.dbEngine !== 'postgresql' && d.engine !== 'postgresql')) ?? null;
  if (state === 'NOT_CONNECTED') return { status: 'UNKNOWN', detail: `Agent not installed on ${srv.ip} — no database probe`, report: null, observedAt: null };
  if (!report) return { status: 'UNKNOWN', detail: `Agent on ${srv.ip} reports no ${inv.dbEngine} probe — set DB_ENGINE in /etc/scholario-agent.conf`, report: null, observedAt: null };
  const staleMs = config.telemetryStaleSec * 6 * 1000;
  if (state !== 'ONLINE' || Date.now() - Date.parse(report.observedAt) > staleMs) {
    return { status: 'UNKNOWN', detail: `Last database probe ${report.observedAt} is stale (agent ${state})`, report, observedAt: report.observedAt };
  }
  if (!report.available) return { status: 'DOWN', detail: `${report.engine} unavailable: ${report.error ?? 'no error text'}`, report, observedAt: report.observedAt };
  const issues: string[] = [];
  if (report.maxConnections && report.connections !== null && report.connections / report.maxConnections >= 0.9) issues.push(`connections ${report.connections}/${report.maxConnections}`);
  if (report.longRunningQueries) issues.push(`${report.longRunningQueries} query(ies) running > 60 s`);
  const maxLag = inv.replicationMaxLagSec ?? config.replicationMaxLagSec;
  if (report.replication && report.replication.role === 'replica') {
    if (report.replication.state !== 'running') issues.push(`replication ${report.replication.state}${report.replication.error ? `: ${report.replication.error}` : ''}`);
    else if (report.replication.lagSec !== null && report.replication.lagSec > maxLag) issues.push(`replication lag ${report.replication.lagSec}s > ${maxLag}s`);
  }
  const base = `${report.engine} ${report.version ?? ''} up (${report.latencyMs ?? '?'} ms)`.replace(/\s+/g, ' ');
  return { status: issues.length ? 'DEGRADED' : 'HEALTHY', detail: issues.length ? `${base} — ${issues.join('; ')}` : base, report, observedAt: report.observedAt };
}

/** Most recent backup for the application, judged against the configured age threshold. */
export function backupStatus(app: Application): BackupStatus {
  const thresholdHours = inventoryFor(app, 'PRD')?.backupMaxAgeHours ?? config.backupMaxAgeHours;
  const backups = db.backups.filter(b => b.applicationId === app.id).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const last = backups[0];
  const base = { applicationId: app.id, applicationName: app.name, thresholdHours };
  if (!last) {
    return { ...base, status: 'UNKNOWN', lastBackupAt: null, lastBackupStatus: null, ageHours: null, type: null, destination: null, detail: 'No backup has reported to Scholario Ops (POST /api/v1/backups/report from the backup job)' };
  }
  const ageHours = Math.round(((Date.now() - Date.parse(last.completedAt)) / 3_600_000) * 10) / 10;
  const lastSuccess = backups.find(b => b.status === 'SUCCESS');
  const status = last.status === 'FAILED' ? 'FAILED'
    : !lastSuccess ? 'UNKNOWN'
      : (Date.now() - Date.parse(lastSuccess.completedAt)) / 3_600_000 > thresholdHours ? 'STALE'
        : last.status === 'SUCCESS' ? 'HEALTHY' : 'UNKNOWN';
  const detail = status === 'FAILED' ? `Latest backup FAILED at ${last.completedAt}`
    : status === 'STALE' ? `Last successful backup ${lastSuccess!.completedAt} is older than ${thresholdHours} h`
      : status === 'HEALTHY' ? `${last.type} succeeded ${ageHours} h ago`
        : `Latest backup status ${last.status}`;
  return { ...base, status, lastBackupAt: last.completedAt, lastBackupStatus: last.status, ageHours, type: last.type, destination: last.destination || null, detail };
}

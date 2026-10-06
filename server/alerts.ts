/**
 * Alert abstraction on top of incidents + notification channels.
 *
 * openAlert / resolveAlert are idempotent per fingerprint (deduplication: one open incident per
 * problem). Notifications go through notifyIncident, which applies a per-fingerprint cooldown
 * (ALERT_COOLDOWN_MIN) so a flapping check cannot cause a notification storm. Recovery sends a
 * RESOLVED notification. With no enabled channel the notification status is NOT_CONFIGURED and
 * nothing is sent anywhere.
 *
 * evaluateAlerts() derives alerts from real state every minute:
 *   agent offline · database unavailable · replication broken · backup stale/failed ·
 *   DR not ready · SSL certificate expiring. (Application down/recovered and Cloudflare origin
 *   unhealthy are raised by the monitor engine / Load Balancer poller.)
 */
import crypto from 'crypto';
import { Incident, IncidentSeverity } from '../src/types/index.ts';
import { db, persist } from './store.ts';
import { broadcast, audit } from './events.ts';
import { notifyIncident } from './notify.ts';
import { nextIncidentId } from './engine.ts';
import { agentState, backupStatus, databaseHealth } from './health.ts';
import { readiness } from './readiness.ts';
import { log } from './logger.ts';

export interface AlertInput {
  fingerprint: string;
  title: string;
  severity: IncidentSeverity;
  detail: string;
  applicationId?: string;
  environment?: 'PRD' | 'DR';
  source: string;
  affected?: string[];
}

const ev = (source: string, level: Incident['timeline'][number]['level'], message: string) =>
  ({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), source, level, message });

const openFor = (fingerprint: string) => db.incidents.find(i => i.fingerprint === fingerprint && i.status !== 'RESOLVED' && i.status !== 'CLOSED');

export function notificationStatus(): { status: 'CONFIGURED' | 'NOT_CONFIGURED'; enabledChannels: number } {
  const enabled = db.channels.filter(c => c.enabled).length;
  return { status: enabled ? 'CONFIGURED' : 'NOT_CONFIGURED', enabledChannels: enabled };
}

/** Opens (or keeps open) the incident for this fingerprint. Returns the incident and whether it is new. */
export function openAlert(a: AlertInput): { incident: Incident; created: boolean } {
  const existing = openFor(a.fingerprint);
  if (existing) {
    if (existing.rootCause !== a.detail) {
      existing.rootCause = a.detail;
      existing.timeline.push(ev(a.source, 'WARN', `Still failing: ${a.detail}`));
      persist();
      broadcast('incident_update', existing);
    }
    return { incident: existing, created: false };
  }
  const now = new Date().toISOString();
  const incident: Incident = {
    id: nextIncidentId(), title: a.title, severity: a.severity, status: 'OPEN',
    applicationId: a.applicationId ?? '', environment: a.environment ?? 'PRD', fingerprint: a.fingerprint,
    rootCause: a.detail, startedAt: now, durationMinutes: 0, owner: 'Unassigned', acknowledged: false,
    affectedServices: a.affected ?? [], affectedMonitors: [], dependentFailures: [],
    timeline: [ev(a.source, a.severity === 'CRITICAL' || a.severity === 'EMERGENCY' ? 'CRITICAL' : 'WARN', a.detail)],
    recoveryStatus: 'Awaiting recovery', notes: [],
  };
  db.incidents.unshift(incident);
  persist();
  broadcast('incident_created', incident);
  audit(a.source, 'INCIDENT_OPENED', 'INCIDENT', incident.id, `${incident.title}: ${a.detail}`);
  notifyIncident(incident, 'FIRING');
  return { incident, created: true };
}

/** Resolves the open incident for this fingerprint (if any) and sends a recovery notification. */
export function resolveAlert(fingerprint: string, source: string, recovery: string): Incident | null {
  const inc = openFor(fingerprint);
  if (!inc) return null;
  const now = new Date().toISOString();
  inc.status = 'RESOLVED';
  inc.resolvedAt = now;
  inc.durationMinutes = Math.max(0, Math.round((Date.parse(now) - Date.parse(inc.startedAt)) / 60000));
  inc.recoveryStatus = recovery;
  inc.timeline.push(ev(source, 'SUCCESS', recovery));
  persist();
  broadcast('incident_update', inc);
  audit(source, 'INCIDENT_AUTO_RESOLVED', 'INCIDENT', inc.id, `${inc.title} recovered after ${inc.durationMinutes} min`);
  notifyIncident(inc, 'RESOLVED', `Duration: ${inc.durationMinutes} min`);
  return inc;
}

/** Derives alerts from current state. Unknown / not-configured states never open or close alerts. */
export function evaluateAlerts() {
  try {
    // Agent offline (only servers whose agent reported at least once)
    for (const srv of db.servers) {
      const st = agentState(srv);
      const fp = `agent-offline:${srv.id}`;
      if (st === 'OFFLINE') {
        openAlert({ fingerprint: fp, title: `Telemetry agent offline on ${srv.hostname} (${srv.ip})`, severity: srv.environment === 'PRD' ? 'HIGH' : 'WARNING',
          detail: `No agent report since ${srv.lastSeen}`, applicationId: srv.applicationId, environment: srv.environment, source: 'Agent Monitor', affected: [srv.hostname] });
      } else if (st === 'ONLINE') resolveAlert(fp, 'Agent Monitor', `Agent on ${srv.hostname} reporting again`);
    }

    for (const app of db.applications) {
      // Database availability per environment + replication on DR
      for (const env of ['PRD', 'DR'] as const) {
        const d = databaseHealth(app, env);
        const fp = `db-down:${app.id}:${env}`;
        if (d.status === 'DOWN') {
          openAlert({ fingerprint: fp, title: `${app.name} ${env} database unavailable`, severity: env === 'PRD' ? 'CRITICAL' : 'HIGH', detail: d.detail, applicationId: app.id, environment: env, source: 'Database Monitor', affected: [app.name] });
        } else if (d.status === 'HEALTHY' || d.status === 'DEGRADED') resolveAlert(fp, 'Database Monitor', `${env} database available again`);
        if (env === 'DR' && d.report?.replication?.role === 'replica') {
          const rfp = `db-replication:${app.id}`;
          if (d.report.available && d.report.replication.state !== 'running') {
            openAlert({ fingerprint: rfp, title: `${app.name} replication to DR is ${d.report.replication.state}`, severity: 'HIGH', detail: d.detail, applicationId: app.id, environment: 'DR', source: 'Database Monitor', affected: [app.name] });
          } else if (d.report.replication.state === 'running') resolveAlert(rfp, 'Database Monitor', 'Replication running again');
        }
      }

      // Backups
      const b = backupStatus(app);
      const bfp = `backup:${app.id}`;
      if (b.status === 'STALE' || b.status === 'FAILED') {
        openAlert({ fingerprint: bfp, title: `${app.name} backup ${b.status === 'FAILED' ? 'failed' : 'is stale'}`, severity: b.status === 'FAILED' ? 'HIGH' : 'WARNING', detail: b.detail, applicationId: app.id, source: 'Backup Monitor', affected: [app.name] });
      } else if (b.status === 'HEALTHY') resolveAlert(bfp, 'Backup Monitor', b.detail);

      // DR readiness (NOT_READY = at least one check FAILS with evidence)
      const r = readiness(app);
      const dfp = `dr-not-ready:${app.id}`;
      if (r.overall === 'NOT_READY') {
        const failing = r.checks.filter(c => c.group === 'core' && c.status === 'FAIL');
        openAlert({ fingerprint: dfp, title: `${app.name} DR is NOT READY`, severity: 'HIGH', detail: failing.map(c => `${c.label}: ${c.detail}`).join(' · '), applicationId: app.id, environment: 'DR', source: 'DR Readiness', affected: [app.name] });
      } else if (r.overall === 'READY' || r.overall === 'PARTIALLY_READY') resolveAlert(dfp, 'DR Readiness', `DR readiness is ${r.overall}`);
    }

    // SSL certificates expiring soon (expired / invalid certificates are monitor incidents already)
    for (const m of db.monitors.filter(x => x.type === 'SSL' && x.enabled)) {
      const fp = `ssl-expiry:${m.id}`;
      if (m.status === 'WARNING' && m.lastProbeStatus === 'DEGRADED') {
        openAlert({ fingerprint: fp, title: `SSL certificate for ${m.target} expires soon`, severity: 'WARNING', detail: m.history[0]?.detail ?? 'Certificate close to expiry', applicationId: m.applicationId, environment: m.environment, source: 'SSL Monitor', affected: [m.target] });
      } else if (m.status === 'HEALTHY') resolveAlert(fp, 'SSL Monitor', `Certificate for ${m.target} renewed`);
    }
  } catch (err) {
    log.error('alerts', 'alert evaluation failed', { error: err as Error });
  }
}

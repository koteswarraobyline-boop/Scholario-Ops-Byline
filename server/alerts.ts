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
 *   server heartbeat stale → offline (one incident, escalated) · database unavailable · replication broken · backup stale/failed ·
 *   DR not ready · SSL certificate expiring · server telemetry conditions (sustained CPU / memory /
 *   swap, full disk / inodes, failed systemd service, PM2 app errored / restart spike, local health
 *   check failing, clock not synchronised — see server/telemetryHealth.ts, warnings with alert: true). (Application down/recovered and Cloudflare origin
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
import { serverHealth } from './telemetryHealth.ts';
import { config } from './config.ts';
import { log } from './logger.ts';
import { serverInsight, applicationSlo } from './insights.ts';
import { formatEta } from '../src/lib/insights.ts';

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
      // Details often carry live values (CPU %, skew ms): note them in the timeline at most every 30 min
      const lastNote = [...existing.timeline].reverse().find(e => e.message.startsWith('Still failing'));
      if (!lastNote || Date.now() - Date.parse(lastNote.timestamp) >= 30 * 60_000) {
        existing.timeline.push(ev(a.source, 'WARN', `Still failing: ${a.detail}`));
      }
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

/** openAlert, and raise the severity of an already-open incident in place (with a FIRING notification) */
function openOrEscalate(a: AlertInput) {
  const { incident, created } = openAlert(a);
  const rank: Record<IncidentSeverity, number> = { INFO: 0, WARNING: 1, HIGH: 2, CRITICAL: 3, EMERGENCY: 4 };
  if (!created && rank[a.severity] > rank[incident.severity]) {
    incident.severity = a.severity;
    incident.title = a.title;
    incident.timeline.push(ev(a.source, 'CRITICAL', `Escalated to ${a.severity}: ${a.detail}`));
    persist();
    broadcast('incident_update', incident);
    notifyIncident(incident, 'FIRING');
  }
}

/** Predictive alerts: disk-full forecast, flapping monitors, SLO error-budget burn. */
export function evaluateInsightAlerts() {
  // Disk predicted to reach the critical threshold. Opens at ≤ 72 h, closes only beyond 96 h (no flicker).
  // An ETA of 0 (already over the threshold) is the telemetry disk alert's job, not a forecast.
  for (const srv of db.servers) {
    if (agentState(srv) !== 'ONLINE') continue;
    const f = serverInsight(srv.id)?.disk;
    if (!f) continue; // not enough history: never open or close on a guess
    const fp = `capacity-disk:${srv.id}`;
    if (f.etaHours !== null && f.etaHours > 0 && f.etaHours <= 72 && f.confidence !== 'LOW') {
      openOrEscalate({
        fingerprint: fp, title: `${srv.hostname} (${srv.environment}): disk predicted to reach ${f.threshold}% in ~${formatEta(f.etaHours)}`,
        severity: f.etaHours <= 24 && srv.environment === 'PRD' ? 'HIGH' : 'WARNING',
        detail: `Disk ${f.current}% rising ${f.slopePerDay}%/day (fit r²=${f.r2}, ${f.spanHours} h of data, ${f.confidence} confidence)`,
        applicationId: srv.applicationId, environment: srv.environment, source: 'Capacity Forecast', affected: [srv.hostname],
      });
    } else if (f.etaHours === null || f.etaHours > 96) {
      resolveAlert(fp, 'Capacity Forecast', `Disk on ${srv.hostname} no longer trending to full (${f.current}%, ${f.slopePerDay}%/day)`);
    }
  }

  // Flapping monitors (a confirmed outage is already its own monitor incident)
  for (const m of db.monitors) {
    const fp = `flapping:${m.id}`;
    if (m.enabled && m.flapping && !m.activeMaintenance && m.status !== 'CRITICAL') {
      openAlert({
        fingerprint: fp, title: `${m.name} (${m.environment}) is flapping`, severity: 'WARNING',
        detail: `${m.flapTransitions ?? 0} pass/fail changes in the last 20 checks — intermittent failure below the confirmation threshold`,
        applicationId: m.applicationId, environment: m.environment, source: 'Flap Detection', affected: [m.target],
      });
    } else if (!m.flapping || !m.enabled) resolveAlert(fp, 'Flap Detection', `${m.name} stable again`);
  }

  // SLO error budget burn (PRD monitors of each application)
  for (const app of db.applications) {
    const slo = applicationSlo(app.id);
    if (!slo || slo.monitorCount === 0) continue;
    const b = slo.budget;
    const fp = `slo-burn:${app.id}`;
    if (b.alert !== 'NONE') {
      const fast = b.alert === 'FAST_BURN';
      openOrEscalate({
        fingerprint: fp, title: `${app.name}: SLO error budget ${fast ? 'burning fast' : 'burning'} (${b.targetPercent}% target)`,
        severity: fast ? 'HIGH' : 'WARNING',
        detail: `Burn rate 1h ${b.burnRate1h ?? '—'}× · 6h ${b.burnRate6h ?? '—'}× · 24h ${b.burnRate24h ?? '—'}× · ${b.remainingPercent ?? '—'}% of the ${b.windowDays}-day budget left`,
        applicationId: app.id, environment: 'PRD', source: 'SLO Monitor', affected: [app.name],
      });
    } else if (b.burnRate1h !== null) resolveAlert(fp, 'SLO Monitor', `${app.name} error budget burn back within SLO (${b.remainingPercent}% left)`);
  }
}

/** Derives alerts from current state. Unknown / not-configured states never open or close alerts. */
export function evaluateAlerts() {
  try {
    // Server heartbeat (only servers whose agent reported at least once). One incident per outage:
    // opened when the heartbeat is STALE and escalated in place when it becomes DISCONNECTED.
    for (const srv of db.servers) {
      const st = agentState(srv);
      const fp = `agent-offline:${srv.id}`;
      if (st === 'STALE' || st === 'OFFLINE') {
        const disconnected = st === 'OFFLINE';
        const title = disconnected ? `Telemetry agent offline on ${srv.hostname} (${srv.ip})` : `Server heartbeat stale on ${srv.hostname} (${srv.ip})`;
        const severity = disconnected && srv.environment === 'PRD' ? 'HIGH' : 'WARNING';
        const detail = disconnected ? `No agent report since ${srv.lastSeen} (disconnected after ${config.telemetryStaleSec * 10}s)`
          : `Agent heartbeat late: last report ${srv.lastSeen} (stale after ${config.telemetryStaleSec}s)`;
        const { incident } = openAlert({ fingerprint: fp, title, severity, detail, applicationId: srv.applicationId, environment: srv.environment, source: 'Agent Monitor', affected: [srv.hostname] });
        if (disconnected && (incident.title !== title || incident.severity !== severity)) {
          incident.title = title;
          incident.severity = severity;
          incident.timeline.push({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), source: 'Agent Monitor', level: severity === 'HIGH' ? 'CRITICAL' : 'WARN', message: `Escalated: heartbeat stale → disconnected. ${detail}` });
          persist();
          broadcast('incident_update', incident);
          notifyIncident(incident, 'FIRING');
        }
      } else if (st === 'ONLINE') resolveAlert(fp, 'Agent Monitor', `Agent on ${srv.hostname} reporting again`);

      // Telemetry conditions. Only evaluated with a live agent: without data nothing opens or closes.
      if (st === 'ONLINE') {
        const prefix = `telemetry:${srv.id}:`;
        const firing = serverHealth(srv).warnings.filter(w => w.alert);
        for (const w of firing) {
          openAlert({
            fingerprint: prefix + w.key, title: `${srv.hostname} (${srv.environment}): ${w.message}`,
            severity: w.level === 'CRITICAL' && srv.environment === 'PRD' ? 'HIGH' : 'WARNING',
            detail: w.message, applicationId: srv.applicationId, environment: srv.environment, source: 'Server Telemetry', affected: [srv.hostname],
          });
        }
        const keys = new Set(firing.map(w => prefix + w.key));
        for (const inc of db.incidents) {
          if (inc.fingerprint?.startsWith(prefix) && !keys.has(inc.fingerprint) && inc.status !== 'RESOLVED' && inc.status !== 'CLOSED') {
            resolveAlert(inc.fingerprint, 'Server Telemetry', `Condition cleared on ${srv.hostname}`);
          }
        }
      }
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

    evaluateInsightAlerts();

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

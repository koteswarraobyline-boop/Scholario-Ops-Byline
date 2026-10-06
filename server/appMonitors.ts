/**
 * Keeps an application's URL monitors in sync with its configuration.
 *
 * For each environment with a URL (Application.prdUrl / drUrl) there is one HTTP(S) monitor
 * (managedBy 'app-url') and, for https URLs with sslMonitoring on, one TLS certificate monitor
 * (managedBy 'app-ssl'). When the administrator changes a URL or the health-check settings,
 * the monitors are updated so the next monitoring cycle uses the new values. Removing a URL
 * removes its managed monitors. Monitors created manually are never touched.
 */
import crypto from 'crypto';
import { Application, Monitor } from '../src/types/index.ts';
import { db, persist } from './store.ts';
import { broadcast } from './events.ts';
import { registerNewMonitor, runMonitorNow, closeMonitorIncident, recomputeDerived } from './engine.ts';

export const DEFAULT_HEALTH_CHECK = { expectedStatus: null, intervalSec: 30, timeoutSec: 15, sslMonitoring: true } as const;

const envLabel = (env: 'PRD' | 'DR') => (env === 'PRD' ? 'Production' : 'DR');

function blankMonitor(app: Application, env: 'PRD' | 'DR'): Omit<Monitor, 'name' | 'type' | 'target'> {
  return {
    id: crypto.randomUUID(), applicationId: app.id, environment: env, intervalSec: 30, timeoutSec: 15, retries: 2,
    warningThresholdMs: 2000, criticalThresholdMs: 10000, failureConfirmationThreshold: 3, recoveryConfirmationThreshold: 2,
    consecutiveFailures: 0, consecutiveRecoveries: 0, status: 'UNKNOWN', lastCheck: '', lastSuccess: '', responseTimeMs: 0,
    uptimePercent: 0, history: [], enabled: true, activeMaintenance: false,
  };
}

function resetState(m: Monitor) {
  m.status = 'UNKNOWN'; m.consecutiveFailures = 0; m.consecutiveRecoveries = 0; m.history = [];
  m.lastCheck = ''; m.lastSuccess = ''; m.lastFailure = undefined; m.responseTimeMs = 0; m.uptimePercent = 0;
  m.lastProbeStatus = undefined; m.lastStatusCode = undefined;
  delete db.monitorBuckets[m.id];
}

function removeMonitor(m: Monitor, operator: string, why: string, changes: string[]) {
  closeMonitorIncident(m, operator, why);
  db.monitors = db.monitors.filter(x => x.id !== m.id);
  delete db.monitorBuckets[m.id];
  broadcast('monitor_deleted', { id: m.id });
  changes.push(`removed "${m.name}" (${why})`);
}

/** Returns a human-readable list of what changed (empty when nothing did). */
export function syncAppUrlMonitors(app: Application, operator: string): string[] {
  const hc = { ...DEFAULT_HEALTH_CHECK, ...(app.healthCheck ?? {}) };
  const changes: string[] = [];
  const toRun: Monitor[] = [];

  for (const env of ['PRD', 'DR'] as const) {
    const url = env === 'PRD' ? app.prdUrl : app.drUrl;
    const serverId = (env === 'PRD' ? app.prdServerId : app.drServerId) || undefined;
    const urlMon = db.monitors.find(m => m.applicationId === app.id && m.environment === env && m.managedBy === 'app-url');
    const sslMon = db.monitors.find(m => m.applicationId === app.id && m.environment === env && m.managedBy === 'app-ssl');

    if (!url) {
      if (urlMon) removeMonitor(urlMon, operator, `${envLabel(env)} URL removed`, changes);
      if (sslMon) removeMonitor(sslMon, operator, `${envLabel(env)} URL removed`, changes);
      continue;
    }

    const parsed = new URL(url);
    const type: Monitor['type'] = parsed.protocol === 'https:' ? 'HTTPS' : 'HTTP';
    const settings = {
      serverId,
      expectedStatusCode: hc.expectedStatus ?? undefined,
      intervalSec: hc.intervalSec,
      timeoutSec: hc.timeoutSec,
    };

    if (!urlMon) {
      const m: Monitor = { ...blankMonitor(app, env), name: `${app.name} ${envLabel(env)} — ${type} ${parsed.host}${parsed.pathname !== '/' ? parsed.pathname : ''}`, type, target: url, managedBy: 'app-url', ...settings };
      db.monitors.push(m);
      registerNewMonitor(m);
      toRun.push(m);
      changes.push(`created "${m.name}" → ${url}`);
    } else {
      const targetChanged = urlMon.target !== url || urlMon.type !== type;
      const settingsChanged = urlMon.serverId !== settings.serverId || urlMon.expectedStatusCode !== settings.expectedStatusCode
        || urlMon.intervalSec !== settings.intervalSec || urlMon.timeoutSec !== settings.timeoutSec;
      if (targetChanged) {
        closeMonitorIncident(urlMon, operator, `${envLabel(env)} URL changed ${urlMon.target} → ${url}`);
        changes.push(`"${urlMon.name}" target ${urlMon.target} → ${url}`);
        resetState(urlMon);
        urlMon.target = url;
        urlMon.type = type;
        urlMon.name = `${app.name} ${envLabel(env)} — ${type} ${parsed.host}${parsed.pathname !== '/' ? parsed.pathname : ''}`;
      }
      if (settingsChanged) changes.push(`"${urlMon.name}" health-check settings updated`);
      Object.assign(urlMon, settings);
      if (targetChanged || settingsChanged) { registerNewMonitor(urlMon); toRun.push(urlMon); broadcast('monitor_update', urlMon); }
    }

    const wantSsl = type === 'HTTPS' && hc.sslMonitoring;
    if (!wantSsl) {
      if (sslMon) removeMonitor(sslMon, operator, type === 'HTTPS' ? 'SSL monitoring turned off' : 'URL is not HTTPS', changes);
    } else if (!sslMon) {
      const m: Monitor = { ...blankMonitor(app, env), name: `${app.name} ${envLabel(env)} — TLS certificate ${parsed.hostname}`, type: 'SSL', target: parsed.hostname, managedBy: 'app-ssl', intervalSec: 3600, timeoutSec: 15 };
      db.monitors.push(m);
      registerNewMonitor(m);
      toRun.push(m);
      changes.push(`created "${m.name}"`);
    } else if (sslMon.target !== parsed.hostname) {
      closeMonitorIncident(sslMon, operator, `${envLabel(env)} host changed ${sslMon.target} → ${parsed.hostname}`);
      changes.push(`"${sslMon.name}" host ${sslMon.target} → ${parsed.hostname}`);
      resetState(sslMon);
      sslMon.target = parsed.hostname;
      sslMon.name = `${app.name} ${envLabel(env)} — TLS certificate ${parsed.hostname}`;
      registerNewMonitor(sslMon);
      toRun.push(sslMon);
      broadcast('monitor_update', sslMon);
    }
  }

  if (changes.length) {
    persist();
    recomputeDerived();
    broadcast('monitors_changed', null);
    for (const m of toRun) if (m.enabled) void runMonitorNow(m);
  }
  return changes;
}

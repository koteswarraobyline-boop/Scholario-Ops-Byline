/**
 * Reliability insights computed from real, stored data only:
 *   • capacity forecasts per server (disk / memory trend from the per-minute metric rollups)
 *   • SLO error budget + burn rate per application (hourly uptime buckets of its monitors)
 *   • monitors currently flapping
 * No data → no insight (null / NO_DATA), never an assumed value.
 */
import { ReliabilityInsights, ServerInsight, ApplicationSlo } from '../src/types/index.ts';
import { forecastToThreshold, errorBudget, SLO_TARGETS } from '../src/lib/insights.ts';
import { THRESHOLDS } from '../src/lib/thresholds.ts';
import { db, minuteMetrics } from './store.ts';
import { agentState } from './health.ts';

/** Disk / memory are forecast towards their CRITICAL threshold */
export function serverInsight(serverId: string): ServerInsight | null {
  const srv = db.servers.find(s => s.id === serverId);
  if (!srv) return null;
  const series = minuteMetrics[serverId] ?? [];
  const pts = (key: 'disk' | 'ram') => series.map(p => ({ t: Date.parse(p.t), v: p[key] }));
  return {
    serverId: srv.id, hostname: srv.hostname, environment: srv.environment, agentState: agentState(srv),
    disk: forecastToThreshold(pts('disk'), THRESHOLDS.diskPercent.critical),
    // Memory moves fast; a long-horizon ETA would be noise, so only the next 3 days are reported
    memory: forecastToThreshold(pts('ram'), THRESHOLDS.memoryPercent.critical, { maxEtaHours: 72 }),
  };
}

export function applicationSlo(appId: string): ApplicationSlo | null {
  const app = db.applications.find(a => a.id === appId);
  if (!app) return null;
  const monitors = db.monitors.filter(m => m.applicationId === app.id && m.enabled && m.environment === 'PRD');
  const buckets = monitors.flatMap(m => db.monitorBuckets[m.id] ?? []);
  const nowH = Math.floor(Date.now() / 3_600_000);
  return {
    applicationId: app.id, name: app.name, tier: app.tier, monitorCount: monitors.length,
    budget: errorBudget(buckets, SLO_TARGETS[app.tier] ?? SLO_TARGETS.TIER_3, nowH),
  };
}

export function reliabilityInsights(): ReliabilityInsights {
  return {
    generatedAt: new Date().toISOString(),
    servers: db.servers.map(s => serverInsight(s.id)!).filter(Boolean),
    applications: db.applications.map(a => applicationSlo(a.id)!).filter(Boolean),
    flapping: db.monitors.filter(m => m.enabled && m.flapping).map(m => ({
      monitorId: m.id, name: m.name, applicationId: m.applicationId, environment: m.environment, transitions: m.flapTransitions ?? 0,
    })),
  };
}

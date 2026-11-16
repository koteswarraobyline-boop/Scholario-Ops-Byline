/**
 * Collect the four cause signals from the live store and rank them.
 */
import type { Incident, LikelyCause } from '../src/types/index.ts';
import { suggestLikelyCause } from '../src/lib/likelyCause.ts';
import { db } from './store.ts';
import { originHealthy, poolFor } from './loadbalancer.ts';

export function likelyCauseForIncident(incident: Incident): LikelyCause {
  const app = incident.applicationId ? db.applications.find(a => a.id === incident.applicationId) : undefined;
  const serverIds = [app?.prdServerId, app?.drServerId].filter((id): id is string => Boolean(id));
  const env = incident.environment;

  let cloudflare: { healthy: boolean | null; detail: string; checkedAt: string | null } | null = null;
  if (app?.loadBalancer) {
    const pool = poolFor(app, env);
    const srv = db.servers.find(s => s.id === (env === 'DR' ? app.drServerId : app.prdServerId));
    const origin = pool ? (pool.origins.find(o => o.address === srv?.ip) ?? pool.origins[0]) : undefined;
    if (!pool || !origin) {
      cloudflare = { healthy: null, detail: pool?.found === false ? 'Pool was not returned by Cloudflare' : 'Cloudflare origin health is not available', checkedAt: pool?.healthFetchedAt ?? pool?.listFetchedAt ?? null };
    } else {
      const healthy = originHealthy(origin);
      cloudflare = {
        healthy,
        detail: healthy === false
          ? `origin ${origin.address} is unhealthy`
          : healthy === true ? `origin ${origin.address} is healthy` : `origin ${origin.address} has no health data`,
        checkedAt: pool.healthFetchedAt ?? pool.listFetchedAt ?? null,
      };
    }
  }

  return suggestLikelyCause({
    startedAt: incident.startedAt,
    applicationId: incident.applicationId || undefined,
    serverIds,
    environment: env,
    title: incident.title,
    detail: incident.rootCause,
    fingerprint: incident.fingerprint,
    deployments: db.deployments.map(d => ({
      applicationId: d.applicationId,
      environment: d.environment,
      status: d.status,
      version: d.version,
      startedAt: d.startedAt,
      completedAt: d.completedAt,
    })),
    capacity: db.resources.map(r => ({
      applicationId: r.applicationId,
      serverId: r.serverId,
      name: r.name,
      alertState: r.alertState,
    })),
    credentials: db.credentials.map(c => ({
      applicationId: c.applicationId,
      environment: c.environment,
      name: c.name,
      expiresAt: c.expiresAt,
    })),
    certificates: db.monitors
      .filter(m => m.type === 'SSL' || m.managedBy === 'app-ssl')
      .map(m => ({
        applicationId: m.applicationId,
        environment: m.environment,
        name: m.name,
        daysLeft: m.certificateDaysLeft ?? null,
        validTo: m.certificateValidTo ?? null,
      })),
    cloudflare,
  });
}

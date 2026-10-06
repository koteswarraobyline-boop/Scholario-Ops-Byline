/**
 * Cloudflare Load Balancing — READ-ONLY.
 *
 * For every application with a `loadBalancer` mapping (account id + PRD/DR pool ids) this
 * module reads, from the Cloudflare API:
 *   GET /accounts/:acc/load_balancers/pools               pool + origin config / health
 *   GET /accounts/:acc/load_balancers/pools/:id/health    per-PoP origin health, RTT, response code
 *   GET /zones?name=… + GET /zones/:zone/load_balancers   routing (default pool order), optional
 *
 * Nothing here modifies Cloudflare. When a call fails the affected values become null
 * (unknown) — previous "healthy" values are never carried forward as if they were live.
 */
import { Application, LbOrigin, LbOriginHealth, LbPool, LbRouting, LoadBalancerState } from '../src/types/index.ts';
import { isCloudflareConfigured } from './config.ts';
import { db, persist } from './store.ts';
import { broadcast, audit } from './events.ts';
import { cf, CloudflareError } from './cloudflare.ts';
import { recordCheck } from './history.ts';
import { log } from './logger.ts';

export const PERMISSION_HINT = 'Cloudflare permission required — the API token needs "Account › Load Balancing: Monitors and Pools › Read" (and "Zone › Load Balancers › Read" for routing)';

interface RawOrigin { name?: string; address?: string; enabled?: boolean; weight?: number; healthy?: boolean; failure_reason?: string }
interface RawPool { id: string; name?: string; description?: string; enabled?: boolean; healthy?: boolean; origins?: RawOrigin[] }
interface RawPoolHealth {
  pool_id?: string;
  pop_health?: Record<string, { healthy?: boolean; origins?: Array<Record<string, { healthy?: boolean; rtt?: string; failure_reason?: string; response_code?: number }>> }>;
}
interface RawLb { id: string; name: string; enabled?: boolean; proxied?: boolean; default_pools?: string[]; fallback_pool?: string; steering_policy?: string }

export const lbState: LoadBalancerState = {
  accountId: null,
  status: isCloudflareConfigured() ? 'PENDING' : 'NOT_CONFIGURED',
  lastSyncAt: null,
  lastSuccessAt: null,
  lastError: isCloudflareConfigured() ? null : 'CLOUDFLARE_API_TOKEN is not set',
  pools: [],
  routing: [],
};

type Listener = (state: LoadBalancerState) => void;
const listeners: Listener[] = [];
/** Called after every sync (success or failure) — used by the incident engine. */
export function onLoadBalancerUpdate(fn: Listener) { listeners.push(fn); }

export function mappedApps(): Application[] {
  return db.applications.filter(a => a.loadBalancer?.accountId && (a.loadBalancer.prdPoolId || a.loadBalancer.drPoolId));
}

/** Pool for an application environment, or undefined when unmapped / not synced. */
export function poolFor(app: Application, env: 'PRD' | 'DR'): LbPool | undefined {
  const id = env === 'PRD' ? app.loadBalancer?.prdPoolId : app.loadBalancer?.drPoolId;
  return id ? lbState.pools.find(p => p.id === id && p.applicationId === app.id) : undefined;
}

export function routingFor(app: Application): LbRouting | undefined {
  const host = app.loadBalancer?.hostname;
  return host ? lbState.routing.find(r => r.hostname === host) : undefined;
}

/** Origin is healthy when every PoP reports healthy; unknown (null) when there is no data. */
export function originHealthy(o: { healthy: boolean | null; health: Array<{ healthy: boolean | null }> }): boolean | null {
  const known = o.health.map(h => h.healthy).filter((x): x is boolean => x !== null);
  if (known.length) return known.every(Boolean);
  return o.healthy;
}

/** Average RTT across PoPs that reported one (null when none did) */
export function originRtt(o: LbOrigin): number | null {
  const r = o.health.map(h => h.rttMs).filter((x): x is number => x !== null);
  return r.length ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 10) / 10 : null;
}

/** "23ms" / "16.1ms" / "1.2s" → milliseconds */
function parseRtt(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^([\d.]+)\s*(ms|s|µs|us)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2] ?? 'ms';
  return Math.round((unit === 's' ? n * 1000 : unit === 'ms' ? n : n / 1000) * 10) / 10;
}

const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

function skeleton(app: Application, id: string, role: 'PRD' | 'DR'): LbPool {
  return {
    id, role, applicationId: app.id, name: '', description: '', enabled: null, healthy: null,
    origins: [], found: false, listFetchedAt: null, healthFetchedAt: null, healthError: null,
  };
}

function parseHealth(raw: RawPoolHealth): Map<string, LbOriginHealth[]> {
  const byAddress = new Map<string, LbOriginHealth[]>();
  for (const [pop, ph] of Object.entries(raw.pop_health ?? {})) {
    for (const entry of ph.origins ?? []) {
      for (const [address, h] of Object.entries(entry)) {
        const list = byAddress.get(address) ?? [];
        list.push({
          pop,
          healthy: bool(h.healthy),
          rttMs: parseRtt(h.rtt),
          responseCode: typeof h.response_code === 'number' ? h.response_code : null,
          failureReason: typeof h.failure_reason === 'string' ? h.failure_reason : null,
        });
        byAddress.set(address, list);
      }
    }
  }
  return byAddress;
}

function describe(err: unknown): string {
  if (err instanceof CloudflareError && err.isPermission) return `${PERMISSION_HINT} (${err.message})`;
  return (err as Error).message;
}

const zoneIdCache = new Map<string, string>();
async function zoneIdFor(hostname: string): Promise<string> {
  const parts = hostname.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (zoneIdCache.has(candidate)) return zoneIdCache.get(candidate)!;
    const res = await cf<Array<{ id: string; name: string }>>(`/zones?name=${encodeURIComponent(candidate)}`);
    if (res.result[0]) { zoneIdCache.set(candidate, res.result[0].id); return res.result[0].id; }
  }
  throw new CloudflareError(`No Cloudflare zone found for ${hostname}`);
}

async function readRouting(app: Application, pools: LbPool[], now: string): Promise<LbRouting> {
  const hostname = app.loadBalancer!.hostname;
  const base: LbRouting = { hostname, found: false, enabled: null, proxied: null, steeringPolicy: null, defaultPools: [], fallbackPool: null, activePoolId: null, fetchedAt: null, error: null };
  if (!hostname) return { ...base, error: 'No load balancer hostname configured' };
  try {
    const zoneId = await zoneIdFor(hostname);
    const res = await cf<RawLb[]>(`/zones/${zoneId}/load_balancers`);
    const lb = res.result.find(l => l.name === hostname);
    if (!lb) return { ...base, fetchedAt: now, error: `No load balancer named ${hostname} in the zone` };
    const defaultPools = lb.default_pools ?? [];
    // Failover steering sends traffic to the first enabled + healthy pool in default_pools order.
    // If any pool's health is unknown we cannot say which one is active.
    let activePoolId: string | null = null;
    for (const pid of defaultPools) {
      const p = pools.find(x => x.id === pid);
      // Prefer per-PoP origin health (fresher) over the pool list's aggregate flag
      const originStates = p ? p.origins.filter(o => o.enabled !== false).map(originHealthy) : [];
      const healthy = !p ? null : originStates.some(h => h === true) ? true : originStates.length && originStates.every(h => h === false) ? false : p.healthy;
      if (!p || p.enabled === null || healthy === null) { activePoolId = null; break; }
      if (p.enabled && healthy) { activePoolId = pid; break; }
    }
    return {
      hostname, found: true, enabled: bool(lb.enabled), proxied: bool(lb.proxied),
      steeringPolicy: lb.steering_policy ?? null, defaultPools, fallbackPool: lb.fallback_pool ?? null,
      activePoolId, fetchedAt: now, error: null,
    };
  } catch (err) {
    return { ...base, error: describe(err) };
  }
}

let syncing = false;
let inFlight: Promise<LoadBalancerState> | null = null;
let rerun: 'schedule' | 'manual' | null = null;

/**
 * Reads pools / health / routing for every mapped application. If a sync is already running
 * (e.g. started by saving an application), the caller waits for it and one more sync runs
 * afterwards so the result always reflects the latest configuration — never a stale state.
 */
export async function syncLoadBalancers(trigger: 'schedule' | 'manual' = 'schedule'): Promise<LoadBalancerState> {
  if (inFlight) {
    rerun = rerun === 'manual' || trigger === 'manual' ? 'manual' : 'schedule';
    await inFlight;
    if (inFlight) return inFlight; // another caller already started the follow-up sync
  }
  inFlight = (async () => {
    try {
      let state = await runSync(trigger);
      while (rerun) { const t = rerun; rerun = null; state = await runSync(t); }
      return state;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
let lastStatus: LoadBalancerState['status'] | null = null;

async function runSync(trigger: 'schedule' | 'manual'): Promise<LoadBalancerState> {
  const apps = mappedApps();
  const now = new Date().toISOString();
  lbState.accountId = apps[0]?.loadBalancer?.accountId ?? null;

  if (!isCloudflareConfigured()) {
    Object.assign(lbState, {
      status: 'NOT_CONFIGURED', lastError: 'CLOUDFLARE_API_TOKEN is not set', lastSyncAt: now,
      pools: apps.flatMap(a => [skeleton(a, a.loadBalancer!.prdPoolId, 'PRD'), skeleton(a, a.loadBalancer!.drPoolId, 'DR')]),
      routing: [],
    });
    broadcast('loadbalancer_update', lbState);
    return lbState;
  }
  if (apps.length === 0) {
    Object.assign(lbState, { status: 'NOT_CONFIGURED', lastError: 'No application has a Cloudflare Load Balancer mapping', lastSyncAt: now, pools: [], routing: [] });
    broadcast('loadbalancer_update', lbState);
    return lbState;
  }

  syncing = true;
  try {
    const pools: LbPool[] = [];
    const errors: string[] = [];
    let permissionDenied = false;

    for (const accountId of [...new Set(apps.map(a => a.loadBalancer!.accountId))]) {
      const accApps = apps.filter(a => a.loadBalancer!.accountId === accountId);
      let rawPools: RawPool[] | null = null;
      try {
        rawPools = (await cf<RawPool[]>(`/accounts/${accountId}/load_balancers/pools`)).result;
      } catch (err) {
        if (err instanceof CloudflareError && err.isPermission) permissionDenied = true;
        errors.push(describe(err));
      }

      for (const app of accApps) {
        for (const role of ['PRD', 'DR'] as const) {
          const id = role === 'PRD' ? app.loadBalancer!.prdPoolId : app.loadBalancer!.drPoolId;
          if (!id) continue;
          const pool = skeleton(app, id, role);
          const raw = rawPools?.find(p => p.id === id);
          if (rawPools && !raw) errors.push(`Pool ${id} (${app.name} ${role}) was not returned by Cloudflare`);
          if (raw) {
            pool.found = true;
            pool.name = raw.name ?? '';
            pool.description = raw.description ?? '';
            pool.enabled = bool(raw.enabled);
            pool.healthy = bool(raw.healthy);
            pool.listFetchedAt = now;
            pool.origins = (raw.origins ?? []).map((o): LbOrigin => ({
              name: o.name ?? '',
              address: o.address ?? '',
              enabled: bool(o.enabled),
              weight: typeof o.weight === 'number' ? o.weight : null,
              healthy: bool(o.healthy),
              failureReason: typeof o.failure_reason === 'string' ? o.failure_reason : null,
              health: [],
            }));
          }
          if (rawPools) {
            try {
              const health = parseHealth((await cf<RawPoolHealth>(`/accounts/${accountId}/load_balancers/pools/${id}/health`)).result);
              pool.healthFetchedAt = now;
              for (const o of pool.origins) o.health = health.get(o.address) ?? [];
              // Persist one sample per origin so Cloudflare origin availability is computed from real history
              for (const o of pool.origins) {
                const h = originHealthy(o);
                if (h === null) continue;
                const bad = o.health.find(x => x.healthy === false);
                recordCheck({
                  t: now, monitorId: `cf-origin:${id}:${o.address}`, applicationId: app.id, environment: role, target: `${pool.name || id} / ${o.address}`,
                  ok: h, probeStatus: h ? 'UP' : 'DOWN', statusCode: (bad ?? o.health[0])?.responseCode ?? null,
                  latencyMs: originRtt(o) ?? 0, reason: h ? 'Cloudflare: healthy' : `Cloudflare: ${bad?.failureReason ?? o.failureReason ?? 'unhealthy'}`,
                });
              }
              // Origins present in health data but missing from the list (should not happen) are still shown
              for (const [address, h] of health) {
                if (!pool.origins.some(o => o.address === address)) {
                  pool.origins.push({ name: '', address, enabled: null, weight: null, healthy: null, failureReason: null, health: h });
                }
              }
            } catch (err) {
              if (err instanceof CloudflareError && err.isPermission) permissionDenied = true;
              pool.healthError = describe(err);
              errors.push(`Pool health ${pool.name || id}: ${pool.healthError}`);
            }
          }
          pools.push(pool);
        }
      }
    }

    const routing: LbRouting[] = [];
    for (const app of apps) {
      if (app.loadBalancer!.hostname) routing.push(await readRouting(app, pools, now));
    }

    // Record which environment Cloudflare is actually serving (only when routing is known)
    for (const app of apps) {
      const r = routing.find(x => x.hostname === app.loadBalancer!.hostname);
      if (!r?.activePoolId) continue;
      const next = r.activePoolId === app.loadBalancer!.drPoolId ? 'DR_ACTIVE' : r.activePoolId === app.loadBalancer!.prdPoolId ? 'PRIMARY_ACTIVE' : null;
      if (next && app.failoverState !== next) {
        audit('Cloudflare Sync', 'CLOUDFLARE_ROUTING_CHANGED', 'FAILOVER', app.id, `${app.name}: Cloudflare now serves ${next === 'DR_ACTIVE' ? 'the DR' : 'the Production'} pool (was ${app.failoverState})`);
        app.failoverState = next;
        app.lastFailoverAt = now;
        persist();
        broadcast('application_update', app);
      }
    }

    const listOk = pools.some(p => p.found);
    lbState.pools = pools;
    lbState.routing = routing;
    lbState.lastSyncAt = now;
    lbState.status = permissionDenied ? 'PERMISSION_REQUIRED' : !listOk || errors.length ? 'ERROR' : 'OK';
    lbState.lastError = errors.length ? errors.join(' · ') : null;
    if (listOk && !errors.length) lbState.lastSuccessAt = now;

    if (trigger === 'manual' || lbState.status !== lastStatus) {
      audit('Cloudflare Sync', trigger === 'manual' ? 'CLOUDFLARE_LB_SYNC' : `CLOUDFLARE_LB_${lbState.status}`, 'CLOUDFLARE', lbState.accountId ?? 'account',
        `Load balancer sync ${lbState.status}: ${pools.filter(p => p.found).length}/${pools.length} mapped pool(s) read${lbState.lastError ? ` — ${lbState.lastError.slice(0, 400)}` : ''}`);
    }
    lastStatus = lbState.status;
    if (lbState.lastError) log.error('loadbalancer', `${lbState.lastError}`);
    broadcast('loadbalancer_update', lbState);
    for (const fn of listeners) {
      try { fn(lbState); } catch (err) { log.error('loadbalancer', `listener failed: ${(err as Error).message}`); }
    }
    return lbState;
  } finally {
    syncing = false;
  }
}

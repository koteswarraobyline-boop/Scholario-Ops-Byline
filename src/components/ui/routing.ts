import { Application, CloudflareZone, LbRouting, LoadBalancerState, VpsServer } from '../../types';
import { effectiveRoutingMethod } from '../../lib/trafficHealth';

export type RouteState = 'PRD' | 'DR' | 'SPLIT' | 'MOVING' | 'UNKNOWN';

export interface OriginFlow {
  receiving: boolean;
  /** 0–100 when the steering policy fixes a share. Null when this side receives traffic but the share is not fixed. */
  percent: number | null;
}

const quiet = (): OriginFlow => ({ receiving: false, percent: null });

/**
 * Per-side traffic from the last Cloudflare load balancer read.
 * `known` is false when routing was not readable — callers must not invent a side.
 */
export function originFlows(app: Application, lb: LoadBalancerState | null): { known: boolean; prd: OriginFlow; dr: OriginFlow } {
  if (!app.loadBalancer) return { known: false, prd: quiet(), dr: quiet() };
  const r = lb?.routing.find(x => x.hostname === app.loadBalancer!.hostname);
  if (!r?.found) return { known: false, prd: quiet(), dr: quiet() };
  const traffic = r.traffic ?? (r.activePoolId ? [{ poolId: r.activePoolId, percent: 100 }] : []);
  if (traffic.length === 0) return { known: false, prd: quiet(), dr: quiet() };
  const side = (poolId: string): OriginFlow => {
    const t = traffic.find(x => x.poolId === poolId);
    if (!t) return { receiving: false, percent: 0 };
    if (t.percent === null) return { receiving: true, percent: null };
    return { receiving: t.percent > 0, percent: t.percent };
  };
  const prd = side(app.loadBalancer.prdPoolId);
  const dr = side(app.loadBalancer.drPoolId);
  if (!prd.receiving && !dr.receiving) return { known: false, prd: quiet(), dr: quiet() };
  return { known: true, prd, dr };
}

/** Whether a pool is receiving traffic. Null when routing itself is unknown. */
export function poolReceiving(routing: LbRouting | undefined, poolId: string): boolean | null {
  if (!routing?.found) return null;
  const traffic = routing.traffic ?? (routing.activePoolId ? [{ poolId: routing.activePoolId, percent: 100 }] : []);
  if (traffic.length === 0) return routing.activePoolId ? routing.activePoolId === poolId : null;
  const t = traffic.find(x => x.poolId === poolId);
  if (!t) return false;
  return t.percent === null || t.percent > 0;
}

export type VisualTraffic =
  | { kind: 'unknown' }
  | { kind: 'moving' }
  | { kind: 'single'; side: 'PRD' | 'DR' }
  | { kind: 'split'; prd: number | null; dr: number | null };

/**
 * What the traffic diagram should draw.
 * Load-balancer apps follow Cloudflare. DNS apps follow the synced record, not the last failover label.
 */
export function visualTraffic(
  app: Application,
  lb: LoadBalancerState | null,
  pointsAt: 'PRD' | 'DR' | 'OTHER' | null,
): VisualTraffic {
  const method = effectiveRoutingMethod(app);
  if (method === 'cloudflare_worker' || method === 'cloudflare_worker_failover' || method === 'custom' || method === 'unknown') {
    return { kind: 'unknown' };
  }
  if (method === 'cloudflare_lb') {
    const f = originFlows(app, lb);
    if (!f.known) return { kind: 'unknown' };
    if (f.prd.receiving && f.dr.receiving) return { kind: 'split', prd: f.prd.percent, dr: f.dr.percent };
    if (f.prd.receiving) return { kind: 'single', side: 'PRD' };
    if (f.dr.receiving) return { kind: 'single', side: 'DR' };
    return { kind: 'unknown' };
  }
  if (app.failoverState === 'FAILING_OVER') return { kind: 'moving' };
  if (pointsAt === 'PRD' || pointsAt === 'DR') return { kind: 'single', side: pointsAt };
  return { kind: 'unknown' };
}

export type DnsSide = 'PRD' | 'DR' | 'OTHER' | null;

/** Live A/AAAA target, when a synced zone contains the record. Null when the record was not read. */
export function dnsPointsAt(
  app: Application,
  servers: Array<Pick<VpsServer, 'id' | 'ip'>>,
  zones: Array<Pick<CloudflareZone, 'domain' | 'dnsRecords'>>,
): DnsSide {
  const name = app.trafficRouting?.direct.dnsRecordName || app.dnsRecordName || '';
  if (!name || !app.cloudflareZone) return null;
  const zone = zones.find(z => z.domain === app.cloudflareZone || app.cloudflareZone.endsWith(`.${z.domain}`));
  const record = zone?.dnsRecords.find(r => r.name === name && (r.type === 'A' || r.type === 'AAAA'));
  if (!record) return null;
  const prd = servers.find(s => s.id === app.prdServerId);
  const dr = servers.find(s => s.id === app.drServerId);
  if (prd?.ip && record.target === prd.ip) return 'PRD';
  if (dr?.ip && record.target === dr.ip) return 'DR';
  return 'OTHER';
}

/**
 * Which environment is serving traffic.
 * Worker, custom, and unconfigured methods stay UNKNOWN.
 * Load Balancer apps follow Cloudflare. Direct DNS follows the synced record, then a recorded failover.
 */
export function routeState(app: Application, lb: LoadBalancerState | null, pointsAt?: DnsSide): RouteState {
  const method = effectiveRoutingMethod(app);
  if (method === 'cloudflare_worker' || method === 'cloudflare_worker_failover' || method === 'custom' || method === 'unknown') return 'UNKNOWN';
  if (method === 'cloudflare_lb') {
    const f = originFlows(app, lb);
    if (!f.known) return 'UNKNOWN';
    if (f.prd.receiving && f.dr.receiving) return 'SPLIT';
    if (f.dr.receiving) return 'DR';
    if (f.prd.receiving) return 'PRD';
    return 'UNKNOWN';
  }
  if (app.failoverState === 'FAILING_OVER') return 'MOVING';
  if (pointsAt === 'PRD' || pointsAt === 'DR') return pointsAt;
  if (pointsAt === 'OTHER') return 'UNKNOWN';
  if (app.lastFailoverAt) return app.failoverState === 'DR_ACTIVE' ? 'DR' : 'PRD';
  return 'UNKNOWN';
}

export function servingLabel(state: RouteState): string {
  if (state === 'PRD') return 'PRD';
  if (state === 'DR') return 'DR';
  if (state === 'SPLIT') return 'Split';
  if (state === 'MOVING') return 'Switching';
  return 'Unknown';
}

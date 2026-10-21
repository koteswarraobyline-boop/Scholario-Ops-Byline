import { Application, LbRouting, LoadBalancerState } from '../../types';

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
  if (app.loadBalancer) {
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

/**
 * Which environment is serving traffic.
 * - Load-Balancer apps: Cloudflare's serving set. SPLIT when both pools receive traffic.
 * - DNS-record apps: the failover state Scholario Ops itself applied.
 */
export function routeState(app: Application, lb: LoadBalancerState | null): RouteState {
  if (app.loadBalancer) {
    const f = originFlows(app, lb);
    if (!f.known) return 'UNKNOWN';
    if (f.prd.receiving && f.dr.receiving) return 'SPLIT';
    if (f.dr.receiving) return 'DR';
    if (f.prd.receiving) return 'PRD';
    return 'UNKNOWN';
  }
  return app.failoverState === 'FAILING_OVER' ? 'MOVING' : app.failoverState === 'DR_ACTIVE' ? 'DR' : 'PRD';
}

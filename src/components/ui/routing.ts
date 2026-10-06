import { Application, LoadBalancerState } from '../../types';

export type RouteState = 'PRD' | 'DR' | 'MOVING' | 'UNKNOWN';

/**
 * Which environment is serving traffic.
 * - Load-Balancer apps: only what Cloudflare routing reports (first enabled + healthy pool); UNKNOWN otherwise.
 * - DNS-record apps: the failover state Scholario Ops itself applied.
 */
export function routeState(app: Application, lb: LoadBalancerState | null): RouteState {
  if (app.loadBalancer) {
    const r = lb?.routing.find(x => x.hostname === app.loadBalancer!.hostname);
    if (!r?.found || !r.activePoolId) return 'UNKNOWN';
    if (r.activePoolId === app.loadBalancer.prdPoolId) return 'PRD';
    if (r.activePoolId === app.loadBalancer.drPoolId) return 'DR';
    return 'UNKNOWN';
  }
  return app.failoverState === 'FAILING_OVER' ? 'MOVING' : app.failoverState === 'DR_ACTIVE' ? 'DR' : 'PRD';
}

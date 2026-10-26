/**
 * Three health dimensions, computed from evidence the caller already has.
 * Missing evidence is UNKNOWN, NOT_CONFIGURED or NOT_CONNECTED — never HEALTHY.
 * A public HTTP 200 does not make a VPS healthy. A missing Worker does not make a VPS unhealthy.
 */
import {
  Application, CloudflareZone, DimensionStatus, HealthDimension, LoadBalancerState, Monitor, OperationalStatus,
  TrafficRoutingConfig, TrafficRoutingMethod, VpsServer, WorkerAppSnapshot, WorkerMonitorState, WorkerRoutingEvent,
} from '../types/index.ts';

export const ROUTING_METHODS: readonly TrafficRoutingMethod[] = [
  'direct_dns', 'cloudflare_lb', 'cloudflare_worker', 'cloudflare_worker_failover', 'custom', 'unknown',
];

export const ROUTING_METHOD_LABELS: Record<TrafficRoutingMethod, string> = {
  direct_dns: 'Direct DNS / direct origin',
  cloudflare_lb: 'Cloudflare Load Balancer',
  cloudflare_worker: 'Cloudflare Worker',
  cloudflare_worker_failover: 'Cloudflare Worker with PRD/DR failover',
  custom: 'Custom / external routing',
  unknown: 'Not configured / unknown',
};

const HTTP_TYPES: Monitor['type'][] = ['HTTP', 'HTTPS', 'APP_HEALTH', 'APP_READINESS', 'API_BUSINESS'];

export function blankRouting(method: TrafficRoutingMethod = 'unknown'): TrafficRoutingConfig {
  return {
    method,
    direct: { prdHostname: '', drHostname: '', prdUrl: '', drUrl: '', dnsRecordName: '', currentTarget: '', manualFailoverStatus: 'UNKNOWN', lastVerifiedAt: null },
    worker: { name: '', route: '', accountId: '', environment: '', prdOriginHostname: '', drOriginHostname: '', failoverStrategy: '', healthCheckSource: '', failback: 'unknown' },
    custom: { description: '', endpoint: '', notes: '' },
  };
}

export function effectiveRoutingMethod(app: { trafficRouting?: { method?: TrafficRoutingMethod } | null; loadBalancer?: { accountId?: string; prdPoolId?: string } | null }): TrafficRoutingMethod {
  if (app.trafficRouting?.method && ROUTING_METHODS.includes(app.trafficRouting.method)) return app.trafficRouting.method;
  if (app.loadBalancer?.accountId && app.loadBalancer.prdPoolId) return 'cloudflare_lb';
  return 'unknown';
}

export function normalizeRouting(app: { trafficRouting?: TrafficRoutingConfig | null; loadBalancer?: { accountId?: string; prdPoolId?: string } | null }): TrafficRoutingConfig {
  const method = effectiveRoutingMethod(app);
  const base = blankRouting(method);
  const src = app.trafficRouting;
  return {
    method,
    direct: { ...base.direct, ...src?.direct },
    worker: { ...base.worker, ...src?.worker },
    custom: { ...base.custom, ...src?.custom },
  };
}

type VpsLike = Pick<VpsServer, 'lastSeen' | 'agentStatus' | 'hostname' | 'telemetry'> & { lastIngestError?: VpsServer['lastIngestError'] };

/** Operational status stored on the server row. Telemetry only. */
export function vpsOperationalStatus(srv: { lastSeen?: string; agentStatus?: string; telemetry?: { cpuPercent?: number; ramPercent?: number; diskPercent?: number; observedAt?: string } }): OperationalStatus {
  if (!srv.lastSeen) return 'UNKNOWN';
  if (srv.agentStatus === 'STALE' || srv.agentStatus === 'DISCONNECTED') return 'STALE';
  const t = srv.telemetry;
  if (!t?.observedAt) return 'UNKNOWN';
  const nums = [t.cpuPercent, t.ramPercent, t.diskPercent].filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  if (nums.length < 3) return 'UNKNOWN';
  const hot = Math.max(...nums);
  if (hot >= 95) return 'CRITICAL';
  if (hot >= 85) return 'WARNING';
  return 'HEALTHY';
}

export function explainVps(srv: VpsLike | undefined): HealthDimension {
  if (!srv) return { status: 'NOT_CONFIGURED', detail: 'No server is linked for this environment.', observedAt: null, source: 'server inventory' };
  if (!srv.lastSeen) {
    const rejected = srv.lastIngestError;
    return {
      status: 'NOT_CONNECTED',
      detail: rejected
        ? `No telemetry has been accepted. The last report was rejected at ${rejected.at}: ${rejected.reason}`
        : 'No accepted agent report. CPU, memory and disk are unknown until the agent checks in. This is not an application or routing failure. Install the agent from Setup.',
      observedAt: rejected?.at ?? null,
      source: rejected ? 'agent ingest' : 'agent heartbeat',
    };
  }
  if (srv.agentStatus === 'DISCONNECTED') {
    return { status: 'CRITICAL', detail: `Agent stopped reporting. Last accepted report ${srv.lastSeen}. Resource numbers below that time are not live.`, observedAt: srv.lastSeen, source: 'agent heartbeat' };
  }
  if (srv.agentStatus === 'STALE') {
    return { status: 'WARNING', detail: `Agent report is late. Last accepted report ${srv.lastSeen}.`, observedAt: srv.lastSeen, source: 'agent heartbeat' };
  }
  const t = srv.telemetry;
  if (!t?.observedAt) {
    return { status: 'UNKNOWN', detail: 'The agent is marked connected but no resource sample was stored.', observedAt: srv.lastSeen, source: 'agent telemetry' };
  }
  const status = vpsOperationalStatus(srv);
  const dim: DimensionStatus = status === 'HEALTHY' ? 'HEALTHY' : status === 'WARNING' ? 'WARNING' : status === 'CRITICAL' ? 'CRITICAL' : 'UNKNOWN';
  const hot = `CPU ${Math.round(t.cpuPercent)}%, memory ${Math.round(t.ramPercent)}%, disk ${Math.round(t.diskPercent)}%`;
  const why = dim === 'CRITICAL' ? `${hot}. A resource is at or above 95%.`
    : dim === 'WARNING' ? `${hot}. A resource is at or above 85%.`
      : `${hot}.`;
  return { status: dim, detail: why, observedAt: t.observedAt || srv.lastSeen, source: 'agent telemetry' };
}

function urlMonitor(monitors: Monitor[], appId: string, env: 'PRD' | 'DR'): Monitor | undefined {
  const list = monitors.filter(m => m.enabled && m.applicationId === appId && m.environment === env && HTTP_TYPES.includes(m.type));
  return list.find(m => m.managedBy === 'app-url') ?? list[0];
}

const rank: Record<DimensionStatus, number> = { NOT_CONFIGURED: 0, NOT_CONNECTED: 0, HEALTHY: 1, UNKNOWN: 2, WARNING: 3, CRITICAL: 4 };

function worse(a: DimensionStatus, b: DimensionStatus): DimensionStatus {
  return rank[b] > rank[a] ? b : a;
}

function monitorStatus(m: Monitor): DimensionStatus {
  if (!m.lastCheck) return 'UNKNOWN';
  if (m.status === 'HEALTHY' || m.status === 'WARNING' || m.status === 'CRITICAL') return m.status;
  return 'UNKNOWN';
}

export function explainApplication(app: Pick<Application, 'id'>, env: 'PRD' | 'DR', monitors: Monitor[]): HealthDimension {
  const m = urlMonitor(monitors, app.id, env);
  const ssl = monitors.find(x => x.enabled && x.applicationId === app.id && x.environment === env && x.type === 'SSL');
  const data = monitors.filter(x => x.enabled && x.applicationId === app.id && x.environment === env && (x.type === 'DB_CONN' || x.type === 'DB_REPLICATION'));
  if (!m && !ssl && data.length === 0) return { status: 'NOT_CONFIGURED', detail: `No ${env} application URL, TLS, or database monitor is configured.`, observedAt: null, source: 'application monitors' };
  let status: DimensionStatus = 'NOT_CONFIGURED';
  const parts: string[] = [];
  let observedAt: string | null = null;
  const note = (at: string) => { if (at && (!observedAt || at > observedAt)) observedAt = at; };
  if (m && !m.lastCheck) {
    status = 'UNKNOWN';
    parts.push(`${m.name} has not been checked yet.`);
  } else if (m) {
    status = monitorStatus(m);
    parts.push(`${m.name}: ${m.lastProbeStatus || m.status}${m.lastStatusCode ? ` HTTP ${m.lastStatusCode}` : ''}${m.responseTimeMs ? `, ${Math.round(m.responseTimeMs)} ms` : ''}`);
    if (m.history[0]?.detail) parts.push(m.history[0].detail);
    note(m.lastCheck);
  }
  if (ssl?.lastCheck) {
    const tls = monitorStatus(ssl);
    if (tls === 'WARNING' || tls === 'CRITICAL') status = worse(status, tls);
    parts.push(`TLS ${ssl.status}${ssl.history[0]?.detail ? ` (${ssl.history[0].detail})` : ''}`);
    note(ssl.lastCheck);
  } else if (ssl) parts.push('TLS certificate has not been checked yet');
  for (const extra of data) {
    if (!extra.lastCheck) {
      parts.push(`${extra.name} has not been checked yet`);
      continue;
    }
    status = worse(status === 'NOT_CONFIGURED' ? 'HEALTHY' : status, monitorStatus(extra));
    const lag = extra.type === 'DB_REPLICATION' && typeof extra.lastValue === 'number' ? `, lag ${extra.lastValue}s` : '';
    parts.push(`${extra.name}: ${extra.status}${lag}`);
    note(extra.lastCheck);
  }
  if (status === 'NOT_CONFIGURED') status = 'UNKNOWN';
  return { status, detail: parts.join(' — '), observedAt, source: 'application monitors' };
}

function poolLive(lb: LoadBalancerState | null, appId: string, poolId: string): boolean | null {
  const pool = lb?.pools.find(p => p.id === poolId && p.applicationId === appId);
  if (!pool?.found) return null;
  const samples = pool.origins.filter(o => o.enabled !== false).flatMap(o => {
    const pops = o.health.map(h => h.healthy).filter((x): x is boolean => x !== null);
    return pops.length ? pops : o.healthy === null ? [] : [o.healthy];
  });
  if (samples.length) return samples.every(Boolean);
  return pool.healthy;
}

export interface RoutingExplanation extends HealthDimension {
  method: TrafficRoutingMethod;
  methodLabel: string;
  currentOrigin: string;
  currentOriginKnown: boolean;
  failback: 'automatic' | 'manual' | 'unknown';
  failbackSource: string;
  lastFailoverAt: string | null;
  prdHealth: HealthDimension;
  drHealth: HealthDimension;
  warnings: string[];
  recentEvents: Array<{ at: string; kind: string; detail: string; source: string }>;
}

const unknownSide = (env: string, why: string): HealthDimension => ({ status: 'UNKNOWN', detail: why, observedAt: null, source: `${env} routing` });

export function explainRouting(args: {
  app: Application;
  servers: Array<Pick<VpsServer, 'id' | 'ip'>>;
  cloudflareConfigured: boolean;
  zones: CloudflareZone[];
  lb: LoadBalancerState | null;
  worker: WorkerAppSnapshot | null;
  events: WorkerRoutingEvent[];
  eventsConnected: boolean;
}): RoutingExplanation {
  const app = args.app;
  const events = [...args.events].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const cfg = normalizeRouting(app);
  const method = cfg.method;
  const base = {
    method,
    methodLabel: ROUTING_METHOD_LABELS[method],
    currentOrigin: 'Unknown',
    currentOriginKnown: false,
    failback: cfg.worker.failback,
    failbackSource: 'application configuration',
    lastFailoverAt: app.lastFailoverAt ?? null,
    prdHealth: unknownSide('PRD', 'Not reported by the routing integration.'),
    drHealth: unknownSide('DR', 'Not reported by the routing integration.'),
    warnings: [] as string[],
    recentEvents: events.slice(0, 20).map(e => ({ at: e.observedAt, kind: e.kind, detail: e.detail || e.origin || e.kind, source: 'worker event' })),
  };

  const finish = (status: DimensionStatus, detail: string, observedAt: string | null, source: string, extra?: Partial<RoutingExplanation>): RoutingExplanation => ({
    ...base, ...extra, status, detail, observedAt, source,
  });

  if (method === 'unknown') {
    return finish('NOT_CONFIGURED', 'Traffic routing method is not configured. Nothing is assumed about DNS, Load Balancers, or Workers.', null, 'application configuration');
  }

  if (method === 'custom') {
    const described = Boolean(cfg.custom.description || cfg.custom.endpoint);
    return finish(
      described ? 'NOT_CONNECTED' : 'NOT_CONFIGURED',
      described
        ? `Custom routing is described${cfg.custom.endpoint ? ` (${cfg.custom.endpoint})` : ''}. No external status integration is connected, so routing health is not connected.`
        : 'Custom routing is selected, but the description and endpoint are empty.',
      null,
      'application configuration',
      { currentOrigin: 'Unknown', currentOriginKnown: false },
    );
  }

  if (method === 'direct_dns') {
    const name = cfg.direct.dnsRecordName || app.dnsRecordName || '';
    if (!args.cloudflareConfigured) {
      return finish('NOT_CONNECTED', `Direct routing is saved${name ? ` for ${name}` : ''}. Live DNS state is not connected because CLOUDFLARE_API_TOKEN is not set.`, cfg.direct.lastVerifiedAt, 'dns', {
        currentOrigin: cfg.direct.currentTarget || 'Unknown',
        currentOriginKnown: Boolean(cfg.direct.currentTarget),
      });
    }
    const zone = args.zones.find(z => app.cloudflareZone && (z.domain === app.cloudflareZone || app.cloudflareZone.endsWith(`.${z.domain}`)));
    const record = name ? zone?.dnsRecords.find(r => r.name === name && (r.type === 'A' || r.type === 'AAAA')) : undefined;
    if (!name) return finish('NOT_CONFIGURED', 'Direct DNS is selected, but no DNS record name is saved.', null, 'dns');
    if (!zone) return finish('UNKNOWN', `Zone ${app.cloudflareZone || '(not set)'} has not been read, so the live target is unknown.`, null, 'dns');
    if (!record) return finish('WARNING', `DNS name ${name} was not found in the synced zone ${zone.domain}.`, zone.lastChecked, 'dns');
    const prd = args.servers.find(s => s.id === app.prdServerId);
    const dr = args.servers.find(s => s.id === app.drServerId);
    const side = record.target === prd?.ip ? 'PRD' : record.target === dr?.ip ? 'DR' : '';
    const known = Boolean(side);
    return finish(known ? 'HEALTHY' : 'WARNING', known
      ? `${name} points at ${record.target} (${side}).`
      : `${name} points at ${record.target}, which is not the linked PRD or DR address.`, record.lastModified || zone.lastChecked, 'dns', {
      currentOrigin: side || record.target,
      currentOriginKnown: known,
    });
  }

  if (method === 'cloudflare_lb') {
    const mapping = app.loadBalancer;
    if (!mapping?.accountId || !mapping.prdPoolId || !mapping.drPoolId) {
      return finish('NOT_CONFIGURED', 'Cloudflare Load Balancer is selected, but the account, hostname, or pool IDs are missing.', null, 'cloudflare load balancer');
    }
    if (!args.cloudflareConfigured || args.lb?.status === 'NOT_CONFIGURED') {
      return finish('NOT_CONNECTED', 'Load Balancer mapping is saved. The Cloudflare API token is not set, so pool health is not connected.', null, 'cloudflare load balancer');
    }
    if (args.lb?.status === 'PERMISSION_REQUIRED') {
      return finish('NOT_CONNECTED', args.lb.lastError || 'The Cloudflare token cannot read Load Balancers.', args.lb.lastSyncAt, 'cloudflare load balancer');
    }
    const prd = poolLive(args.lb, app.id, mapping.prdPoolId);
    const dr = poolLive(args.lb, app.id, mapping.drPoolId);
    const routing = args.lb?.routing.find(r => r.hostname === mapping.hostname);
    const at = args.lb?.lastSuccessAt ?? routing?.fetchedAt ?? null;
    const sideHealth = (env: 'PRD' | 'DR', live: boolean | null): HealthDimension => ({
      status: live === true ? 'HEALTHY' : live === false ? 'CRITICAL' : 'UNKNOWN',
      detail: live === true ? `${env} pool is enabled and healthy.` : live === false ? `${env} pool is unhealthy or disabled.` : `${env} pool health has not been read.`,
      observedAt: at,
      source: 'cloudflare load balancer',
    });
    let origin = 'Unknown';
    let known = false;
    if (routing?.found && routing.activePoolId) {
      if (routing.activePoolId === mapping.prdPoolId) { origin = 'PRD'; known = true; }
      else if (routing.activePoolId === mapping.drPoolId) { origin = 'DR'; known = true; }
    } else if (routing && !routing.found) base.warnings.push(routing.error || `Load Balancer hostname ${mapping.hostname} was not found.`);
    const servingDown = known && ((origin === 'PRD' && prd === false) || (origin === 'DR' && dr === false));
    const worst: DimensionStatus = prd === false && dr === false || servingDown ? 'CRITICAL'
      : prd === false || dr === false ? 'WARNING'
        : prd === true && dr === true ? 'HEALTHY'
          : 'UNKNOWN';
    return finish(worst, known
      ? `Load Balancer ${mapping.hostname} is serving ${origin}.`
      : `Load Balancer ${mapping.hostname} is mapped. The serving pool is unknown.`, at, 'cloudflare load balancer', {
      currentOrigin: origin,
      currentOriginKnown: known,
      prdHealth: sideHealth('PRD', prd),
      drHealth: sideHealth('DR', dr),
      failback: 'manual',
      failbackSource: 'Cloudflare pool order (Scholario Ops does not change it)',
    });
  }

  const worker = cfg.worker;
  const snap = args.worker;
  const failover = method === 'cloudflare_worker_failover';
  if (!worker.name) {
    return finish('NOT_CONFIGURED', 'Cloudflare Worker is selected, but the Worker name is empty. Load Balancer pool IDs are not required.', null, 'cloudflare worker');
  }
  const latest = events.find(e => e.kind === 'origin_selected' || e.kind === 'failover' || e.kind === 'failback');
  const healthEvent = events.find(e => e.prdHealth || e.drHealth) ?? latest;
  let origin = 'Unknown';
  let known = false;
  if (latest?.origin) {
    const o = latest.origin.toUpperCase();
    if (o === 'PRD' || o === 'DR') { origin = o; known = true; }
    else if (worker.prdOriginHostname && latest.origin === worker.prdOriginHostname) { origin = 'PRD'; known = true; }
    else if (worker.drOriginHostname && latest.origin === worker.drOriginHostname) { origin = 'DR'; known = true; }
  }
  const fromEvent = (value: WorkerRoutingEvent['prdHealth'], env: string): HealthDimension => ({
    status: value === 'healthy' ? 'HEALTHY' : value === 'unhealthy' ? 'CRITICAL' : 'UNKNOWN',
    detail: value ? `${env} origin reported ${value} by a Worker event.` : `${env} origin health was not included in a Worker event.`,
    observedAt: healthEvent?.observedAt ?? null,
    source: 'worker event',
  });
  const connection = !args.cloudflareConfigured || !worker.accountId
    ? 'Worker configuration is saved. Cloudflare script reads are not connected (token or account ID missing). Origin selection stays Unknown until a Worker event arrives.'
    : snap?.connection === 'verified'
      ? `Worker ${worker.name} is listed in the account${snap.lastDeployedAt ? `, last deployment ${snap.lastDeployedAt}` : ''}. Script source is not used to guess which origin is selected.`
      : snap?.connection === 'unavailable'
        ? `Worker ${worker.name} was not found in the account.`
        : snap?.detail || 'Worker configuration has not been verified yet.';
  const status: DimensionStatus = snap?.connection === 'unavailable' ? 'WARNING'
    : !args.cloudflareConfigured && !args.eventsConnected ? 'NOT_CONNECTED'
      : snap?.connection === 'not_connected' && events.length === 0 ? 'NOT_CONNECTED'
        : 'UNKNOWN';
  const detail = [
    connection,
    failover ? (known ? `Latest origin-selection event chose ${origin}.` : 'Origin selection is Unknown — no origin-selection event has been received.') : 'This Worker method does not claim automatic PRD/DR failover.',
    snap?.analytics === 'EVENTS'
      ? `Worker reported ${snap.requests ?? '—'} requests and ${snap.errors ?? '—'} errors.`
      : 'Request counts and exceptions are Not connected.',
    args.eventsConnected ? 'Worker event ingest is connected.' : 'Worker event ingest is not connected (WORKER_EVENTS_TOKEN is not set).',
  ].join(' ');
  return finish(status, detail, snap?.observedAt ?? latest?.observedAt ?? null, 'cloudflare worker', {
    currentOrigin: failover ? origin : 'Unknown',
    currentOriginKnown: failover && known,
    prdHealth: fromEvent(healthEvent?.prdHealth ?? null, 'PRD'),
    drHealth: fromEvent(healthEvent?.drHealth ?? null, 'DR'),
    warnings: snap?.connection === 'unavailable' ? [`Worker ${worker.name} was not found.`] : [],
  });
}

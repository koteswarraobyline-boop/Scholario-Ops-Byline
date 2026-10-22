/**
 * Traffic-routing methods, health dimensions, and authorization.
 * In-memory only: the store is never initialized, so nothing is written to PostgreSQL
 * and no Cloudflare, DNS, or Worker call is made.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import type { Application, Monitor, WorkerRoutingEvent } from '../src/types/index.ts';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-routing-'));
process.env.JWT_SECRET = 'routing-test-jwt-secret-0123456789abcdef';
process.env.WORKER_EVENTS_TOKEN = 'worker-events-test-token';
process.env.CLOUDFLARE_API_TOKEN = '';
process.env.DB_SCHEMA = 'ops';

const ACC = '0123456789abcdef0123456789abcdef';
const PRD_POOL = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DR_POOL = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const {
  blankRouting, effectiveRoutingMethod, explainApplication, explainRouting, explainVps, normalizeRouting, vpsOperationalStatus,
} = await import('../src/lib/trafficHealth.ts');
const { dnsPointsAt, routeState } = await import('../src/components/ui/routing.ts');
const { parseRoutingUpdate } = await import('../server/routingConfig.ts');
const { authorizeWorkerEvent, matchWorkerScript, WORKER_PERMISSION_HINT } = await import('../server/workers.ts');
const { config } = await import('../server/config.ts');
const { db } = await import('../server/store.ts');
const { FailoverError, noteIngestRejection, performFailover, publicServer, recomputeDerived } = await import('../server/engine.ts');
const { buildRouter } = await import('../server/routes.ts');
const { ValidationError } = await import('../server/validate.ts');

function application(over: Partial<Application> = {}): Application {
  return {
    id: over.id ?? crypto.randomUUID(),
    name: over.name ?? 'Panworld API',
    codeName: over.codeName ?? 'panworld-api',
    description: '',
    tier: 'TIER_1',
    status: 'UNKNOWN',
    uptime24h: null, uptime7d: null, uptime30d: null,
    rtoTargetMin: 30, rpoTargetMin: 15,
    currentReplicationLagSec: null,
    prdServerId: '', drServerId: '',
    failoverState: 'PRIMARY_ACTIVE',
    p50Ms: null, p95Ms: null, p99Ms: null, errorRatePercent: null,
    lastChecked: '',
    cloudflareZone: '',
    dependencies: [],
    ...over,
  };
}

function monitor(over: Partial<Monitor>): Monitor {
  return {
    id: crypto.randomUUID(), name: 'PRD URL', type: 'HTTP', target: 'https://app.example.com',
    applicationId: 'app', environment: 'PRD', intervalSec: 30, timeoutSec: 10, retries: 1,
    warningThresholdMs: 1000, criticalThresholdMs: 5000, failureConfirmationThreshold: 3, recoveryConfirmationThreshold: 2,
    consecutiveFailures: 0, consecutiveRecoveries: 0, status: 'HEALTHY', lastCheck: '2026-10-22T09:00:00.000Z', lastSuccess: '2026-10-22T09:00:00.000Z',
    responseTimeMs: 40, uptimePercent: 100, history: [], enabled: true, activeMaintenance: false,
    ...over,
  };
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
function accessToken(sub: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ sub, typ: 'access', ver: 0, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac('sha256', config.jwtSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

let server: Server;
let base = '';
const tokens: Record<string, string> = {};

before(async () => {
  for (const roleName of ['viewer', 'operator', 'it_administrator', 'super_admin'] as const) {
    const id = crypto.randomUUID();
    db.users.push({
      id, email: `${roleName}@routing.test`, fullName: roleName, roleName, isActive: true, isOnCall: false,
      passwordHash: 'unused', tokenVersion: 0, createdAt: new Date().toISOString(),
    });
    tokens[roleName] = accessToken(id);
  }
  const app = express();
  app.use(express.json());
  app.use('/api', buildRouter());
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});

after(() => {
  server?.close();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
});

async function call(method: string, url: string, token: string | undefined, body?: unknown) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json() as { success: boolean; message?: string; data?: Application & { id: string } };
  return { status: res.status, json };
}

test('each routing method has a label and a blank config that keeps every blob', () => {
  const methods = ['direct_dns', 'cloudflare_lb', 'cloudflare_worker', 'cloudflare_worker_failover', 'custom', 'unknown'] as const;
  for (const method of methods) {
    const cfg = blankRouting(method);
    assert.equal(cfg.method, method);
    assert.equal(cfg.direct.manualFailoverStatus, 'UNKNOWN');
    assert.equal(cfg.worker.failback, 'unknown');
    assert.equal(cfg.custom.description, '');
  }
});

test('a saved Load Balancer mapping is Cloudflare LB when no method was stored (ICT)', () => {
  const method = effectiveRoutingMethod({ loadBalancer: { accountId: ACC, hostname: 'ict.example.com', prdPoolId: PRD_POOL, drPoolId: DR_POOL } });
  assert.equal(method, 'cloudflare_lb');
});

test('an application with no Load Balancer and no method stays unknown (Panworld)', () => {
  assert.equal(effectiveRoutingMethod({}), 'unknown');
  assert.equal(effectiveRoutingMethod({ trafficRouting: blankRouting('unknown'), loadBalancer: { accountId: ACC, prdPoolId: PRD_POOL } }), 'unknown');
});

test('switching methods keeps the other configuration and refuses secrets', () => {
  const saved = parseRoutingUpdate(undefined, {
    method: 'cloudflare_worker',
    worker: { name: 'edge-router', route: 'api.example.com/*', prdOriginHostname: 'prd.internal.example', drOriginHostname: 'dr.internal.example', failback: 'manual' },
    direct: { prdHostname: 'api.example.com', dnsRecordName: 'api.example.com' },
  });
  const switched = parseRoutingUpdate(saved, { method: 'custom', custom: { description: 'External GSLB', endpoint: 'https://routing.example/status' } });
  assert.equal(switched.method, 'custom');
  assert.equal(switched.worker.name, 'edge-router');
  assert.equal(switched.direct.prdHostname, 'api.example.com');
  assert.equal(switched.custom.endpoint, 'https://routing.example/status');
  assert.throws(() => parseRoutingUpdate(saved, { method: 'custom', custom: { notes: 'ok', apiKey: 'secret' } }), ValidationError);
});

test('worker failover origin stays unknown until an event names it', () => {
  const app = application({
    trafficRouting: normalizeRouting({
      trafficRouting: { ...blankRouting('cloudflare_worker_failover'), worker: { ...blankRouting().worker, name: 'edge-router', prdOriginHostname: 'prd.internal.example', drOriginHostname: 'dr.internal.example', failback: 'manual' } },
    }),
  });
  const blind = explainRouting({ app, servers: [], cloudflareConfigured: false, zones: [], lb: null, worker: null, events: [], eventsConnected: false });
  assert.equal(blind.status, 'NOT_CONNECTED');
  assert.equal(blind.currentOriginKnown, false);
  assert.equal(blind.currentOrigin, 'Unknown');
  assert.match(blind.detail, /Not connected/);
  assert.equal(blind.prdHealth.status, 'UNKNOWN');
  const event: WorkerRoutingEvent = {
    id: 'e1', applicationId: app.id, kind: 'failover', origin: 'DR', prdHealth: 'unhealthy', drHealth: 'healthy',
    detail: 'origin selected', observedAt: '2026-10-22T10:00:00.000Z', receivedAt: '2026-10-22T10:00:01.000Z', source: 'worker_event',
  };
  const seen = explainRouting({ app, servers: [], cloudflareConfigured: false, zones: [], lb: null, worker: null, events: [event], eventsConnected: true });
  assert.equal(seen.currentOrigin, 'DR');
  assert.equal(seen.currentOriginKnown, true);
  assert.equal(seen.prdHealth.status, 'CRITICAL');
  assert.equal(seen.drHealth.status, 'HEALTHY');
  assert.equal(seen.recentEvents[0]?.kind, 'failover');
  assert.doesNotMatch(seen.detail, /request count: \d/i);
});

test('a Worker that is not connected does not fail the application or the VPS', () => {
  const srv = { lastSeen: '', agentStatus: 'DISCONNECTED' as const, hostname: 'vantage-prd', telemetry: undefined };
  const vps = explainVps(srv);
  assert.equal(vps.status, 'NOT_CONNECTED');
  assert.equal(vpsOperationalStatus(srv), 'UNKNOWN');
  assert.match(vps.detail, /not an application or routing failure/i);
  const app = application({ trafficRouting: { ...blankRouting('cloudflare_worker'), worker: { ...blankRouting().worker, name: 'edge-router' } } });
  const routing = explainRouting({ app, servers: [], cloudflareConfigured: false, zones: [], lb: null, worker: { applicationId: app.id, connection: 'not_connected', detail: 'not connected', observedAt: null, scriptFound: null, lastDeployedAt: null, requests: null, errors: null, analytics: 'NOT_CONNECTED' }, events: [], eventsConnected: false });
  assert.equal(routing.status, 'NOT_CONNECTED');
  assert.notEqual(routing.status, 'CRITICAL');
  assert.equal(vpsOperationalStatus({ lastSeen: '', agentStatus: 'DISCONNECTED' }), 'UNKNOWN');
});

test('missing telemetry stays unknown, a rejected report is recorded, and HTTP 200 does not heal the VPS', () => {
  const id = crypto.randomUUID();
  const bare = {
    id, hostname: 'vantage-prd', ip: '187.127.167.51', applicationId: '', environment: 'PRD' as const, provider: '', region: '', plan: '',
    cpuCores: 0, ramGb: 0, diskGb: 0, os: '', status: 'HEALTHY' as const, agentVersion: '', agentStatus: 'DISCONNECTED' as const, uptimeDays: 0, lastSeen: '',
    telemetry: { cpuPercent: 0, ramPercent: 0, diskPercent: 0, loadAvg: [0, 0, 0] as [number, number, number], networkInKbps: 0, networkOutKbps: 0, observedAt: '', receivedAt: '' },
    processes: [], services: [], logs: [], agentToken: 'secret-token', createdAt: new Date().toISOString(),
  };
  db.servers.push(bare);
  const app = application({ id: crypto.randomUUID(), prdServerId: id, codeName: `vantage-${id.slice(0, 8)}` });
  db.applications.push(app);
  db.monitors.push(monitor({ applicationId: app.id, serverId: id, status: 'HEALTHY', lastStatusCode: 200 }));
  recomputeDerived();
  const stored = db.servers.find(s => s.id === id)!;
  assert.equal(stored.agentStatus, 'DISCONNECTED');
  assert.equal(stored.status, 'UNKNOWN');
  assert.equal(db.applications.find(a => a.id === app.id)?.status, 'HEALTHY');
  const noMonitors = application({ codeName: `empty-${id.slice(0, 8)}` });
  db.applications.push(noMonitors);
  recomputeDerived();
  assert.equal(db.applications.find(a => a.id === noMonitors.id)?.status, 'UNKNOWN');
  noteIngestRejection(stored, 'clock skew');
  assert.equal(stored.lastSeen, '');
  assert.equal(stored.lastIngestError?.reason, 'clock skew');
  const pub = publicServer(stored);
  assert.equal(pub.vps.status, 'NOT_CONNECTED');
  assert.match(pub.vps.detail, /clock skew/);
  assert.equal('agentToken' in pub, false);
  const stale = vpsOperationalStatus({ lastSeen: new Date(Date.now() - 120_000).toISOString(), agentStatus: 'STALE', telemetry: { cpuPercent: 10, ramPercent: 10, diskPercent: 10, observedAt: new Date().toISOString() } });
  assert.equal(stale, 'STALE');
  const disconnected = vpsOperationalStatus({ lastSeen: new Date(Date.now() - 3600_000).toISOString(), agentStatus: 'DISCONNECTED', telemetry: { cpuPercent: 10, ramPercent: 10, diskPercent: 10, observedAt: new Date().toISOString() } });
  assert.equal(disconnected, 'STALE');
  assert.equal(explainVps(undefined).status, 'NOT_CONFIGURED');
});

test('custom routing and an empty Worker name are not reported as healthy', () => {
  const custom = explainRouting({
    app: application({ trafficRouting: { ...blankRouting('custom'), custom: { description: 'External', endpoint: 'https://edge.example', notes: '' } } }),
    servers: [], cloudflareConfigured: true, zones: [], lb: null, worker: null, events: [], eventsConnected: false,
  });
  assert.equal(custom.status, 'NOT_CONNECTED');
  const empty = explainRouting({
    app: application({ trafficRouting: blankRouting('cloudflare_worker') }),
    servers: [], cloudflareConfigured: true, zones: [], lb: null, worker: null, events: [], eventsConnected: true,
  });
  assert.equal(empty.status, 'NOT_CONFIGURED');
});

test('Load Balancer pool health is routing health, not VPS health', () => {
  const app = application({
    name: 'ICT',
    loadBalancer: { accountId: ACC, hostname: 'ict.example.com', prdPoolId: PRD_POOL, drPoolId: DR_POOL },
    trafficRouting: blankRouting('cloudflare_lb'),
  });
  const missing = explainRouting({ app, servers: [], cloudflareConfigured: false, zones: [], lb: { status: 'NOT_CONFIGURED', pools: [], routing: [], lastSyncAt: null, lastSuccessAt: null, lastError: null }, worker: null, events: [], eventsConnected: false });
  assert.equal(missing.status, 'NOT_CONNECTED');
  const live = explainRouting({
    app, servers: [], cloudflareConfigured: true, zones: [], worker: null, events: [], eventsConnected: false,
    lb: {
      status: 'OK', lastSyncAt: '2026-10-22T10:00:00.000Z', lastSuccessAt: '2026-10-22T10:00:00.000Z', lastError: null,
      pools: [
        { id: PRD_POOL, applicationId: app.id, name: 'prd', found: true, healthy: false, enabled: true, origins: [], error: null },
        { id: DR_POOL, applicationId: app.id, name: 'dr', found: true, healthy: true, enabled: true, origins: [], error: null },
      ],
      routing: [{ hostname: 'ict.example.com', found: true, activePoolId: PRD_POOL, traffic: [{ poolId: PRD_POOL, percent: 100 }], fetchedAt: '2026-10-22T10:00:00.000Z', error: null }],
    },
  });
  assert.equal(live.prdHealth.status, 'CRITICAL');
  assert.equal(live.drHealth.status, 'HEALTHY');
  assert.equal(live.currentOrigin, 'PRD');
  assert.notEqual(vpsOperationalStatus({ lastSeen: '' }), 'CRITICAL');
});

test('application health is the monitor, and a missing DR monitor is not configured', () => {
  const app = application();
  const prd = explainApplication(app, 'PRD', [monitor({ applicationId: app.id, status: 'HEALTHY', lastStatusCode: 200 })]);
  assert.equal(prd.status, 'HEALTHY');
  assert.match(prd.detail, /HTTP 200/);
  const dr = explainApplication(app, 'DR', []);
  assert.equal(dr.status, 'NOT_CONFIGURED');
});

test('worker event ingest is unauthorized without the server token and does not invent analytics', () => {
  const previous = config.workerEventsToken;
  config.workerEventsToken = '';
  const closed = authorizeWorkerEvent('Bearer something');
  assert.equal(closed.ok, false);
  if (!closed.ok) assert.equal(closed.status, 503);
  config.workerEventsToken = previous;
  const bad = authorizeWorkerEvent('Bearer wrong');
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.status, 401);
  assert.equal(authorizeWorkerEvent(`Bearer ${previous}`).ok, true);
  assert.match(WORKER_PERMISSION_HINT, /Workers Scripts/);
  assert.equal(matchWorkerScript([{ id: 'Edge-Router', modified_on: '2026-10-01T00:00:00Z' }], 'edge-router')?.id, 'Edge-Router');
});

test('DNS failover is refused for Load Balancer, Worker, and custom routing', async () => {
  const baseApp = application({ prdServerId: 'prd', drServerId: 'dr', cloudflareZone: 'example.com', dnsRecordName: 'app.example.com' });
  for (const method of ['cloudflare_lb', 'cloudflare_worker', 'cloudflare_worker_failover', 'custom'] as const) {
    await assert.rejects(
      () => performFailover({ ...baseApp, id: crypto.randomUUID(), trafficRouting: blankRouting(method), loadBalancer: method === 'cloudflare_lb' ? { accountId: ACC, hostname: 'app.example.com', prdPoolId: PRD_POOL, drPoolId: DR_POOL } : undefined }, 'DR', 'tester', 'drill'),
      (err: unknown) => err instanceof FailoverError && err.status === 409,
    );
  }
});

test('configuration changes require an administrator and failover requires a super admin', async () => {
  const anon = await call('POST', '/v1/applications', undefined, { name: 'X', codeName: 'x' });
  assert.equal(anon.status, 401);
  const viewer = await call('POST', '/v1/applications', tokens.viewer, { name: 'X', codeName: 'x-viewer' });
  assert.equal(viewer.status, 403);
  const operator = await call('POST', '/v1/applications/missing/failover', tokens.operator, { target: 'DR', reason: 'drill' });
  assert.equal(operator.status, 403);
  const adminFailover = await call('POST', '/v1/applications/missing/failover', tokens.it_administrator, { target: 'DR', reason: 'drill' });
  assert.equal(adminFailover.status, 403);
  const missing = await call('POST', '/v1/applications/missing/failover', tokens.super_admin, { target: 'DR', reason: 'drill' });
  assert.equal(missing.status, 404);
});

test('Panworld can be saved as a Worker without pool IDs, and ICT Load Balancer fields stay when the method changes', async () => {
  const worker = await call('POST', '/v1/applications', tokens.it_administrator, {
    name: 'Panworld API', codeName: `panworld-${crypto.randomUUID().slice(0, 8)}`, tier: 'TIER_1',
    trafficRouting: { method: 'cloudflare_worker', worker: { name: 'panworld-edge', route: 'api.panworld.example/*' } },
  });
  assert.equal(worker.status, 201, worker.json.message);
  assert.equal(worker.json.data?.loadBalancer, undefined);
  assert.equal(worker.json.data?.trafficRouting?.method, 'cloudflare_worker');
  assert.equal(worker.json.data?.autoFailover, false);

  const needsPools = await call('POST', '/v1/applications', tokens.it_administrator, {
    name: 'Needs pools', codeName: `needs-pools-${crypto.randomUUID().slice(0, 8)}`,
    trafficRouting: { method: 'cloudflare_lb' },
  });
  assert.equal(needsPools.status, 400);
  assert.match(needsPools.json.message ?? '', /pool/i);

  const ict = await call('POST', '/v1/applications', tokens.it_administrator, {
    name: 'ICT', codeName: `ict-${crypto.randomUUID().slice(0, 8)}`, tier: 'TIER_1',
    trafficRouting: { method: 'cloudflare_lb' },
    loadBalancer: { accountId: ACC, hostname: 'ict.example.com', prdPoolId: PRD_POOL, drPoolId: DR_POOL },
    autoFailover: true,
  });
  assert.equal(ict.status, 400);
  assert.match(ict.json.message ?? '', /not available/i);

  const saved = await call('POST', '/v1/applications', tokens.it_administrator, {
    name: 'ICT', codeName: `ict-ok-${crypto.randomUUID().slice(0, 8)}`, tier: 'TIER_1',
    trafficRouting: { method: 'cloudflare_lb', worker: { name: 'kept-worker' } },
    loadBalancer: { accountId: ACC, hostname: `ict-${crypto.randomUUID().slice(0, 8)}.example.com`, prdPoolId: PRD_POOL, drPoolId: DR_POOL },
  });
  assert.equal(saved.status, 201, saved.json.message);
  const id = saved.json.data!.id;
  const patched = await call('PATCH', `/v1/applications/${id}`, tokens.it_administrator, {
    trafficRouting: { method: 'cloudflare_worker_failover' },
  });
  assert.equal(patched.status, 200, patched.json.message);
  assert.equal(patched.json.data?.trafficRouting?.method, 'cloudflare_worker_failover');
  assert.equal(patched.json.data?.trafficRouting?.worker.name, 'kept-worker');
  assert.equal(patched.json.data?.loadBalancer?.prdPoolId, PRD_POOL);
  assert.equal(patched.json.data?.autoFailover, false);
});

test('worker event ingest rejects a bad token and does not require a session', async () => {
  const res = await fetch(`${base}/v1/worker-events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
    body: JSON.stringify({ application: 'panworld-api', kind: 'health' }),
  });
  assert.equal(res.status, 401);
  const previous = config.workerEventsToken;
  config.workerEventsToken = '';
  const closed = await fetch(`${base}/v1/worker-events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer something' },
    body: JSON.stringify({ application: 'panworld-api', kind: 'health' }),
  });
  config.workerEventsToken = previous;
  assert.equal(closed.status, 503);
});

test('a healthy serving pool with a down standby is a routing warning, and database checks change application health', () => {
  const app = application({
    name: 'ICT',
    loadBalancer: { accountId: ACC, hostname: 'ict.example.com', prdPoolId: PRD_POOL, drPoolId: DR_POOL },
    trafficRouting: blankRouting('cloudflare_lb'),
  });
  const explained = explainRouting({
    app, servers: [], cloudflareConfigured: true, zones: [], worker: null, events: [], eventsConnected: false,
    lb: {
      status: 'OK', lastSyncAt: '2026-10-22T10:00:00.000Z', lastSuccessAt: '2026-10-22T10:00:00.000Z', lastError: null, accountId: ACC,
      pools: [
        { id: PRD_POOL, applicationId: app.id, name: 'prd', description: '', enabled: true, healthy: true, role: 'PRD', found: true, origins: [], listFetchedAt: null, healthFetchedAt: null, healthError: null },
        { id: DR_POOL, applicationId: app.id, name: 'dr', description: '', enabled: true, healthy: false, role: 'DR', found: true, origins: [], listFetchedAt: null, healthFetchedAt: null, healthError: null },
      ],
      routing: [{ hostname: 'ict.example.com', found: true, enabled: true, proxied: true, steeringPolicy: 'off', defaultPools: [PRD_POOL], fallbackPool: DR_POOL, activePoolId: PRD_POOL, traffic: [{ poolId: PRD_POOL, percent: 100 }], fetchedAt: '2026-10-22T10:00:00.000Z', error: null }],
    },
  });
  assert.equal(explained.status, 'WARNING');
  assert.equal(explained.currentOrigin, 'PRD');
  assert.equal(explained.drHealth.status, 'CRITICAL');
  const db = monitor({ applicationId: app.id, type: 'DB_REPLICATION', status: 'CRITICAL', name: 'PRD replication', lastValue: 90 });
  const http = monitor({ applicationId: app.id, status: 'HEALTHY', lastStatusCode: 200 });
  const combined = explainApplication(app, 'PRD', [http, db]);
  assert.equal(combined.status, 'CRITICAL');
  assert.match(combined.detail, /lag 90s/);
});

test('Worker and unconfigured applications are not labelled as serving PRD', () => {
  const worker = application({ trafficRouting: blankRouting('cloudflare_worker') });
  assert.equal(routeState(worker, null), 'UNKNOWN');
  const freshDns = application({
    cloudflareZone: 'example.com', dnsRecordName: 'app.example.com', prdServerId: 'prd', drServerId: 'dr',
    trafficRouting: blankRouting('direct_dns'), failoverState: 'PRIMARY_ACTIVE',
  });
  assert.equal(routeState(freshDns, null), 'UNKNOWN');
  assert.equal(dnsPointsAt(freshDns, [{ id: 'prd', ip: '187.127.167.51' }, { id: 'dr', ip: '201.18.193.125' }], [{
    domain: 'example.com',
    dnsRecords: [{ id: 'r', type: 'A', name: 'app.example.com', target: '187.127.167.51', proxied: false, ttl: 1, lastModified: '2026-10-22T10:00:00.000Z' }],
  }]), 'PRD');
  assert.equal(routeState(freshDns, null, 'PRD'), 'PRD');
});

test('the routing migration backfills without changing Load Balancer rows', () => {
  const sql = fs.readFileSync(path.resolve('server/migrations/012_traffic_routing.sql'), 'utf8');
  assert.match(sql, /ON CONFLICT \(application_id\) DO NOTHING/);
  assert.match(sql, /application_load_balancers/);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  assert.doesNotMatch(sql, /DELETE FROM/i);
  assert.match(sql, /cloudflare_worker_failover/);
});

test('a direct DNS record that is not the linked address is a warning, not healthy', () => {
  const app = application({
    prdServerId: 'prd', drServerId: 'dr', cloudflareZone: 'example.com',
    trafficRouting: { ...blankRouting('direct_dns'), direct: { ...blankRouting().direct, dnsRecordName: 'app.example.com', prdHostname: 'app.example.com' } },
  });
  const explained = explainRouting({
    app,
    servers: [{ id: 'prd', ip: '187.127.167.51' }, { id: 'dr', ip: '201.18.193.125' }],
    cloudflareConfigured: true,
    zones: [{ domain: 'example.com', zoneId: 'z', lastChecked: '2026-10-22T10:00:00.000Z', dnsRecords: [{ id: 'r', name: 'app.example.com', type: 'A', target: '203.0.113.9', proxied: false, ttl: 1, lastModified: '2026-10-22T10:00:00.000Z' }] }],
    lb: null, worker: null, events: [], eventsConnected: false,
  });
  assert.equal(explained.status, 'WARNING');
  assert.equal(explained.currentOriginKnown, false);
});

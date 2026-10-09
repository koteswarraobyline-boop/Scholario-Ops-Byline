/**
 * Server drawer tabs render for every telemetry shape without crashing and never show made-up
 * values: never-reported server, agent 3.2 (no 3.3 sections), full 3.3 telemetry, and a server
 * whose sources report null (PM2 not running, no swap, no inode table). Rendered to HTML with
 * react-dom/server — no browser needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  OverviewTab, ResourcesTab, ApplicationsTab, ServicesTab, NetworkTab, StorageTab, DatabaseTab, AgentTab,
} from '../src/components/infrastructure/ServerTabs.tsx';
import type { VpsServer } from '../src/types/index.ts';

const base = (): VpsServer => ({
  id: 'srv-1', hostname: 'prd-1', ip: '203.0.113.10', applicationId: '', environment: 'PRD', provider: '', region: '', plan: '',
  cpuCores: 0, ramGb: 0, diskGb: 0, os: '', status: 'UNKNOWN', agentVersion: '', agentStatus: 'DISCONNECTED', uptimeDays: 0, lastSeen: '',
  telemetry: { cpuPercent: 0, ramPercent: 0, diskPercent: 0, loadAvg: [0, 0, 0], networkInKbps: 0, networkOutKbps: 0, observedAt: '', receivedAt: '' },
  processes: [], services: [], logs: [],
});
const now = new Date().toISOString();

const never = base();
const v32: VpsServer = {
  ...base(), agentVersion: '3.2.0', agentStatus: 'CONNECTED', lastSeen: now, cpuCores: 2, os: 'Ubuntu 24.04', status: 'HEALTHY',
  telemetry: { cpuPercent: 12, ramPercent: 40, diskPercent: 55, loadAvg: [0.2, 0.1, 0.1], networkInKbps: 800, networkOutKbps: 200, observedAt: now, receivedAt: now, memTotalMb: 4000, memUsedMb: 1600, memAvailableMb: 2400, diskTotalGb: 80, diskUsedGb: 44, diskFreeGb: 36, uptimeSec: 90000 },
  services: [{ name: 'nginx', status: 'active', version: '', pid: 1, memoryMb: 20, cpuPercent: 0, lastRestart: '' }],
  agent: { state: 'ONLINE', version: '3.2.0', expectedVersion: '3.3.0', outdated: true, startedAt: null, restartCount: 0, lastSeen: now, observedAt: now, receivedAt: now, sentAt: null, transportDelayMs: null, clockSkewMs: null, sourceIp: '203.0.113.10', errors: [] },
  health: [{ key: 'pm2', label: 'PM2', level: 'UNKNOWN', detail: 'Not reported (agent < 3.3)' }],
  warnings: [{ key: 'agent-outdated', category: 'agent', level: 'WARNING', message: 'Outdated agent v3.2.0', alert: false }],
};
const full: VpsServer = {
  ...v32, agentVersion: '3.3.0',
  telemetry: { ...v32.telemetry, cpuIowaitPercent: 30, cpuStealPercent: 0.5, loadPerCore: 0.1, swapTotalMb: 1024, swapUsedMb: 900, swapFreeMb: 124, swapPercent: 87.9, pressure: { cpu: 1, memory: null, io: 2 }, diskReadBytesPerSec: 2048, diskWriteBytesPerSec: 4096, diskReadOpsPerSec: 1, diskWriteOpsPerSec: 2, diskUtilPercent: 4 },
  filesystems: [{ mountPoint: '/', filesystem: 'ext4', device: '/dev/vda1', totalGb: 80, usedGb: 44, freeGb: 36, usedPercent: 55, inodeTotal: 5000000, inodeUsed: 100000, inodeFree: 4900000, inodePercent: 2 },
    { mountPoint: '/data', filesystem: 'btrfs', device: '/dev/vdb', totalGb: 100, usedGb: 96, freeGb: 4, usedPercent: 96, inodeTotal: null, inodeUsed: null, inodeFree: null, inodePercent: null }],
  networkInterfaces: [{ name: 'eth0', rxBytesPerSec: 1500000, txBytesPerSec: null, rxPacketsPerSec: 10, txPacketsPerSec: null, rxErrors: 1, txErrors: 0, rxDrops: 2, txDrops: 0, newErrors: 1, newDrops: null, operationalState: 'up', virtual: false }],
  diskIo: [{ device: 'vda', readBytesPerSec: 2048, writeBytesPerSec: 4096, readOpsPerSec: 1, writeOpsPerSec: 2, ioUtilizationPercent: 4, readLatencyMs: null, writeLatencyMs: 2 }],
  services: [{ name: 'nginx', status: 'failed', version: '', pid: 0, memoryMb: 0, cpuPercent: 0, lastRestart: '', activeState: 'failed', subState: 'failed', failed: true, restartCount: 5, result: 'exit-code' }],
  failedUnits: { count: 2, units: ['nginx.service', 'certbot.service'], observedAt: now },
  pm2: [{ id: 0, name: 'scholario-ops', status: 'errored', pid: null, cpuPercent: null, memoryMb: null, uptimeSec: null, startedAt: null, restartCount: 12, unstableRestarts: 1, recentRestarts: 11, nodeVersion: '22.11.0', interpreter: 'node', execMode: 'fork', instances: 1, version: '1.0.0', release: '20261008-101500-abc1234', gitRevision: null, owner: 'root', ports: [4100] }],
  pm2ObservedAt: now,
  appHealth: [{ applicationId: 'a1', name: 'Ops', environment: 'PRD', port: 4100, path: '/api/health/live', listening: false, status: 'DOWN', statusCode: null, latencyMs: null, error: 'nothing accepting connections on 127.0.0.1:4100', checkedAt: now, consecutiveFailures: 3 }],
  listeningPorts: [{ address: '0.0.0.0', port: 80, process: 'nginx', pids: [1], scope: 'all' }],
  ntp: { synchronized: false, ntpEnabled: true, service: null, clockOffsetMs: null, clockDriftPpm: null, observedAt: now },
  system: { kernelVersion: '6.8.0-45-generic', architecture: 'x86_64', bootTime: '2026-10-01T00:00:00Z', timezone: null, osName: 'Ubuntu', osVersion: '24.04', nodeVersion: null, npmVersion: null },
  databases: [{ engine: 'postgresql', name: 'app', available: false, latencyMs: null, version: null, sizeBytes: null, connections: null, maxConnections: null, longRunningQueries: null, connectionUsagePercent: null, replication: null, error: 'connection refused', observedAt: now }],
  agentTiming: { sentAt: now, transportDelayMs: 15, clockSkewMs: 45000 },
  agent: { ...v32.agent!, version: '3.3.0', outdated: false, clockSkewMs: 45000, transportDelayMs: 15 },
  warnings: [{ key: 'clock-skew', category: 'time', level: 'CRITICAL', message: 'Clock skew 45000 ms', alert: true }],
};
const nulls: VpsServer = { ...full, pm2: null, listeningPorts: null, ntp: null, failedUnits: null, telemetry: { ...full.telemetry, swapTotalMb: 0, swapPercent: null, pressure: null }, filesystems: [], networkInterfaces: [], diskIo: [], appHealth: [], databases: [] };

const TABS = { OverviewTab, ResourcesTab, ApplicationsTab, ServicesTab, NetworkTab, StorageTab, DatabaseTab, AgentTab };
const render = (server: VpsServer, isDark = true) =>
  Object.fromEntries(Object.entries(TABS).map(([name, C]) => [name, renderToString(React.createElement(C as React.FC<{ server: VpsServer; isDark: boolean }>, { server, isDark }))]));

test('every tab renders for never-reported, agent 3.2, full 3.3 and null-source servers, in dark and light theme', () => {
  for (const s of [never, v32, full, nulls]) for (const dark of [true, false]) {
    const html = render(s, dark);
    for (const [name, h] of Object.entries(html)) assert.ok(h.length > 0, `${name} rendered empty`);
    assert.equal(Object.values(html).join('').includes('NaN'), false, `NaN rendered for ${s.agentVersion || 'never'}`);
  }
});

test('missing telemetry is labelled, never shown as zero or healthy', () => {
  const n = render(never);
  assert.match(n.ResourcesTab, /never reported/);
  assert.match(n.ApplicationsTab, /never reported/);
  assert.match(n.DatabaseTab, /agent not connected/);
  const old = render(v32);
  assert.match(old.ApplicationsTab, /PM2 data: Not reported — needs agent 3\.3/);
  assert.match(old.StorageTab, /Only the root filesystem is reported/);
  assert.match(old.NetworkTab, /needs agent 3\.3/);
  assert.match(old.ResourcesTab, /needs agent 3\.3/);
  const nu = render(nulls);
  assert.match(nu.ApplicationsTab, /PM2 is not running on this server/);
  assert.match(nu.NetworkTab, /could not list listening ports/);
  assert.match(nu.ResourcesTab, /no swap configured/);
});

test('problems are explicit: outdated agent, clock issue, failed services, PM2 errored, health check failed, inode n/a', () => {
  assert.match(render(v32).OverviewTab, /Outdated agent/i);
  assert.match(render(v32).AgentTab, /OUTDATED/);
  const f = render(full);
  assert.match(f.AgentTab, /Clock synchronization issue/i);
  assert.match(f.ServicesTab, /Failed services:/);
  assert.match(f.ServicesTab, /FAILED/);
  assert.match(f.ServicesTab, /certbot\.service/);
  assert.match(f.ApplicationsTab, /ERRORED/);
  assert.match(f.ApplicationsTab, /Application health check failed/i);
  assert.match(f.StorageTab, /n\/a/, 'btrfs inode usage is n/a, not 0%');
  assert.match(f.DatabaseTab, /UNAVAILABLE/);
  assert.match(f.NetworkTab, /all interfaces/);
  assert.equal(/restart|Restart service|Stop|Kill/.test(f.ServicesTab.replace(/Restart count|restarts?\b/gi, '')), false, 'no remediation actions in the UI');
});

test('status is never conveyed by colour alone: badges carry an icon and a word', () => {
  const html = render(full).OverviewTab + render(full).ServicesTab;
  assert.match(html, /<svg[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg><span>(Healthy|Warning|Critical|Unknown|FAILED|\d+|Connected)<\/span>/);
});

// ── Dead-man heartbeat stream (monitored infrastructure) ────────────────────
import { DeadManPanel } from '../src/components/visuals/HeartbeatPulseChart.tsx';
import { nodeState, filterRecords, typeTotals, stateCounts, incidentFor, DEFAULT_FILTERS } from '../src/lib/heartbeatView.ts';
import type { DeadManControlPlane, HeartbeatCheck, HeartbeatGroup, ServerHeartbeat, Incident, Application } from '../src/types/index.ts';

const NOW = Date.parse('2026-10-08T10:00:00Z');
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const hc = (over: Partial<HeartbeatCheck> & Pick<HeartbeatCheck, 'kind' | 'key' | 'name'>): HeartbeatCheck => ({
  state: 'HEALTHY', detail: 'ok', target: null, lastCheckAt: ago(5), lastSuccessAt: ago(5), latencyMs: null, failures: 0, httpStatus: null, restartCount: null, intervalSec: 10, toleranceSec: 60, ...over,
});
const grp = (checks: HeartbeatCheck[]): HeartbeatGroup => ({
  state: checks.some(c => c.state === 'FAILING') ? 'FAILING' : checks.some(c => c.state === 'DEGRADED') ? 'DEGRADED' : checks.some(c => c.state === 'UNKNOWN') ? 'UNKNOWN' : 'HEALTHY',
  total: checks.length, healthy: checks.filter(c => c.state === 'HEALTHY').length, checks,
});
const serverCheck = (over: Partial<HeartbeatCheck> = {}) => hc({ kind: 'SERVER', key: 'server', name: 'Server heartbeat', detail: 'Agent v3.3.0 CONNECTED', latencyMs: 15, ...over });
const app = (env: string, over: Partial<HeartbeatCheck> = {}) => hc({ kind: 'APPLICATION', key: `app:ict:4100`, name: 'ICT Production', target: '127.0.0.1:4100/health', latencyMs: 4, httpStatus: 200, detail: `HTTP 200 (${env})`, ...over });
const svc = (name: string, over: Partial<HeartbeatCheck> = {}) => hc({ kind: 'SERVICE', key: `service:${name}`, name, detail: 'running', target: 'systemd', ...over });
const dbc = (over: Partial<HeartbeatCheck> = {}) => hc({ kind: 'DATABASE', key: 'db:mariadb:ict', name: 'mariadb ict', latencyMs: 3, detail: '10.11', target: 'mariadb', ...over });
const node = (env: 'PRD' | 'DR', over: Partial<ServerHeartbeat> = {}): ServerHeartbeat => ({
  serverId: `srv-${env}`, hostname: `${env.toLowerCase()}-vps.example.com`, ip: env === 'PRD' ? '93.127.167.135' : '187.126.113.32', environment: env, agentVersion: '3.3.0', state: 'HEALTHY',
  server: serverCheck(), applications: grp([app(env)]), services: grp([svc('nginx'), svc('pm2-root'), svc('mariadb')]), databases: grp([dbc()]), ...over,
});
const stream = (servers: ServerHeartbeat[]): DeadManControlPlane => {
  const all = servers.flatMap(s => [s.server, ...s.applications.checks, ...s.services.checks, ...s.databases.checks]);
  const st = all.some(c => c.state === 'FAILING') ? 'FAILING' : all.some(c => c.state === 'DEGRADED') ? 'DEGRADED' : all.some(c => c.state === 'UNKNOWN') ? 'UNKNOWN' : 'HEALTHY';
  return {
    id: 'deadman-infrastructure', name: 'Dead-Man Watchdog Heartbeat Stream', status: servers.length ? st : 'NOT_CONFIGURED', evaluatedAt: ago(0), telemetryIntervalSec: 10, staleAfterSec: 60, disconnectedAfterSec: 600, servers,
    counts: { total: all.length, healthy: all.filter(c => c.state === 'HEALTHY').length, degraded: all.filter(c => c.state === 'DEGRADED').length, failing: all.filter(c => c.state === 'FAILING').length, unknown: all.filter(c => c.state === 'UNKNOWN').length },
  };
};
/** ICT stopped on PRD: the PRD agent keeps reporting (server CONNECTED), the application heartbeat fails */
const ictDown = () => stream([
  node('PRD', { applications: grp([app('PRD', { state: 'FAILING', failures: 4, httpStatus: null, latencyMs: null, lastSuccessAt: ago(120), detail: 'Health check failing: timed out' })]) }),
  node('DR'),
]);
const healthy = () => stream([node('PRD'), node('DR')]);
// Text nodes are joined (React SSR separates them with <!-- -->); SVG namespace URLs are not data
const html = (d: DeadManControlPlane, props: Record<string, unknown> = {}) =>
  renderToString(React.createElement(DeadManPanel, { deadMan: d, isDark: true, now: NOW, ...props })).replace(/<!-- -->/g, '').replace(/ xmlns="[^"]*"/g, '');

test('heartbeat 1: default view is server-first and collapsed — servers with summaries, no per-service list', () => {
  const h = html(healthy());
  assert.match(h, /Dead-Man Watchdog Heartbeat Stream/);
  assert.match(h, /SYNCHRONIZED/);
  assert.match(h, /PRD VPS · 93\.127\.167\.135/);
  assert.match(h, /DR VPS · 187\.126\.113\.32/);
  assert.match(h, /Agent v3\.3\.0 · last report 5s ago · every 10s · delivery 15 ms/);
  assert.match(h, /Overall node/);
  assert.match(h, />Server<\/span>.*CONNECTED/s);
  assert.match(h, /Apps.*1\/1/s);
  assert.match(h, /Services.*3\/3/s);
  assert.match(h, /DB.*1\/1/s);
  assert.equal(h.includes('pm2-root'), false, 'individual services stay hidden while collapsed');
  assert.equal((h.match(/aria-expanded="false"/g) ?? []).length, 2);
  for (const s of ['Heartbeat type', 'Status', 'Server']) assert.match(h, new RegExp(`aria-label="${s}"`));
  assert.match(h, /HEARTBEAT STATUS|Heartbeat status/);
  assert.match(h, /12 Healthy/);
  assert.match(h, /Servers<\/span> <b[^>]*>2\/2</);
  assert.match(h, /Services<\/span> <b[^>]*>6\/6</);
  assert.match(h, /UI stream: 1 Hz refresh \(animation only\)/);
  assert.equal(/https?:\/\//.test(h), false, 'no URL / external watchdog');
});

test('heartbeat 2: expanding PRD shows SERVER / APPLICATIONS / SERVICES / DATABASE with each heartbeat', () => {
  const h = html(healthy(), { initialExpanded: ['srv-PRD'] });
  assert.equal((h.match(/aria-expanded="true"/g) ?? []).length, 1);
  for (const s of ['>Server<', '>Applications<', '>Services<', '>Database<', 'ICT Production', 'pm2-root', 'mariadb ict', '127.0.0.1:4100/health', 'Server heartbeat · agent v3.3.0']) assert.ok(h.includes(s), s);
});

test('heartbeat 3–8: type, status and server filters — alone and combined', () => {
  const d = ictDown();
  const apps = html(d, { initialFilters: { type: 'APPLICATION' } });
  assert.match(apps, /2 matching heartbeats/);
  assert.equal(apps.includes('pm2-root'), false);
  const svcs = html(d, { initialFilters: { type: 'SERVICE' } });
  assert.match(svcs, /6 matching heartbeats/);
  assert.equal(svcs.includes('ICT Production'), false);
  const dbs = html(d, { initialFilters: { type: 'DATABASE' } });
  assert.match(dbs, /2 matching heartbeats/);
  assert.match(dbs, /mariadb ict/);
  const srvs = html(d, { initialFilters: { type: 'SERVER' } });
  assert.match(srvs, /2 matching heartbeats/);
  assert.match(srvs, /CONNECTED/);
  const failingApps = html(d, { initialFilters: { type: 'APPLICATION', status: 'FAILING' } });
  assert.match(failingApps, /1 matching heartbeat</);
  assert.match(failingApps, /ICT Production.*— PRD/s);
  assert.equal(/— DR/.test(failingApps), false, 'nothing healthy in a FAILING filter');
  assert.match(failingApps, /last success 2m 0s ago/);
  assert.match(failingApps, /4 consecutive failure/);
  assert.match(failingApps, /HTTP — no response/);
  const healthySvcPrd = filterRecords(d, { type: 'SERVICE', status: 'HEALTHY', server: 'PRD' });
  assert.deepEqual(healthySvcPrd.map(r => `${r.server.environment}:${r.check.name}`), ['PRD:nginx', 'PRD:pm2-root', 'PRD:mariadb']);
  assert.equal(filterRecords(d, { type: 'APPLICATION', status: 'FAILING', server: 'DR' }).length, 0);
  assert.equal(filterRecords(d, { type: 'DATABASE', status: 'FAILING', server: 'DR' }).length, 0);
  // Server filter alone keeps the server-first view, only that server
  const prdOnly = html(d, { initialFilters: { server: 'PRD' } });
  assert.match(prdOnly, /PRD VPS/);
  assert.equal(prdOnly.includes('DR VPS ·'), false);
  assert.match(html(d, { initialFilters: { type: 'DATABASE', status: 'FAILING' } }), /No heartbeats match these filters/);
});

test('heartbeat 9–11 + ICT case: stopped application fails its heartbeat, the server stays CONNECTED, the node is FAILING with the reason visible collapsed', () => {
  assert.equal(nodeState(node('PRD')).state, 'HEALTHY', 'healthy app on a healthy server');
  const d = ictDown();
  const prd = d.servers[0];
  assert.equal(prd.server.state, 'HEALTHY', 'the server heartbeat itself is untouched');
  const n = nodeState(prd);
  assert.equal(n.state, 'FAILING');
  assert.match(n.reasons[0], /1 application heartbeat failing \(ICT Production\)/);
  const h = html(d);
  assert.match(h, /PRD VPS.*Overall node.*FAILING/s);
  assert.match(h, /Reason: 1 application heartbeat failing \(ICT Production\)/);
  assert.match(h, /Apps.*0\/1/s);
  assert.match(h, /1 failing/);
  // First failure only → DEGRADED, not FAILING
  const first = node('PRD', { applications: grp([app('PRD', { state: 'DEGRADED', failures: 1 })]) });
  assert.equal(nodeState(first).state, 'DEGRADED');
});

test('heartbeat 12: agent stopped → server STALE then DISCONNECTED; the node follows', () => {
  const stale = node('PRD', { server: serverCheck({ state: 'DEGRADED', lastSuccessAt: ago(90), detail: 'Agent v3.3.0 STALE · 8 report(s) missed', failures: 8 }),
    applications: grp([app('PRD', { state: 'UNKNOWN' })]), services: grp([svc('nginx', { state: 'UNKNOWN' })]), databases: grp([dbc({ state: 'UNKNOWN' })]) });
  assert.equal(nodeState(stale).state, 'DEGRADED');
  assert.match(nodeState(stale).reasons[0], /stale/);
  const gone = node('PRD', { server: serverCheck({ state: 'FAILING', lastSuccessAt: ago(900), detail: 'Agent v3.3.0 DISCONNECTED' }) });
  assert.equal(nodeState(gone).state, 'DISCONNECTED');
  const h = html(stream([gone, node('DR')]));
  assert.match(h, /Overall node.*DISCONNECTED/s);
  assert.match(h, /Server heartbeat disconnected/);
});

test('heartbeat 13: not-configured categories are NOT CONFIGURED, never counted as healthy', () => {
  const bare = node('DR', { applications: grp([]), databases: grp([]) });
  assert.equal(nodeState(bare).state, 'HEALTHY', 'nothing configured is not a problem…');
  const d = stream([bare]);
  const t = typeTotals(d);
  assert.deepEqual(t.APPLICATION, { healthy: 0, total: 0 }, '…and not counted as healthy');
  assert.deepEqual(t.DATABASE, { healthy: 0, total: 0 });
  const h = html(d, { initialExpanded: ['srv-DR'] });
  assert.match(h, /Apps.*— not configured/s);
  assert.match(h, /DB.*— not configured/s);
  assert.match(h, /— NOT CONFIGURED/);
  assert.match(h, /No database probe/);
  assert.equal(stateCounts(d).HEALTHY, 4, 'only configured heartbeats are counted');
  const unknownApp = node('PRD', { applications: grp([app('PRD', { state: 'UNKNOWN', lastCheckAt: null, lastSuccessAt: null, detail: 'Check not reported yet' })]) });
  assert.equal(nodeState(unknownApp).state, 'UNKNOWN', 'unknown data is not healthy');
});

test('heartbeat 14: recovery recalculates the parent on the next data update (no reload)', () => {
  assert.match(html(ictDown()), /Overall node.*FAILING/s);
  const recovered = html(healthy());
  assert.match(recovered, /SYNCHRONIZED/);
  assert.equal(/Overall node.*FAILING/s.test(recovered), false);
  assert.equal(recovered.includes('Reason:'), false);
});

test('heartbeat 15 + 17: filters are presentation only (input untouched) and incident badges match the alert engine fingerprints', () => {
  const d = ictDown();
  const before = JSON.stringify(d);
  const incidents = [
    { id: 'INC-1018', title: 'ICT local health failing', status: 'OPEN', fingerprint: 'telemetry:srv-PRD:app-health:ict:4100' },
    { id: 'INC-0999', title: 'old', status: 'RESOLVED', fingerprint: 'telemetry:srv-PRD:systemd:nginx' },
  ] as unknown as Incident[];
  for (const f of [{}, { type: 'APPLICATION' }, { status: 'FAILING' }, { server: 'DR' }, { type: 'SERVICE', status: 'HEALTHY', server: 'PRD' }]) html(d, { initialFilters: f, incidents });
  assert.equal(JSON.stringify(d), before, 'rendering / filtering never modifies the heartbeat data');
  assert.equal(incidentFor(d.servers[0].applications.checks[0], d.servers[0], incidents, [])?.id, 'INC-1018');
  assert.equal(incidentFor(d.servers[0].services.checks[0], d.servers[0], incidents, []), undefined, 'resolved incidents are not shown');
  const dbIncident = [{ id: 'INC-2000', title: 'db', status: 'OPEN', fingerprint: 'db-down:app-1:PRD' }] as unknown as Incident[];
  assert.equal(incidentFor(d.servers[0].databases.checks[0], d.servers[0], dbIncident, [{ id: 'app-1', prdServerId: 'srv-PRD', drServerId: 'srv-DR' } as Application])?.id, 'INC-2000');
  const h = html(d, { incidents, initialFilters: { type: 'APPLICATION', status: 'FAILING' } });
  assert.match(h, /INC-1018/);
  assert.match(html(d, { incidents }), /1 incident</, 'collapsed card shows the incident count');
  assert.deepEqual(DEFAULT_FILTERS, { type: 'ALL', status: 'ALL', server: 'ALL' });
});

test('heartbeat: no servers / unknown data / light theme render cleanly', () => {
  assert.match(html(stream([])), /NO SERVERS REGISTERED/);
  const never = node('PRD', { agentVersion: null, server: serverCheck({ state: 'UNKNOWN', lastCheckAt: null, lastSuccessAt: null, latencyMs: null, failures: null, intervalSec: null, detail: 'Agent has never reported — install it from Setup' }),
    applications: grp([]), services: grp([]), databases: grp([]) });
  const h = html({ ...stream([never]), telemetryIntervalSec: null }, { isDark: false });
  assert.match(h, /Agent has never reported/);
  assert.match(h, /NEVER REPORTED/);
  assert.match(h, /agent reports every —/);
  assert.equal(/ 0 ms/.test(h), false);
});

test('an older backend payload (external-watchdog shape) or garbage never crashes the heartbeat UI', async () => {
  const { normalizeDeadMan } = await import('../src/context/OpsContext.tsx');
  const old = { id: 'deadman-outbound', name: 'External Dead-Man Heartbeat', nodeLocation: 'Not configured', targetControlPlane: '', lastHeartbeatReceivedAt: '',
    intervalSec: 60, toleranceSec: 180, status: 'NOT_CONFIGURED', consecutiveMisses: 0, configured: false, workerRunning: false };
  for (const raw of [old, { ...old, status: 'PENDING' }, null, undefined, 'x', { servers: 'nope' }, { servers: [{ hostname: 'half' }] }]) {
    const d = normalizeDeadMan(raw);
    assert.ok(Array.isArray(d.servers) && d.servers.length === 0);
    assert.ok(['NOT_CONFIGURED', 'UNKNOWN'].includes(d.status), d.status);
    assert.ok(html(d).includes('Dead-Man Watchdog Heartbeat Stream'));
  }
  // A current payload passes through unchanged (live SSE updates keep every server)
  assert.equal(normalizeDeadMan(ictDown()).servers.length, 2);
});

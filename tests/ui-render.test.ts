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

// ── Dead-man heartbeat panel (monitored infrastructure) ─────────────────────
import { DeadManPanel } from '../src/components/visuals/HeartbeatPulseChart.tsx';
import type { DeadManControlPlane, HeartbeatCheck, HeartbeatGroup, ServerHeartbeat } from '../src/types/index.ts';

const NOW = Date.parse('2026-10-08T10:00:00Z');
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const hc = (over: Partial<HeartbeatCheck> & Pick<HeartbeatCheck, 'kind' | 'key' | 'name'>): HeartbeatCheck => ({
  state: 'HEALTHY', detail: 'ok', target: null, lastCheckAt: ago(5), lastSuccessAt: ago(5), latencyMs: null, failures: 0, httpStatus: null, restartCount: null, intervalSec: 10, toleranceSec: 60, ...over,
});
const grp = (checks: HeartbeatCheck[]): HeartbeatGroup => ({ state: checks.some(c => c.state === 'FAILING') ? 'FAILING' : checks.some(c => c.state !== 'HEALTHY') ? 'DEGRADED' : 'HEALTHY', total: checks.length, healthy: checks.filter(c => c.state === 'HEALTHY').length, checks });
const srvHb = (env: 'PRD' | 'DR', over: Partial<ServerHeartbeat> = {}): ServerHeartbeat => ({
  serverId: env, hostname: `${env.toLowerCase()}-vps.example.com`, ip: env === 'PRD' ? '93.127.167.135' : '187.126.113.32', environment: env, state: 'HEALTHY',
  server: hc({ kind: 'SERVER', key: 'server', name: 'Server heartbeat', detail: 'Agent v3.3.0 CONNECTED', latencyMs: 15, target: '93.127.167.135' }),
  applications: grp([hc({ kind: 'APPLICATION', key: 'app:a:4100', name: 'ICT', target: '127.0.0.1:4100/health', latencyMs: 4, httpStatus: 200, detail: 'HTTP 200' })]),
  services: grp([hc({ kind: 'SERVICE', key: 'service:nginx', name: 'nginx', detail: 'running', target: 'systemd' })]),
  databases: grp([hc({ kind: 'DATABASE', key: 'db:mysql:ict', name: 'mysql ict', latencyMs: 3, detail: '8.0.36', target: 'mysql' })]),
  ...over,
});
const hb = (servers: ServerHeartbeat[], status: DeadManControlPlane['status']): DeadManControlPlane => ({
  id: 'deadman-infrastructure', name: 'Dead-Man Watchdog Heartbeat Stream', status, evaluatedAt: ago(0), telemetryIntervalSec: 10, staleAfterSec: 60, disconnectedAfterSec: 600,
  servers, counts: { total: servers.length * 4, healthy: servers.length * 4, degraded: 0, failing: 0, unknown: 0 },
});
// Text nodes are joined (React SSR separates them with <!-- -->); SVG namespace URLs are not data
const renderDm = (d: DeadManControlPlane, isDark = true) => renderToString(React.createElement(DeadManPanel, { deadMan: d, isDark, now: NOW })).replace(/<!-- -->/g, '').replace(/ xmlns="[^"]*"/g, '');

test('heartbeat stream: synchronized PRD + DR with server / application / service / database rows; UI rate separate from probe rates; no URL', () => {
  const html = renderDm(hb([srvHb('PRD'), srvHb('DR')], 'HEALTHY'));
  assert.match(html, /Dead-Man Watchdog Heartbeat Stream/);
  assert.match(html, /SYNCHRONIZED/);
  assert.match(html, /PRD VPS/);
  assert.match(html, /DR VPS/);
  for (const row of ['Server heartbeat', 'Application checks', 'Services', 'Database']) assert.match(html, new RegExp(row));
  assert.match(html, /Scholario Ops is the monitoring control plane/);
  assert.match(html, /UI stream: 1 Hz refresh \(animation only\)/);
  assert.match(html, /agent reports every 10s/);
  assert.match(html, /every 30s/, 'applications / services / databases cadence');
  assert.match(html, /last report 5s ago/);
  assert.match(html, /delivery 15 ms/);
  assert.match(html, /127\.0\.0\.1:4100\/health/);
  assert.equal(/https?:\/\//.test(html), false, 'no URL (no external watchdog)');
  assert.equal(/DEADMAN_HEARTBEAT_URL/.test(html), false);
});

test('heartbeat stream: degraded / failing / unknown / no servers / missing data', () => {
  const failingApp = hc({ kind: 'APPLICATION', key: 'app:a:4100', name: 'ICT', state: 'FAILING', failures: 3, lastSuccessAt: ago(300), latencyMs: null, httpStatus: null, detail: 'Health check failing: port not listening', target: '127.0.0.1:4100/health' });
  const failing = renderDm(hb([srvHb('PRD', { state: 'FAILING', applications: grp([failingApp]) }), srvHb('DR')], 'FAILING'), false);
  assert.match(failing, /HEARTBEAT FAILING/);
  assert.match(failing, /0\/1 healthy/);
  assert.match(failing, /3 fail/);
  assert.match(failing, /last OK 5m 0s ago/);
  const staleServer = srvHb('DR', { state: 'DEGRADED', server: hc({ kind: 'SERVER', key: 'server', name: 'Server heartbeat', state: 'DEGRADED', lastCheckAt: ago(90), lastSuccessAt: ago(90), detail: 'Agent v3.3.0 STALE · 8 report(s) missed', failures: 8 }) });
  const degraded = renderDm(hb([srvHb('PRD'), staleServer], 'DEGRADED'));
  assert.match(degraded, /DEGRADED/);
  assert.match(degraded, /8 missed/);
  const never = srvHb('PRD', { state: 'UNKNOWN', server: hc({ kind: 'SERVER', key: 'server', name: 'Server heartbeat', state: 'UNKNOWN', lastCheckAt: null, lastSuccessAt: null, latencyMs: null, failures: null, intervalSec: null, detail: 'Agent has never reported — install it from Setup' }),
    applications: grp([]), services: grp([]), databases: grp([]) });
  const unknown = renderDm({ ...hb([never], 'UNKNOWN'), telemetryIntervalSec: null });
  assert.match(unknown, /AWAITING TELEMETRY/);
  assert.match(unknown, /Agent has never reported/);
  assert.match(unknown, /No watched services/);
  assert.match(unknown, /No database probe/);
  assert.match(unknown, /agent reports every —/, 'unknown interval is a dash, not 0');
  assert.equal(/ 0 ms/.test(unknown), false);
  const none = renderDm(hb([], 'NOT_CONFIGURED'));
  assert.match(none, /NO SERVERS REGISTERED/);
  assert.match(none, /add the PRD and DR VPS in Setup/);
});

test('an older backend payload (external-watchdog shape) or garbage never crashes the heartbeat UI', async () => {
  const { normalizeDeadMan } = await import('../src/context/OpsContext.tsx');
  const old = { id: 'deadman-outbound', name: 'External Dead-Man Heartbeat', nodeLocation: 'Not configured', targetControlPlane: '', lastHeartbeatReceivedAt: '',
    intervalSec: 60, toleranceSec: 180, status: 'NOT_CONFIGURED', consecutiveMisses: 0, configured: false, workerRunning: false };
  for (const raw of [old, { ...old, status: 'PENDING' }, null, undefined, 'x', { servers: 'nope' }, { servers: [{ hostname: 'half' }] }]) {
    const d = normalizeDeadMan(raw);
    assert.ok(Array.isArray(d.servers) && d.servers.length === 0);
    assert.ok(['NOT_CONFIGURED', 'UNKNOWN'].includes(d.status), d.status);
    assert.ok(renderDm(d).includes('Dead-Man Watchdog Heartbeat Stream'));
  }
});

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

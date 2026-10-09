/**
 * Reliability insights: capacity forecast math, flapping detection (engine + alert), SLO error
 * budget / burn-rate alerts, and the /v1/insights payload. In-process, throw-away PostgreSQL schema.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
process.env.DB_SCHEMA = `ops_insights_${process.pid}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-insights-'));
process.env.HOSTINGER_API_TOKEN = '';
process.env.CLOUDFLARE_API_TOKEN = '';

const { forecastToThreshold, detectFlapping, errorBudget, formatEta, SLO_TARGETS } = await import('../src/lib/insights.ts');
const { initStore, db, minuteMetrics } = await import('../server/store.ts');
const { query, closePool, SCHEMA } = await import('../server/db.ts');
const { applyOutcome } = await import('../server/engine.ts');
const { evaluateInsightAlerts } = await import('../server/alerts.ts');
const { reliabilityInsights } = await import('../server/insights.ts');
type Monitor = import('../src/types/index.ts').Monitor;
type Application = import('../src/types/index.ts').Application;
type ServerRecord = import('../server/store.ts').ServerRecord;

const HOUR = 3_600_000;
const openFor = (fp: string) => db.incidents.find(i => i.fingerprint === fp && i.status !== 'RESOLVED' && i.status !== 'CLOSED');
const resolvedFor = (fp: string) => db.incidents.find(i => i.fingerprint === fp && i.status === 'RESOLVED');

function mkMonitor(appId: string, env: 'PRD' | 'DR'): Monitor {
  return {
    id: crypto.randomUUID(), name: `${env} health`, type: 'HTTPS', target: 'https://app.example.com/health', applicationId: appId, environment: env, intervalSec: 30, timeoutSec: 5, retries: 1,
    warningThresholdMs: 2000, criticalThresholdMs: 10000, failureConfirmationThreshold: 3, recoveryConfirmationThreshold: 2, consecutiveFailures: 0, consecutiveRecoveries: 0,
    status: 'UNKNOWN', lastCheck: '', lastSuccess: '', responseTimeMs: 0, uptimePercent: 0, history: [], enabled: true, activeMaintenance: false,
  } as Monitor;
}
function mkServer(env: 'PRD' | 'DR', ip: string): ServerRecord {
  return {
    id: crypto.randomUUID(), hostname: `ins-${env.toLowerCase()}-${ip.split('.').pop()}`, ip, applicationId: '', environment: env, provider: '', region: '', plan: '',
    cpuCores: 0, ramGb: 0, diskGb: 0, os: '', status: 'UNKNOWN', agentVersion: '', agentStatus: 'CONNECTED', uptimeDays: 0, lastSeen: new Date().toISOString(),
    telemetry: { cpuPercent: 0, ramPercent: 0, diskPercent: 0, loadAvg: [0, 0, 0], networkInKbps: 0, networkOutKbps: 0, observedAt: '', receivedAt: '' },
    processes: [], services: [], logs: [], agentToken: crypto.randomBytes(24).toString('hex'), createdAt: new Date().toISOString(),
  };
}
function mkApp(tier: Application['tier'] = 'TIER_1'): Application {
  return {
    id: crypto.randomUUID(), name: `SLO-${crypto.randomBytes(2).toString('hex')}`, codeName: 'slo', description: '', tier, rtoTargetMin: 30, rpoTargetMin: 15,
    prdServerId: '', drServerId: '', prdUrl: '', drUrl: '', autoFailover: false, failoverState: 'PRIMARY_ACTIVE',
    status: 'UNKNOWN', uptime24h: null, uptime7d: null, uptime30d: null, dependencies: [], currentReplicationLagSec: null,
  } as unknown as Application;
}
/** Per-minute rollups over `hours`, value = f(hours ago) */
function series(hours: number, f: (hAgo: number) => number) {
  const now = Date.now();
  return Array.from({ length: hours * 60 }, (_, i) => {
    const t = now - (hours * 60 - i) * 60_000;
    const v = f((now - t) / HOUR);
    return { t: new Date(t).toISOString(), cpu: 10, ram: v, disk: v, load1: 0.1, netIn: 0, netOut: 0 };
  });
}
const pass = () => ({ ok: true, degraded: false, latencyMs: 30, statusCode: 200, detail: 'HTTP 200', probeStatus: 'UP' as const });
const fail = () => ({ ok: false, degraded: false, latencyMs: 30, statusCode: 503, detail: 'HTTP 503', probeStatus: 'DOWN' as const });

before(async () => { await initStore(); });
after(async () => {
  await query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  await closePool();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100).unref();
});

test('forecast: a steady rise gives the right ETA; flat, noisy or short histories give none', () => {
  const now = Date.now();
  // 60 % → 70 % over 25 h (≈ 9.6 %/day) → 95 % in ~62.5 h
  const rising = Array.from({ length: 25 * 60 }, (_, i) => ({ t: now - (25 * 60 - i) * 60_000, v: 60 + (10 * i) / (25 * 60) }));
  const f = forecastToThreshold(rising, 95)!;
  assert.ok(f, 'forecast for 24 h of data');
  assert.ok(Math.abs(f.slopePerDay - 9.6) < 0.2, `slope ${f.slopePerDay}`);
  assert.ok(f.etaHours! > 60 && f.etaHours! < 65, `eta ${f.etaHours}`);
  assert.equal(f.confidence, 'HIGH');

  const flat = rising.map(p => ({ ...p, v: 50 }));
  assert.equal(forecastToThreshold(flat, 95)!.etaHours, null, 'flat: no ETA');

  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const noisy = rising.map(p => ({ ...p, v: 50 + rnd() * 20 }));
  assert.equal(forecastToThreshold(noisy, 95)!.etaHours, null, 'noise is not a trend');

  assert.equal(forecastToThreshold(rising.slice(-60), 95), null, 'one hour of data is not enough');
  assert.equal(forecastToThreshold(rising.slice(0, 10), 95), null, 'too few samples');
  assert.equal(forecastToThreshold([...rising.slice(0, -1), { t: now, v: 96 }], 95)!.etaHours, 0, 'already over → now');
  assert.equal(formatEta(60), '2.5 d'); assert.equal(formatEta(5), '5 h'); assert.equal(formatEta(null), '—');
});

test('flapping: needs 5 changes to start, clears only at ≤ 1 (hysteresis)', () => {
  const alt = Array.from({ length: 20 }, (_, i) => i % 2 === 0);
  assert.deepEqual(detectFlapping(alt, false).flapping, true);
  assert.equal(detectFlapping([true, false, true, false, true, true, true], false).flapping, false, '4 changes: not yet');
  const settling = [true, true, true, true, true, true, false, true, true];
  assert.equal(detectFlapping(settling, true).flapping, true, '2 changes while flapping: still flapping');
  assert.equal(detectFlapping(Array(20).fill(true), true).flapping, false, 'stable: cleared');
});

test('engine + alerts: alternating pass/fail is flagged FLAPPING (WARNING), raises one alert, resolves when stable', () => {
  const app = mkApp(); db.applications.push(app);
  const m = mkMonitor(app.id, 'PRD'); db.monitors.push(m);
  for (let i = 0; i < 10; i++) applyOutcome(m, i % 2 ? fail() : pass());
  assert.equal(m.flapping, true);
  assert.ok((m.flapTransitions ?? 0) >= 5);
  assert.notEqual(m.status, 'HEALTHY', 'a flapping monitor is never shown green');
  assert.equal(db.incidents.find(i => i.fingerprint === `monitor:${m.id}`), undefined, 'never confirmed down: no outage incident');

  evaluateInsightAlerts(); evaluateInsightAlerts();
  const fp = `flapping:${m.id}`;
  assert.ok(openFor(fp), 'flapping alert opened');
  assert.equal(db.incidents.filter(i => i.fingerprint === fp).length, 1, 'deduplicated');
  assert.ok(reliabilityInsights().flapping.some(f => f.monitorId === m.id));

  for (let i = 0; i < 20; i++) applyOutcome(m, pass());
  assert.equal(m.flapping, false);
  assert.equal(m.status, 'HEALTHY');
  evaluateInsightAlerts();
  assert.equal(openFor(fp), undefined);
  assert.ok(resolvedFor(fp), 'resolved with a recovery note');
});

test('capacity forecast alert: disk filling within 72 h opens (HIGH on PRD ≤ 24 h), not enough history does nothing, stable resolves', () => {
  const srv = mkServer('PRD', '203.0.113.71'); db.servers.push(srv);
  const fp = `capacity-disk:${srv.id}`;

  minuteMetrics[srv.id] = series(2, () => 80);
  evaluateInsightAlerts();
  assert.equal(openFor(fp), undefined, '2 h of data: no forecast, no alert');

  // 70 % → 90 % over the last 24 h = 20 %/day → 95 % in ~6 h
  minuteMetrics[srv.id] = series(24, hAgo => 90 - (20 * hAgo) / 24);
  evaluateInsightAlerts();
  const inc = openFor(fp)!;
  assert.ok(inc, 'disk-full forecast alert');
  assert.equal(inc.severity, 'HIGH');
  assert.match(inc.title, /disk predicted to reach 95%/);
  const ins = reliabilityInsights().servers.find(s => s.serverId === srv.id)!;
  assert.ok(ins.disk && ins.disk.etaHours! < 10, `eta ${ins.disk?.etaHours}`);

  // Agent offline: no evaluation either way (the alert stays as it was)
  srv.agentStatus = 'DISCONNECTED';
  minuteMetrics[srv.id] = series(24, () => 60);
  evaluateInsightAlerts();
  assert.ok(openFor(fp), 'no change without a live agent');

  srv.agentStatus = 'CONNECTED';
  evaluateInsightAlerts();
  assert.equal(openFor(fp), undefined, 'flat disk: resolved');
});

test('SLO error budget: no data → NO_DATA; heavy current failures → FAST_BURN alert (HIGH); recovery resolves it', () => {
  const nowH = Math.floor(Date.now() / HOUR);
  assert.equal(errorBudget([], 99.9, nowH).status, 'NO_DATA');
  const healthy = Array.from({ length: 24 * 30 }, (_, i) => ({ h: nowH - i, total: 120, ok: 120 }));
  const b0 = errorBudget(healthy, SLO_TARGETS.TIER_1, nowH);
  assert.equal(b0.status, 'HEALTHY'); assert.equal(b0.remainingPercent, 100); assert.equal(b0.alert, 'NONE');

  const app = mkApp('TIER_1'); db.applications.push(app);
  const m = mkMonitor(app.id, 'PRD'); m.status = 'HEALTHY'; db.monitors.push(m);
  // Last 6 h: half of all checks failing → burn 500× (allowed error rate 0.1 %)
  db.monitorBuckets[m.id] = healthy.map(b => (b.h > nowH - 6 ? { ...b, ok: 60, latSum: 0 } : { ...b, latSum: 0 }));
  const slo = reliabilityInsights().applications.find(a => a.applicationId === app.id)!;
  assert.equal(slo.budget.alert, 'FAST_BURN');
  assert.equal(slo.budget.targetPercent, 99.9);
  assert.ok(slo.budget.burnRate1h! >= 14.4);

  evaluateInsightAlerts();
  const fp = `slo-burn:${app.id}`;
  assert.equal(openFor(fp)?.severity, 'HIGH');

  // A DR-only failure never counts against the PRD SLO
  const drOnly = mkApp('TIER_2'); db.applications.push(drOnly);
  const drm = mkMonitor(drOnly.id, 'DR'); db.monitors.push(drm);
  db.monitorBuckets[drm.id] = [{ h: nowH, total: 100, ok: 0, latSum: 0 }];
  evaluateInsightAlerts();
  assert.equal(openFor(`slo-burn:${drOnly.id}`), undefined);
  assert.equal(reliabilityInsights().applications.find(a => a.applicationId === drOnly.id)!.budget.status, 'NO_DATA');

  db.monitorBuckets[m.id] = healthy.map(b => ({ ...b, latSum: 0 }));
  evaluateInsightAlerts();
  assert.equal(openFor(fp), undefined);
  assert.ok(resolvedFor(fp));
});

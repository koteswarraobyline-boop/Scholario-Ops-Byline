/**
 * Dead-man heartbeat (server/deadman.ts + its wiring in the engine): states, failure counting,
 * recovery, latency, URL secrecy in state / errors / logs, single worker start / clean stop,
 * engine idempotency and the deduplicated incident. Watchdogs are local HTTP servers.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

// Local watchdog: answers with `watchdogStatus`, counts hits
let watchdogStatus = 200;
let hits = 0;
const watchdog = http.createServer((_req, res) => { hits++; res.statusCode = watchdogStatus; res.end('OK'); });
await new Promise<void>(r => watchdog.listen(0, '127.0.0.1', () => r()));
const WD = `http://127.0.0.1:${(watchdog.address() as net.AddressInfo).port}`;
const SECRET_PATH = 'ping/5f1e2d3c-4b5a-6978-8a9b-secretuuid0001';
const SECRET_QS = 'tok3n-super-secret-value';
const SECRET_URL = `${WD}/${SECRET_PATH}?token=${SECRET_QS}`;

// Capture everything the logger writes
let logged = '';
for (const stream of [process.stdout, process.stderr]) {
  const orig = stream.write.bind(stream);
  stream.write = ((chunk: unknown, ...rest: unknown[]) => { logged += String(chunk); return (orig as (...a: unknown[]) => boolean)(chunk, ...rest); }) as typeof stream.write;
}

process.env.DB_SCHEMA = `ops_dmtest_${process.pid}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-dmtest-'));
process.env.HOSTINGER_API_TOKEN = '';
process.env.CLOUDFLARE_API_TOKEN = '';
process.env.DEADMAN_HEARTBEAT_URL = SECRET_URL;
process.env.DEADMAN_INTERVAL_SEC = '3600'; // the engine's own loop pings once at start; tests drive the rest

const { DeadManHeartbeat, parseHeartbeatUrl, redactUrl } = await import('../server/deadman.ts');
const { initStore, db } = await import('../server/store.ts');
const { query, closePool, SCHEMA } = await import('../server/db.ts');
const { startEngine, stopEngine, deadMan, deadManWorkerRunning } = await import('../server/engine.ts');
const { evaluateAlerts } = await import('../server/alerts.ts');

const closedPort = async () => {
  const s = net.createServer();
  await new Promise<void>(r => s.listen(0, '127.0.0.1', () => r()));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise(r => s.close(r));
  return p;
};
const noSecret = (text: string, what: string) => {
  for (const s of [SECRET_PATH, SECRET_QS, 'secretuuid0001', SECRET_URL]) assert.equal(text.includes(s), false, `${what} contains the heartbeat secret`);
};

before(async () => { await initStore(); });
after(async () => {
  stopEngine();
  watchdog.close();
  await query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  await closePool();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100).unref();
});

test('missing DEADMAN_HEARTBEAT_URL → NOT_CONFIGURED, no worker, no request', async () => {
  const d = new DeadManHeartbeat({ url: '', intervalSec: 60, toleranceSec: 180 });
  assert.equal(d.state.status, 'NOT_CONFIGURED');
  assert.equal(d.state.configured, false);
  assert.equal(d.state.configError, null);
  assert.equal(d.start(), false);
  assert.equal(d.running, false);
  await d.beat();
  assert.equal(d.state.lastAttemptAt, null, 'nothing attempted');
});

test('invalid URL / non-http scheme → NOT_CONFIGURED with a configuration error (startup never crashes)', () => {
  for (const bad of ['not a url', 'ftp://example.com/x', 'file:///etc/passwd', 'javascript:alert(1)']) {
    const d = new DeadManHeartbeat({ url: bad, intervalSec: 60, toleranceSec: 180 });
    assert.equal(d.state.status, 'NOT_CONFIGURED', bad);
    assert.ok(d.state.configError, bad);
    noSecret(JSON.stringify(d.state), 'state');
  }
  assert.equal(parseHeartbeatUrl(' https://hc-ping.com/abc ').url?.hostname, 'hc-ping.com');
});

test('successful heartbeat → HEALTHY; latency, HTTP status and last success recorded; PENDING before the first ping', async () => {
  watchdogStatus = 200;
  const d = new DeadManHeartbeat({ url: SECRET_URL, intervalSec: 60, toleranceSec: 180 });
  assert.equal(d.state.status, 'PENDING', 'configured but not pinged yet is not healthy');
  const before = hits;
  await d.beat();
  assert.equal(hits, before + 1);
  assert.equal(d.state.status, 'HEALTHY');
  assert.equal(d.state.lastHttpStatus, 200);
  assert.equal(typeof d.state.lastLatencyMs, 'number');
  assert.ok(d.state.lastLatencyMs! >= 0 && d.state.lastLatencyMs! < 5000);
  assert.ok(d.state.lastSuccessAt && d.state.lastSuccessAt === d.state.lastHeartbeatReceivedAt);
  assert.equal(d.state.consecutiveFailures, 0);
  assert.equal(d.state.nodeLocation, '127.0.0.1', 'only the host name is exposed');
  noSecret(JSON.stringify(d.state), 'state');
});

test('failures increment; DEGRADED within the tolerance, FAILING beyond it; recovery → HEALTHY with a new last-success time', async () => {
  let clock = Date.parse('2026-10-08T10:00:00Z');
  const now = () => clock;
  watchdogStatus = 200;
  const d = new DeadManHeartbeat({ url: SECRET_URL, intervalSec: 60, toleranceSec: 180, now });
  await d.beat();
  const firstSuccess = d.state.lastSuccessAt;
  assert.equal(d.state.status, 'HEALTHY');

  watchdogStatus = 503;
  clock += 60_000; await d.beat();
  assert.equal(d.state.consecutiveFailures, 1);
  assert.equal(d.state.lastHttpStatus, 503, 'HTTP error keeps its status');
  assert.equal(d.state.status, 'DEGRADED');
  assert.equal(d.state.lastSuccessAt, firstSuccess, 'last success unchanged by failures');
  clock += 60_000; await d.beat();
  assert.equal(d.state.consecutiveFailures, 2);
  assert.equal(d.state.status, 'DEGRADED');
  clock += 61_000; await d.beat();
  assert.equal(d.state.consecutiveFailures, 3);
  assert.equal(d.state.status, 'FAILING', '> 180 s without success');
  assert.equal(d.state.consecutiveMisses, 3, 'compat alias');

  watchdogStatus = 200;
  clock += 60_000; await d.beat();
  assert.equal(d.state.status, 'HEALTHY');
  assert.equal(d.state.consecutiveFailures, 0);
  assert.equal(d.state.lastError, null);
  assert.ok(Date.parse(d.state.lastSuccessAt!) > Date.parse(firstSuccess!));
});

test('no response at all (connection refused) → failure with no HTTP status / latency; FAILING when never successful past the tolerance', async () => {
  const port = await closedPort();
  let clock = Date.now();
  const d = new DeadManHeartbeat({ url: `http://127.0.0.1:${port}/${SECRET_PATH}?token=${SECRET_QS}`, intervalSec: 60, toleranceSec: 120, now: () => clock });
  await d.beat();
  assert.equal(d.state.consecutiveFailures, 1);
  assert.equal(d.state.lastHttpStatus, null);
  assert.equal(d.state.lastLatencyMs, null, 'no measurement is null, never 0');
  assert.equal(d.state.status, 'DEGRADED');
  assert.ok(d.state.lastError);
  noSecret(d.state.lastError!, 'error');
  clock += 121_000;
  assert.equal(d.evaluate(), 'FAILING', 'state ages without new attempts');
});

test('the URL never appears in state, errors or logs (path token, query token, credentials)', async () => {
  const u = new URL(`https://user:pa55word@hc.example/${SECRET_PATH}?token=${SECRET_QS}`);
  const msg = redactUrl(`request to ${u.href} failed for ${u.pathname} (${SECRET_QS}) user pa55word`, u);
  noSecret(msg, 'redacted message');
  assert.equal(msg.includes('pa55word'), false);
  const d = new DeadManHeartbeat({ url: u.href, intervalSec: 60, toleranceSec: 180, fetchImpl: (async () => { throw new TypeError(`fetch failed: ${u.href}`); }) as typeof fetch });
  await d.beat();
  noSecret(JSON.stringify(d.state), 'state after a failure whose error contained the URL');
  assert.equal(JSON.stringify(d.state).includes('pa55word'), false);
  noSecret(logged, 'logs');
  assert.equal(logged.includes('pa55word'), false);
});

test('worker starts exactly once and stops cleanly (also aborts a ping in flight)', async () => {
  let calls = 0;
  let release: (() => void) | null = null;
  const slow = (async (_u: string, init?: RequestInit) => {
    calls++;
    await new Promise<void>((resolve, reject) => { release = resolve; init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
    return new Response('ok');
  }) as unknown as typeof fetch;
  const d = new DeadManHeartbeat({ url: SECRET_URL, intervalSec: 3600, toleranceSec: 7200, fetchImpl: slow });
  assert.equal(d.start(), true);
  assert.equal(d.start(), false, 'second start is ignored');
  assert.equal(d.running, true);
  assert.equal(d.state.workerRunning, true);
  await d.beat(); // a ping is already in flight → no second concurrent request
  assert.equal(calls, 1);
  d.stop();
  d.stop();
  assert.equal(d.running, false);
  assert.equal(d.state.workerRunning, false);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(d.state.consecutiveFailures, 1, 'the aborted ping counts as a failure');
  assert.equal(d.state.lastError, 'timed out');
  void release;
});

test('engine: monitoring workers and the dead-man loop start once; stop is clean; API state has no URL', async () => {
  const before = hits;
  assert.equal(startEngine(), true);
  assert.equal(startEngine(), false, 'second start ignored — no duplicate monitoring / heartbeat workers');
  assert.equal(deadManWorkerRunning(), true);
  for (let i = 0; i < 50 && deadMan.status === 'PENDING'; i++) await new Promise(r => setTimeout(r, 50));
  assert.equal(hits, before + 1, 'exactly one ping at start');
  assert.equal(deadMan.status, 'HEALTHY');
  assert.equal(deadMan.workerRunning, true);
  noSecret(JSON.stringify(deadMan), 'engine dead-man state (sent to the browser)');
  stopEngine();
  assert.equal(deadManWorkerRunning(), false);
  assert.equal(deadMan.workerRunning, false);
  assert.equal(startEngine(), true, 'can start again after a clean stop');
  for (let i = 0; i < 50 && hits < before + 2; i++) await new Promise(r => setTimeout(r, 50));
  stopEngine();
});

test('FAILING opens one deduplicated incident; HEALTHY resolves it', () => {
  const saved = deadMan.status;
  deadMan.status = 'FAILING';
  evaluateAlerts();
  evaluateAlerts();
  const open = db.incidents.filter(i => i.fingerprint === 'deadman-heartbeat' && i.status === 'OPEN');
  assert.equal(open.length, 1);
  noSecret(JSON.stringify(open[0]), 'incident');
  deadMan.status = 'HEALTHY';
  evaluateAlerts();
  assert.equal(db.incidents.find(i => i.fingerprint === 'deadman-heartbeat')!.status, 'RESOLVED');
  deadMan.status = saved;
  noSecret(logged, 'logs (whole test run)');
});

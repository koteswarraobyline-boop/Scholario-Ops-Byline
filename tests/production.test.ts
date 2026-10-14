/**
 * Production-behaviour tests (NODE_ENV=production, real PostgreSQL, throw-away schema):
 * health endpoints, startup without a database, auth / RBAC / lockout, realtime tickets,
 * agent telemetry ingestion, the incident engine, headers, and secrets never reaching logs.
 *   npm run test:local -- tests/production.test.ts
 */
import { test, before, after } from 'node:test';
import { execSync } from 'node:child_process';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import { AGENT_VERSION } from '../server/agent.ts';
import { pinTestDatabaseUrl, assertConnectedToTestDatabase, dropVerifiedTestSchema } from './helpers/test-db-guard.ts';

const DATABASE_URL = pinTestDatabaseUrl();
dotenv.config({ quiet: true });
const SCHEMA = `ops_prodtest_${process.pid}`;
const PORT = 3990 + (process.pid % 9);
const BASE = `http://127.0.0.1:${PORT}`;
/**
 * Ports the WHATWG Fetch standard refuses to connect to — Node's fetch fails at once with "bad port"
 * (https://fetch.spec.whatwg.org/#port-blocking). The startup test used to listen on PORT + 50, which
 * is 4045 (on this list) whenever process.pid % 9 === 5: about one run in nine failed after 30 s.
 */
const FETCH_BLOCKED_PORTS = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104,
  109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548,
  554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667,
  6668, 6669, 6679, 6697, 10080]);
/** A free port chosen by the OS, never one fetch refuses */
async function freePort(): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((resolve, reject) => {
      const probe = net.createServer();
      probe.on('error', reject);
      probe.listen(0, '127.0.0.1', () => { const p = (probe.address() as net.AddressInfo).port; probe.close(() => resolve(p)); });
    });
    if (!FETCH_BLOCKED_PORTS.has(port)) return port;
  }
}
const ADMIN = { email: 'prod-admin@example.com', password: 'ProdTestPassw0rd!' };
const SECRETS = { cf: 'prodtest-fake-cloudflare-token-9d2e', jwt: 'x'.repeat(16) + 'prodtest-jwt-secret-value-0123456789' };
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-prodtest-'));
const pgc = new pg.Client({ connectionString: DATABASE_URL });
let server: ChildProcess | null = null;
let logs = '';
let token = '';

function spawnServer(extraEnv: Record<string, string> = {}, port = PORT) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: {
      ...process.env, DATABASE_URL, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR,
      ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, CLOUDFLARE_API_TOKEN: SECRETS.cf, JWT_SECRET: SECRETS.jwt,
      PUBLIC_URL: 'https://ops.test.invalid', HOSTINGER_API_TOKEN: '', DEADMAN_HEARTBEAT_URL: '', LOG_FORMAT: 'json',
      SMTP_SERVICE: '', SMTP_URL: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '', ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', d => { logs += d; });
  child.stderr?.on('data', d => { logs += d; });
  return child;
}

async function waitReady(base = BASE, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(`${base}/api/health/ready`)).status === 200) return; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`not ready:\n${logs.slice(-2000)}`);
}

async function api<T = any>(method: string, p: string, body?: unknown, auth = token): Promise<{ status: number; body: T; raw: string; headers: Headers }> {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await res.text();
  let parsed: any = null; try { parsed = JSON.parse(raw); } catch { /* not json */ }
  return { status: res.status, body: parsed, raw, headers: res.headers };
}

const one = async (sql: string, params: unknown[] = []) => (await pgc.query(sql, params)).rows[0];
const waitFor = async <T>(fn: () => Promise<T | undefined | null | false>, ms = 20_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 400)); }
};

let verified = false;
before(async () => {
  await pgc.connect();
  await assertConnectedToTestDatabase(pgc);
  verified = true;
  server = spawnServer();
  await waitReady();
  const r = await api('POST', '/api/auth/login', ADMIN, '');
  assert.equal(r.status, 200, r.raw);
  token = r.body.data.tokens.accessToken;
});

after(async () => {
  server?.kill();
  await new Promise(r => setTimeout(r, 500));
  await dropVerifiedTestSchema(verified, () => pgc.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {}));
  await pgc.end().catch(() => {});
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('health: liveness and readiness', async () => {
  const live = await fetch(`${BASE}/api/health/live`);
  assert.equal(live.status, 200);
  const ready = await (await fetch(`${BASE}/api/health/ready`)).json();
  assert.equal(ready.status, 'ready');
  assert.match(ready.checks.database, /^ok/);
  assert.equal(ready.checks.scheduler, 'ok', 'the monitor scheduler is reported as running');
});

test('startup with the database unavailable: process stays up, readiness 503, API 503 (no crash loop)', async () => {
  const port = await freePort();
  const t0 = Date.now();
  const child = spawnServer({ DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/none' }, port);
  // Evidence for a failure: this child's own output, how it ended, the last connection error, timings
  let childOut = '';
  let exited: { code: number | null; signal: string | null; afterMs: number } | null = null;
  child.stdout?.on('data', d => { childOut += d; });
  child.stderr?.on('data', d => { childOut += d; });
  child.on('exit', (code, signal) => { exited = { code, signal, afterMs: Date.now() - t0 }; });
  try {
    let live = 0;
    let lastError = '';
    const attempts: string[] = [];
    // Up to 30 s: a freshly spawned tsx process occasionally needs > 10 s to start on a busy machine (flaky before at 10 s)
    for (let i = 0; i < 120 && live !== 200; i++) {
      const ta = Date.now();
      try { live = (await fetch(`http://127.0.0.1:${port}/api/health/live`)).status; } catch (e) {
        const c = (e as { cause?: { code?: string; name?: string; message?: string } }).cause;
        lastError = `${c?.code ?? c?.name ?? 'no cause'}: ${c?.message ?? (e as Error).message} (attempt took ${Date.now() - ta} ms)`;
        attempts.push(`${Date.now() - t0}ms ${c?.code ?? c?.name ?? '?'}`);
      }
      if (live !== 200) await new Promise(r => setTimeout(r, 250));
    }
    // Raw TCP connect + who holds the port, for the failure report
    const tcp = await new Promise<string>(resolve => {
      const sock = net.connect({ host: '127.0.0.1', port });
      const timer = setTimeout(() => { sock.destroy(); resolve('no answer within 3 s'); }, 3000);
      sock.on('connect', () => { clearTimeout(timer); sock.destroy(); resolve('connected'); });
      sock.on('error', (err: NodeJS.ErrnoException) => { clearTimeout(timer); resolve(`error ${err.code}`); });
    });
    let portState = '';
    try { portState = execSync('netstat -ano -p tcp', { encoding: 'utf8', timeout: 5000 }).split(/\r?\n/).filter(l => l.includes(`:${port} `)).slice(0, 12).join(' | '); } catch (err) { portState = (err as Error).message; }
    const evidence = () => `waited ${Date.now() - t0} ms on port ${port}; child pid ${child.pid}; child exit: ${JSON.stringify(exited)}; last error: ${lastError}; ${attempts.length} failed attempts (last: ${attempts.slice(-5).join(', ')}); raw TCP connect: ${tcp}; netstat for the port:
${portState}
child output (tail):
${childOut.slice(-1500)}`;
    assert.equal(live, 200, `liveness must answer while the database is down — ${evidence()}`);
    console.log(`# startup-without-db: liveness after ${Date.now() - t0} ms on port ${port}`);
    const ready = await fetch(`http://127.0.0.1:${port}/api/health/ready`);
    assert.equal(ready.status, 503);
    const apiRes = await fetch(`http://127.0.0.1:${port}/api/v1/bootstrap`);
    assert.equal(apiRes.status, 503);
    await new Promise(r => setTimeout(r, 3000));
    assert.equal(child.exitCode, null, 'process must keep running and retry');
  } finally {
    child.kill();
  }
});

test('test servers never listen on a port fetch refuses ("bad port") — root cause of the old flaky startup test', async () => {
  // The cause, demonstrated: fetch rejects a blocked port before any connection is made
  await assert.rejects(fetch('http://127.0.0.1:4045/'), (e: Error & { cause?: Error }) => /bad port/i.test(String(e.cause?.message ?? e.message)));
  // Every fixed test-server port range in this suite is clear of the list…
  const ranges: Array<[string, number, number]> = [['production.test PORT', 3990, 3998], ['config-flow.test PORT', 3900, 3989], ['responsive.test PORT', 4300, 4349]];
  for (const [name, lo, hi] of ranges) {
    for (let p = lo; p <= hi; p++) assert.equal(FETCH_BLOCKED_PORTS.has(p), false, `${name} can be ${p}, which fetch refuses`);
  }
  // …and the OS-chosen ports never are
  for (let n = 0; n < 25; n++) assert.equal(FETCH_BLOCKED_PORTS.has(await freePort()), false);
});

test('security fixes over HTTP: no super-admin takeover, viewers never get push tokens on the live stream, odd tokens are 401 not 500, manual failover needs the pre-flight', async () => {
  // it_administrator cannot change a super admin (password / status / name), nor grant the role
  const ita = await api('POST', '/api/v1/users', { email: 'itadmin@example.com', password: 'ItAdminPassw0rd!', fullName: 'IT Admin', roleName: 'it_administrator' });
  assert.equal(ita.status, 201, ita.raw);
  const itTok = (await api('POST', '/api/auth/login', { email: 'itadmin@example.com', password: 'ItAdminPassw0rd!' }, '')).body.data.tokens.accessToken;
  const users = (await api('GET', '/api/v1/users?pageSize=100')).body.data as Array<{ id: string; email: string; roleName: string }>;
  const superAdmin = users.find(u => u.email === ADMIN.email)!;
  assert.equal((await api('PATCH', `/api/v1/users/${superAdmin.id}`, { password: 'Attacker12345!' }, itTok)).status, 403);
  assert.equal((await api('PATCH', `/api/v1/users/${superAdmin.id}`, { isActive: false }, itTok)).status, 403);
  assert.equal((await api('PATCH', `/api/v1/users/${superAdmin.id}`, { fullName: 'Pwned' }, itTok)).status, 403);
  assert.equal((await api('PATCH', `/api/v1/users/${ita.body.data.id}`, { roleName: 'super_admin' }, itTok)).status, 403);
  assert.equal((await api('POST', '/api/auth/login', ADMIN, '')).status, 200, 'the super admin password is unchanged');

  // A viewer's live stream: monitor updates arrive without the push-heartbeat token
  const v = await api('POST', '/api/v1/users', { email: 'streamviewer@example.com', password: 'ViewerPassw0rd!', fullName: 'Stream Viewer', roleName: 'viewer' });
  assert.equal(v.status, 201, v.raw);
  const vTok = (await api('POST', '/api/auth/login', { email: 'streamviewer@example.com', password: 'ViewerPassw0rd!' }, '')).body.data.tokens.accessToken;
  const ticket = (await api('POST', '/api/v1/realtime/ticket', {}, vTok)).body.data.ticket as string;
  const ac = new AbortController();
  const stream = await fetch(`${BASE}/api/v1/realtime/stream?ticket=${encodeURIComponent(ticket)}`, { signal: ac.signal });
  assert.equal(stream.status, 200);
  let received = '';
  const reader = stream.body!.getReader();
  const pump = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; received += new TextDecoder().decode(value); } } catch { /* aborted */ } })();
  const mon = await api('POST', '/api/v1/monitors', { name: 'stream push', type: 'CRON_HEARTBEAT', target: 'nightly-job', environment: 'PRD', intervalSec: 3600 });
  assert.ok(mon.status < 300, mon.raw);
  const token = (await one(`select state->>'heartbeatToken' t from ${SCHEMA}.monitors where id = $1`, [mon.body.data.id]))?.t as string | undefined
    ?? (mon.body.data.heartbeatToken as string);
  assert.ok(token, 'push monitor has a heartbeat token');
  await api('POST', `/api/v1/monitors/${mon.body.data.id}/toggle`, {});
  await waitFor(async () => received.includes(mon.body.data.id));
  ac.abort(); await pump;
  assert.equal(received.includes(token), false, 'viewer stream must not carry the heartbeat token');

  // Non-ASCII token of the right length: 401, never a 500
  const odd = 'é'.repeat(48);
  const r = await fetch(`${BASE}/api/v1/agent/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${odd}` }, body: '{}' });
  assert.equal(r.status, 401);
  const inst = await fetch(`${BASE}/api/v1/agent/install/${superAdmin.id}?key=${encodeURIComponent('ü'.repeat(48))}`);
  assert.ok(inst.status === 404 || inst.status === 401, String(inst.status));

  // Manual failover without a passing pre-flight is refused (412) unless explicitly forced
  const s1 = (await api('POST', '/api/v1/servers', { hostname: 'fo-prd', ip: '192.0.2.81', environment: 'PRD' })).body.data;
  const s2 = (await api('POST', '/api/v1/servers', { hostname: 'fo-dr', ip: '192.0.2.82', environment: 'DR' })).body.data;
  // The DR application answers HTTP 500: a confirmed outage once the monitor reaches CRITICAL
  const broken = (await import('node:http')).createServer((_q, r) => { r.statusCode = 500; r.end('down'); });
  await new Promise<void>(r => broken.listen(0, '127.0.0.1', () => r()));
  const drUrl = `http://127.0.0.1:${(broken.address() as { port: number }).port}/health`;
  const app = await api('POST', '/api/v1/applications', { name: 'FO App', codeName: 'fo-app', tier: 'TIER_2', rtoTargetMin: 30, rpoTargetMin: 10, description: '',
    prdServerId: s1.id, drServerId: s2.id, prdUrl: drUrl.replace('/health', '/prd'), drUrl, cloudflareZone: 'example.com', dnsRecordName: 'fo.example.com' });
  assert.ok(app.status < 300, app.raw);
  const drMon = ((await api('GET', '/api/v1/monitors')).body.data as Array<{ id: string; applicationId: string; environment: string; managedBy?: string }>)
    .find(m => m.applicationId === app.body.data.id && m.environment === 'DR' && m.managedBy === 'app-url')!;
  assert.ok(drMon, 'managed DR URL monitor');
  try {
  for (let i = 0; i < 6; i++) {
    const p = await api('POST', `/api/v1/monitors/${drMon.id}/probe`, {});
    if (p.body?.data?.status === 'CRITICAL') break;
  }
  const fo = await api('POST', `/api/v1/applications/${app.body.data.id}/failover`, { target: 'DR', reason: 'test' });
  assert.equal(fo.status, 412, fo.raw);
  assert.match(fo.body.message, /Pre-flight failed/);
  // An explicit override goes ahead (here Cloudflare rejects the fake token) and is audited
  const forced = await api('POST', `/api/v1/applications/${app.body.data.id}/failover`, { target: 'DR', reason: 'test', force: true });
  assert.notEqual(forced.status, 412);
  const audits = (await api('GET', `/api/v1/audit?q=${app.body.data.id}&pageSize=50`)).body.data as Array<{ action: string }>;
  assert.ok(audits.some(a => a.action === 'FAILOVER_PREFLIGHT_OVERRIDDEN'));
  } finally {
    broken.close();
  }
});

test('Check SMTP over HTTP: admins only; with no mail settings it names the problem and reports which variables are missing, never their values', async () => {
  const mk = async (email: string, roleName: string) => {
    const u = await api('POST', '/api/v1/users', { email, password: 'SmtpCheckPassw0rd!', fullName: email, roleName });
    assert.equal(u.status, 201, u.raw);
    return (await api('POST', '/api/auth/login', { email, password: 'SmtpCheckPassw0rd!' }, '')).body.data.tokens.accessToken as string;
  };
  for (const role of ['viewer', 'operator']) {
    assert.equal((await api('POST', '/api/v1/integrations/smtp/verify', {}, await mk(`smtp-${role}@example.com`, role))).status, 403, role);
  }
  const r = await api('POST', '/api/v1/integrations/smtp/verify', {});
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.body.data.ok, false);
  assert.equal(r.body.data.error, 'SMTP is not configured: set SMTP_HOST (or SMTP_SERVICE / SMTP_URL) and SMTP_FROM in the server .env, then restart');
  const vars = r.body.data.settings.variables as { name: string; present: boolean; source: string }[];
  for (const name of ['SMTP_HOST', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASS']) {
    assert.deepEqual(vars.find(v => v.name === name), { name, present: false, source: 'environment' }, name);
  }
  assert.equal(typeof r.body.data.settings.envFile, 'string');
  const status = await api('GET', '/api/v1/integrations');
  assert.equal(status.status, 200, status.raw);
  assert.equal(status.body.data.smtp.configured, false);
  assert.match(status.body.data.smtp.problem, /SMTP is not configured/);
  assert.ok((await api('GET', '/api/v1/audit?q=SMTP_VERIFY_FAILED')).raw.includes('SMTP_VERIFY_FAILED'), 'the check is audited');
});

test('notification read state over HTTP: viewers are refused, operators keep their own unread count; bulk resend reports per item', async () => {
  const mk = async (email: string, roleName: string) => {
    const u = await api('POST', '/api/v1/users', { email, password: 'NotifyPassw0rd!', fullName: email, roleName });
    assert.equal(u.status, 201, u.raw);
    return (await api('POST', '/api/auth/login', { email, password: 'NotifyPassw0rd!' }, '')).body.data.tokens.accessToken as string;
  };
  const viewer = await mk('notify-viewer@example.com', 'viewer');
  const operator = await mk('notify-operator@example.com', 'operator');
  for (const [method, path, body] of [
    ['GET', '/api/v1/notifications/deliveries', undefined], ['GET', '/api/v1/notifications/unread-count', undefined],
    ['POST', '/api/v1/notifications/read', { ids: ['00000000-0000-0000-0000-000000000000'] }], ['POST', '/api/v1/notifications/read-all', {}],
    ['POST', '/api/v1/notifications/resend', { ids: ['00000000-0000-0000-0000-000000000000'] }],
    ['GET', '/api/v1/notifications/health', undefined],
  ] as const) {
    assert.equal((await api(method, path, body, viewer)).status, 403, `viewer: ${method} ${path}`);
  }
  const health = await api('GET', '/api/v1/notifications/health', undefined, operator);
  assert.equal(health.status, 200, health.raw);
  assert.ok(['HEALTHY', 'DEGRADED', 'NOT_CONFIGURED'].includes(health.body.data.status));
  assert.ok(['leader', 'follower', 'standalone'].includes(health.body.data.worker));
  for (const k of ['inFlight', 'waitingRetry', 'grouped', 'heldQuietHours', 'heldInitialDelay', 'logWritesPending']) assert.equal(typeof health.body.data.pending[k], 'number', k);
  assert.equal(typeof health.body.data.last24h.total, 'number');
  assert.ok(Array.isArray(health.body.data.failingChannels));
  assert.equal(health.body.data.secretsKey, 'OK', 'the secrets key is usable and every channel target decrypts');
  const c0 = await api('GET', '/api/v1/notifications/unread-count', undefined, operator);
  assert.equal(c0.status, 200, c0.raw);
  assert.equal(typeof c0.body.data.unread, 'number');
  assert.equal((await api('POST', '/api/v1/notifications/read', { ids: [] }, operator)).status, 400, 'empty id list rejected');
  assert.equal((await api('POST', '/api/v1/notifications/read', { ids: Array.from({ length: 501 }, (_, i) => String(i)) }, operator)).status, 400, 'too many ids rejected');
  assert.equal((await api('POST', '/api/v1/notifications/resend', { ids: Array.from({ length: 26 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`) }, operator)).status, 400, 'bulk resend is capped at 25');
  const all = await api('POST', '/api/v1/notifications/read-all', {}, operator);
  assert.equal(all.status, 200, all.raw);
  assert.equal(all.body.data.unread, 0);
  const bulk = await api('POST', '/api/v1/notifications/resend', { ids: ['00000000-0000-0000-0000-000000000000'] }, operator);
  assert.equal(bulk.status, 200, bulk.raw);
  assert.deepEqual({ delivered: bulk.body.data.delivered, failed: bulk.body.data.failed }, { delivered: 0, failed: 1 });
  assert.equal(bulk.body.data.results[0].message, 'Delivery not found');

  // Saving a webhook channel: internal destinations are refused with the reason (SSRF), public ones accepted
  for (const [url, why] of [
    ['https://10.0.0.5/hook', /private address/], ['https://192.168.1.20/hook', /private address/],
    ['https://127.0.0.1/hook', /loopback address/], ['https://[::1]/hook', /loopback address/],
    ['https://169.254.169.254/latest/meta-data/', /cloud-metadata/], ['https://2130706433/hook', /loopback address/],
    ['https://localhost/hook', /internal host name/], ['https://user:pw@8.8.8.8/hook', /Credentials/],
  ] as const) {
    const r = await api('POST', '/api/v1/channels', { name: 'ssrf', type: 'WEBHOOK', targetEndpoint: url });
    assert.equal(r.status, 400, `${url}: ${r.raw}`);
    assert.match(r.body.message, why, url);
  }
  const okCh = await api('POST', '/api/v1/channels', { name: 'public hook', type: 'WEBHOOK', targetEndpoint: 'https://8.8.8.8/hook', enabled: false });
  assert.equal(okCh.status, 201, okCh.raw);
  assert.equal((await api('PATCH', `/api/v1/channels/${okCh.body.data.id}`, { targetEndpoint: 'https://10.1.1.1/x' })).status, 400, 'editing to an internal target is refused too');
  assert.equal((await api('DELETE', `/api/v1/channels/${okCh.body.data.id}`)).status, 200);

  // Teams: browser / chat / editor pages and incomplete Workflows URLs are refused at save time with the fix
  for (const [url, why] of [
    ['https://teams.cloud.microsoft/l/chat/19:abc@thread.v2/conversations?context=%7B%7D', /link to a Teams channel, not a webhook/],
    ['https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/General?groupId=x', /link to a Teams channel, not a webhook/],
    ['https://make.powerautomate.com/environments/x/flows/y', /Power Automate editor page/],
    ['https://contoso.sharepoint.com/sites/ops', /Microsoft web page, not a webhook/],
    ['https://prod-12.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01', /"sig=" parameter is missing/],
  ] as const) {
    const r = await api('POST', '/api/v1/channels', { name: 'teams', type: 'TEAMS', targetEndpoint: url });
    assert.equal(r.status, 400, `${url}: ${r.raw}`);
    assert.match(r.body.message, why, url);
  }
  const teamsOk = await api('POST', '/api/v1/channels', { name: 'teams relay', type: 'TEAMS', targetEndpoint: 'https://8.8.8.8/teams-relay', enabled: false });
  assert.equal(teamsOk.status, 201, `other https endpoints stay allowed: ${teamsOk.raw}`);
  assert.equal((await api('PATCH', `/api/v1/channels/${teamsOk.body.data.id}`, { targetEndpoint: 'https://teams.microsoft.com/l/channel/x' })).status, 400, 'editing to a channel link is refused');
  assert.equal((await api('DELETE', `/api/v1/channels/${teamsOk.body.data.id}`)).status, 200);

  // Escalation steps: ordered, strictly later, at most 5; saved and returned as sent
  const put = (steps: unknown) => api('PUT', '/api/v1/escalation-policies', { policies: [{ severity: 'HIGH', channels: [], steps }] });
  assert.equal((await put([{ afterMin: 10, channels: [] }, { afterMin: 10, channels: [] }])).status, 400, 'same minute twice');
  assert.equal((await put([{ afterMin: 30, channels: [] }, { afterMin: 10, channels: [] }])).status, 400, 'out of order');
  assert.equal((await put(Array.from({ length: 6 }, (_, i) => ({ afterMin: i + 1, channels: [] })))).status, 400, 'more than 5');
  assert.equal((await put([{ afterMin: 0, channels: [] }])).status, 400, 'minutes required');
  assert.equal((await put([{ afterMin: 5, channels: ['no-such-channel'] }])).status, 400, 'unknown channel');
  const good = await put([{ afterMin: 5, channels: [], notifyOnCall: false, label: 'L1' }, { afterMin: 20, channels: [], label: 'L2' }]);
  assert.equal(good.status, 200, good.raw);
  assert.deepEqual(good.body.data[0].steps.map((x: { afterMin: number; label: string; notifyOnCall: boolean }) => [x.afterMin, x.label, x.notifyOnCall]), [[5, 'L1', false], [20, 'L2', true]]);
  // Quiet hours: never for CRITICAL / EMERGENCY; valid times and a real IANA time zone required
  const quiet = (severity: string, quietHours: unknown) => api('PUT', '/api/v1/escalation-policies', { policies: [{ severity, channels: [], quietHours }] });
  const night = { enabled: true, start: '22:00', end: '07:00', timezone: 'Asia/Kolkata', days: [1, 2, 3, 4, 5] };
  const crit = await quiet('CRITICAL', night);
  assert.equal(crit.status, 400); assert.match(crit.body.message, /never held/);
  assert.equal((await quiet('EMERGENCY', night)).status, 400);
  const tz = await quiet('WARNING', { ...night, timezone: 'Mars/Olympus' });
  assert.equal(tz.status, 400); assert.match(tz.body.message, /Unknown time zone/);
  assert.equal((await quiet('WARNING', { ...night, start: '7pm' })).status, 400);
  assert.equal((await quiet('WARNING', { ...night, days: [9] })).status, 400);
  const okQuiet = await quiet('WARNING', night);
  assert.equal(okQuiet.status, 200, okQuiet.raw);
  assert.deepEqual(okQuiet.body.data[0].quietHours, night);
  assert.equal((await quiet('CRITICAL', { ...night, enabled: false })).status, 200, 'switched off is fine for any severity');
  assert.equal((await api('PUT', '/api/v1/escalation-policies', { policies: [] })).status, 200);
});

test('auth: bad password rejected, lockout after repeated failures, RBAC enforced', async () => {
  assert.equal((await api('POST', '/api/auth/login', { email: ADMIN.email, password: 'wrong-password' }, '')).status, 401);
  assert.equal((await api('GET', '/api/v1/servers', undefined, '')).status, 401);
  assert.equal((await api('GET', '/api/v1/servers', undefined, 'not-a-token')).status, 401);
  // viewer
  const v = await api('POST', '/api/v1/users', { email: 'viewer@example.com', password: 'ViewerPassw0rd!', fullName: 'Viewer', roleName: 'viewer' });
  assert.equal(v.status, 201, v.raw);
  assert.equal(v.raw.includes('passwordHash'), false);
  const vt = (await api('POST', '/api/auth/login', { email: 'viewer@example.com', password: 'ViewerPassw0rd!' }, '')).body.data.tokens.accessToken;
  assert.equal((await api('GET', '/api/v1/servers', undefined, vt)).status, 200);
  assert.equal((await api('POST', '/api/v1/servers', { hostname: 'x', ip: '192.0.2.99', environment: 'PRD' }, vt)).status, 403);
  assert.equal((await api('GET', '/api/v1/cloudflare/accounts', undefined, vt)).status, 403);
  // lockout (10 failures per account per 15 min)
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await api('POST', '/api/auth/login', { email: 'viewer@example.com', password: 'nope' }, '')).status;
  assert.equal(last, 429);
});

test('realtime: stream needs a one-time ticket; access tokens in the URL are refused', async () => {
  assert.equal((await fetch(`${BASE}/api/v1/realtime/stream`)).status, 401);
  assert.equal((await fetch(`${BASE}/api/v1/realtime/stream?token=${token}`)).status, 401, 'access token in URL must not work');
  const ticket = (await api('POST', '/api/v1/realtime/ticket', {})).body.data.ticket;
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/v1/realtime/stream?ticket=${ticket}`, { signal: ctrl.signal });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: connected/);
  ctrl.abort();
  assert.equal((await fetch(`${BASE}/api/v1/realtime/stream?ticket=${ticket}`)).status, 401, 'tickets are single-use');
});

test('telemetry: only an authenticated agent report updates a server, values are stored as sent', async () => {
  const srv = await api('POST', '/api/v1/servers', { hostname: 'telemetry-test', ip: '192.0.2.50', environment: 'DR' });
  assert.equal(srv.status, 201, srv.raw);
  const id = srv.body.data.id;
  const agentToken = (await one(`select agent_token from ${SCHEMA}.servers where id = $1`, [id])).agent_token as string;
  const report = { observedAt: new Date().toISOString(), cpuPercent: 12.5, ramPercent: 40.2, diskPercent: 55.1, load: [0.5, 0.4, 0.3], memTotalMb: 8000, memUsedMb: 3216, memAvailableMb: 4784, diskTotalGb: 100, diskUsedGb: 55.1, diskFreeGb: 44.9, uptimeSec: 86400, hostname: 'dr-host' };
  const bad = await fetch(`${BASE}/api/v1/agent/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' }, body: JSON.stringify(report) });
  assert.equal(bad.status, 401);
  const malformed = await fetch(`${BASE}/api/v1/agent/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken}` }, body: JSON.stringify({ ...report, cpuPercent: 'lots' }) });
  assert.equal(malformed.status, 400);
  const good = await fetch(`${BASE}/api/v1/agent/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken}` }, body: JSON.stringify(report) });
  assert.equal(good.status, 200);
  const s = (await api('GET', `/api/v1/servers/${id}`)).body.data;
  assert.equal(s.agentStatus, 'CONNECTED');
  assert.equal(s.telemetry.cpuPercent, 12.5);
  assert.equal(s.telemetry.memAvailableMb, 4784);
  assert.equal(s.reportedHostname, 'dr-host');
  assert.equal(JSON.stringify(s).includes(agentToken), false, 'agent token must not be returned');
  await waitFor(async () => (await one(`select state->'telemetry'->>'cpuPercent' c from ${SCHEMA}.servers where id = $1`, [id]))?.c === '12.5');
});

test('telemetry API (agent 3.3): backward-compatible responses, new sections, fleet summaries, validation, no secrets', async () => {
  const cols = (await pgc.query(`select column_name from information_schema.columns where table_schema = $1 and table_name = 'server_metrics'`, [SCHEMA])).rows.map(r => r.column_name);
  for (const c of ['cpu', 'ram', 'disk', 'load1', 'net_in', 'net_out', 'swap', 'iowait', 'steal', 'disk_read', 'disk_write', 'disk_util']) assert.ok(cols.includes(c), `server_metrics.${c}`);

  const srv = await api('POST', '/api/v1/servers', { hostname: 'telemetry33-test', ip: '192.0.2.51', environment: 'PRD' });
  assert.equal(srv.status, 201, srv.raw);
  const id = srv.body.data.id;
  const agentToken = (await one(`select agent_token from ${SCHEMA}.servers where id = $1`, [id])).agent_token as string;
  const secret = 'pm2-env-secret-value-7f3a';
  const report = {
    agentVersion: AGENT_VERSION, observedAt: new Date().toISOString(), sentAt: new Date().toISOString(), lastReportRttMs: 30,
    cpuPercent: 20, ramPercent: 50, diskPercent: 60, load: [1, 1, 1], cpuCores: 2, cpuIowaitPercent: 3, cpuStealPercent: 1,
    swapTotalMb: 1024, swapUsedMb: 100, swapFreeMb: 924, swapPercent: 9.8, pressure: { cpu: 1, memory: 0, io: 2 },
    filesystems: [{ mountPoint: '/', filesystem: 'ext4', device: '/dev/vda1', totalGb: 50, usedGb: 30, freeGb: 20, usedPercent: 60, inodeTotal: 100, inodeUsed: 10, inodeFree: 90, inodePercent: 10 }],
    networkInterfaces: [{ name: 'eth0', rxBytesPerSec: 1, txBytesPerSec: 2, rxPacketsPerSec: 1, txPacketsPerSec: 1, rxErrors: 0, txErrors: 0, rxDrops: 0, txDrops: 0, operationalState: 'up', virtual: false }],
    diskIo: [{ device: 'vda', readBytesPerSec: 10, writeBytesPerSec: 20, readOpsPerSec: 1, writeOpsPerSec: 2, ioUtilizationPercent: 5, readLatencyMs: 1, writeLatencyMs: 1 }],
    pm2: [{ id: 0, name: 'app', status: 'online', pid: 5, cpuPercent: 1, memoryMb: 50, restartCount: 0, ports: [4100], env: { TOKEN: secret }, DB_PASSWORD: secret }],
    listeningPorts: [], appChecks: [], failedUnits: { count: 0, units: [] },
    ntp: { synchronized: true, ntpEnabled: true, service: 'systemd-timesyncd', clockOffsetMs: 1.5, clockDriftPpm: null },
    system: { kernelVersion: '6.8.0', architecture: 'x86_64', bootTime: '2026-10-01T00:00:00Z', timezone: 'UTC', osName: 'Ubuntu', osVersion: '24.04', nodeVersion: '22.11.0', npmVersion: '10.9.0' },
  };
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${BASE}/api/v1/agent/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken}`, ...headers }, body: JSON.stringify(body) });

  const good = await post(report);
  assert.equal(good.status, 200);
  const ack = await good.json() as { data: { accepted: boolean; serverId: string; appChecks: unknown[] } };
  assert.equal(ack.data.accepted, true);
  assert.ok(Array.isArray(ack.data.appChecks), 'ingest response lists the local health checks for the agent');

  // Malformed sections are rejected, oversized reports refused, clock skew still enforced
  assert.equal((await post({ ...report, pm2: 'everything' })).status, 400);
  assert.equal((await post({ ...report, ntp: ['x'] })).status, 400);
  assert.equal((await post({ ...report, filesystems: { '/': 1 } })).status, 400);
  assert.equal((await post({ ...report, pm2: null, listeningPorts: null, ntp: null, failedUnits: null })).status, 200, 'null = source not available');
  assert.equal((await post({ ...report, logs: [{ message: 'x'.repeat(600 * 1024) }] })).status, 413);
  const skewed = await post({ ...report, observedAt: new Date(Date.now() - 3600_000).toISOString() });
  assert.equal(skewed.status, 400);
  assert.match(await skewed.text(), /NTP/);
  assert.equal((await post(report)).status, 200);

  const s = await api('GET', `/api/v1/servers/${id}`);
  const d = s.body.data;
  for (const k of ['id', 'hostname', 'ip', 'environment', 'status', 'agentStatus', 'agentVersion', 'lastSeen', 'telemetry', 'processes', 'services', 'logs']) assert.ok(k in d, k);
  for (const k of ['cpuPercent', 'ramPercent', 'diskPercent', 'loadAvg', 'networkInKbps', 'networkOutKbps', 'observedAt', 'receivedAt']) assert.ok(k in d.telemetry, `telemetry.${k}`);
  assert.equal(d.telemetry.swapPercent, 9.8);
  assert.equal(d.telemetry.cpuIowaitPercent, 3);
  assert.equal(d.filesystems[0].inodePercent, 10);
  assert.equal(d.system.kernelVersion, '6.8.0');
  assert.equal(d.ntp.service, 'systemd-timesyncd');
  assert.equal(d.pm2[0].name, 'app');
  assert.equal('env' in d.pm2[0], false);
  assert.equal(s.raw.includes(secret), false, 'PM2 environment never reaches the API');
  assert.equal(s.raw.includes(agentToken), false);
  assert.equal(d.agent.expectedVersion, AGENT_VERSION);
  assert.equal(d.agent.outdated, false);
  assert.ok(Array.isArray(d.health) && d.health.length >= 10);
  assert.ok(Array.isArray(d.warnings));

  const list = await api('GET', '/api/v1/servers');
  assert.ok(Array.isArray(list.body.data) && list.body.data.some((x: { id: string }) => x.id === id));

  const agents = await api('GET', '/api/v1/health/agents');
  assert.ok(Array.isArray(agents.body.data), 'data keeps its list shape');
  const row = agents.body.data.find((r: { serverId: string }) => r.serverId === id);
  for (const k of ['serverId', 'hostname', 'ip', 'environment', 'state', 'version', 'lastSeen', 'startedAt', 'restartCount', 'errors']) assert.ok(k in row, k);
  assert.equal(row.state, 'ONLINE');
  assert.equal(row.outdated, false);
  assert.equal(agents.body.summary.expectedVersion, AGENT_VERSION);
  assert.ok(agents.body.summary.total >= 1 && agents.body.summary.connected >= 1);

  const dbs = await api('GET', '/api/v1/health/databases');
  assert.ok(Array.isArray(dbs.body.data));
  for (const k of ['total', 'healthy', 'warning', 'critical', 'unavailable', 'notConfigured']) assert.equal(typeof dbs.body.summary[k], 'number', k);

  const metrics = await api('GET', `/api/v1/servers/${id}/metrics?range=1h`);
  assert.ok(metrics.body.data.length >= 1);
  assert.equal(metrics.body.data.at(-1).swap, 9.8);
  assert.equal(metrics.body.data.at(-1).diskUtil, 5);
});

test('incident engine: a real failing check opens an incident in PostgreSQL and recovery resolves it', async () => {
  const m = await api('POST', '/api/v1/monitors', { name: 'prodtest status', type: 'HTTP', target: `${BASE}/api/health/live`, environment: 'PRD', intervalSec: 600, timeoutSec: 5, retries: 1, failureConfirmationThreshold: 2, recoveryConfirmationThreshold: 1, expectedStatusCode: 418 });
  assert.equal(m.status, 201, m.raw);
  const id = m.body.data.id;
  await new Promise(r => setTimeout(r, 1500));
  for (let i = 0; i < 3; i++) await api('POST', `/api/v1/monitors/${id}/probe`, {});
  const inc = await waitFor(async () => one(`select id, status, details->'context'->>'probeStatus' p, details->'context'->>'responseCode' code from ${SCHEMA}.incidents where fingerprint = $1`, [`monitor:${id}`]));
  assert.equal(inc.status, 'OPEN');
  assert.equal(inc.p, 'DOWN');
  assert.equal(inc.code, '200');
  await api('PATCH', `/api/v1/monitors/${id}`, { expectedStatusCode: 200 });
  await new Promise(r => setTimeout(r, 1000));
  for (let i = 0; i < 2; i++) await api('POST', `/api/v1/monitors/${id}/probe`, {});
  await waitFor(async () => (await one(`select status from ${SCHEMA}.incidents where id = $1`, [inc.id]))?.status === 'RESOLVED');
});

test('production headers, no stack traces, unknown routes', async () => {
  const page = await fetch(`${BASE}/`);
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal((await api('GET', '/api/v1/servers')).headers.get('cache-control'), 'no-store');
  const badJson = await fetch(`${BASE}/api/v1/servers`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{not json' });
  const text = await badJson.text();
  assert.equal(badJson.status, 400);
  assert.equal(/\bat \w+ \(/.test(text), false, 'no stack trace in responses');
  assert.equal((await api('GET', '/api/v1/does-not-exist')).status, 404);
});

test('rate limiting: API requests above the per-IP limit get 429', async () => {
  const port = PORT + 70;
  const child = spawnServer({ API_RATE_LIMIT_PER_MIN: '10' }, port);
  try {
    await waitReady(`http://127.0.0.1:${port}`);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await fetch(`http://127.0.0.1:${port}/api/v1/servers`)).status);
    assert.ok(statuses.slice(0, 10).every(s => s === 401), 'first requests reach auth');
    assert.equal(statuses[11], 429);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health/live`)).status, 200, 'health endpoints are not rate limited');
  } finally {
    child.kill();
  }
});

test('graceful shutdown: pending data saved, connections closed, exit code 0', async () => {
  const port = PORT + 60;
  let out = '';
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR, JWT_SECRET: SECRETS.jwt, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, LOG_FORMAT: 'json', CLOUDFLARE_API_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout?.on('data', d => { out += d; });
  child.stderr?.on('data', d => { out += d; });
  await waitReady(`http://127.0.0.1:${port}`);
  const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
  child.send('shutdown'); // what PM2 sends with shutdown_with_message (SIGINT/SIGTERM take the same path)
  const code = await Promise.race([exited, new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 10_000))]);
  assert.equal(code, 0, `expected clean exit, got ${code}\n${out.slice(-1500)}`);
  assert.match(out, /shutdown complete/);
});

test('dead-man heartbeat end-to-end: built from agent reports, deprecated DEADMAN_* ignored, no outbound request, no secrets', async () => {
  let hits = 0;
  const wd = (await import('node:http')).createServer((_q, r) => { hits++; r.end('OK'); });
  await new Promise<void>(r => wd.listen(0, '127.0.0.1', () => r()));
  const oldUrl = `http://127.0.0.1:${(wd.address() as { port: number }).port}/ping/e2e-old-secret-uuid?token=e2e-old-token`;
  const port = PORT + 70;
  let out = '';
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR, JWT_SECRET: SECRETS.jwt, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, LOG_FORMAT: 'json', CLOUDFLARE_API_TOKEN: '', DEADMAN_HEARTBEAT_URL: oldUrl, DEADMAN_INTERVAL_SEC: '10' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout?.on('data', d => { out += d; });
  child.stderr?.on('data', d => { out += d; });
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitReady(base);
    const login = await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN) })).json() as { data: { tokens: { accessToken: string } } };
    const get = async (p: string) => { const r = await fetch(base + p, { headers: { Authorization: `Bearer ${login.data.tokens.accessToken}` } }); return { status: r.status, raw: await r.text() }; };
    // A reporting server shows up in the heartbeat with its delivery data
    const srv = JSON.parse((await (await fetch(`${base}/api/v1/servers`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.data.tokens.accessToken}` }, body: JSON.stringify({ hostname: 'hb-e2e', ip: '192.0.2.77', environment: 'PRD' }) })).text())).data;
    const agentToken = (await one(`select agent_token from ${SCHEMA}.servers where id = $1`, [srv.id])).agent_token as string;
    const now = new Date().toISOString();
    const ing = await fetch(`${base}/api/v1/agent/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify({ agentVersion: '3.3.0', observedAt: now, sentAt: now, lastReportRttMs: 20, cpuPercent: 5, ramPercent: 20, diskPercent: 30,
        services: [{ name: 'nginx', status: 'active', pid: 1, memoryMb: 10, since: '' }],
        databases: [{ engine: 'postgresql', name: 'app', available: true, latencyMs: 2, version: '16', sizeBytes: 1, connections: 1, maxConnections: 100, longRunningQueries: 0, replication: null, error: null }] }) });
    assert.equal(ing.status, 200);
    const hb = await waitFor(async () => {
      const d = JSON.parse((await get('/api/v1/deadman/status')).raw).data;
      return d.servers?.some((s: { serverId: string; server: { state: string } }) => s.serverId === srv.id && s.server.state === 'HEALTHY') ? d : null;
    });
    const mine = hb.servers.find((s: { serverId: string }) => s.serverId === srv.id);
    assert.equal(mine.environment, 'PRD');
    assert.equal(mine.server.latencyMs, 10);
    assert.equal(mine.services.healthy, 1);
    assert.equal(mine.databases.checks[0].latencyMs, 2);
    assert.equal(hb.name, 'Dead-Man Watchdog Heartbeat Stream');
    assert.deepEqual(JSON.parse((await get('/api/v1/health/heartbeats')).raw).data.servers.map((s: { serverId: string }) => s.serverId), hb.servers.map((s: { serverId: string }) => s.serverId));
    await new Promise(r => setTimeout(r, 2000));
    assert.equal(hits, 0, 'no request to the (deprecated) external watchdog URL');
    for (const p of ['/api/v1/deadman/status', '/api/v1/bootstrap', '/api/v1/integrations', '/api/v1/system/summary', '/api/health']) {
      const r = await get(p);
      assert.ok(r.status < 500, `${p} → ${r.status}`);
      for (const s of ['e2e-old-secret-uuid', 'e2e-old-token', oldUrl, agentToken]) assert.equal(r.raw.includes(s), false, `${p} exposes a secret`);
    }
    assert.equal('deadMan' in JSON.parse((await get('/api/v1/integrations')).raw).data, false, 'no external watchdog configuration');
    const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
    child.send('shutdown');
    const code = await Promise.race([exited, new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 10_000))]);
    assert.equal(code, 0, `clean exit expected, got ${code}`);
    assert.match(out, /DEADMAN_HEARTBEAT_URL, DEADMAN_INTERVAL_SEC[^"]* deprecated and ignored/);
    for (const s of ['e2e-old-secret-uuid', 'e2e-old-token', oldUrl, agentToken]) assert.equal(out.includes(s), false, 'secret in the logs');
  } finally {
    if (child.exitCode === null) child.kill();
    wd.close();
  }
});

test('logs are structured JSON and contain no secrets', async () => {
  // Rejected API requests are logged with their full path (the /api router must not hide them); a push-heartbeat token is masked
  const hbToken = 'hb-token-in-path-5c1e9a7d';
  assert.equal((await fetch(`${BASE}/api/v1/heartbeat/${hbToken}?value=x`)).status, 404);
  await new Promise(r => setTimeout(r, 500));
  assert.ok(logs.includes('"path":"/api/v1/heartbeat/[REDACTED]","status":404'), 'the rejected heartbeat is logged, token masked');
  assert.equal(logs.includes(hbToken), false, 'a heartbeat token appeared in the logs');
  const lines = logs.split('\n').filter(l => l.startsWith('{'));
  assert.ok(lines.length > 3, 'expected JSON log lines');
  for (const l of lines.slice(0, 50)) { const j = JSON.parse(l); assert.ok(j.ts && j.level && j.service === 'scholario-ops' && j.msg); }
  for (const secret of [ADMIN.password, 'ViewerPassw0rd!', SECRETS.cf, SECRETS.jwt, token]) assert.equal(logs.includes(secret), false, 'a secret appeared in the logs');
  const agentTokens = (await pgc.query(`select agent_token from ${SCHEMA}.servers`)).rows.map(r => r.agent_token as string);
  for (const t of agentTokens) assert.equal(logs.includes(t), false, 'an agent token appeared in the logs');
});

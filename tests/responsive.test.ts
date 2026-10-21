/**
 * Responsive layout in a real browser (headless Chrome over the DevTools protocol): the built
 * frontend (dist/) is served by a production server on a throw-away schema, seeded with long
 * hostnames, URLs and error texts, and checked at 1920 / 1600 / 1366 / 1280 / 1024 px for
 *  - horizontal page overflow,
 *  - elements sticking out of their card (outside intentional scroll areas such as tables),
 *  - grid cells overlapping each other (e.g. Agent / Services / Readiness fields).
 * Skipped when no Chrome/Chromium/Edge is installed or the frontend is not built (npm run build).
 * Set SCREENSHOT_DIR to also save a PNG per page and width.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execSync, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import dotenv from 'dotenv';
import pg from 'pg';
import { pinTestDatabaseUrl, assertConnectedToTestDatabase, dropVerifiedTestSchema } from './helpers/test-db-guard.ts';

const DATABASE_URL = pinTestDatabaseUrl();
dotenv.config({ quiet: true });

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find(p => p && fs.existsSync(p));
const BUILT = fs.existsSync(path.join('dist', 'index.html'));
const SKIP = !CHROME ? 'no Chrome / Chromium / Edge found (set CHROME_PATH)' : !BUILT ? 'frontend not built (run npm run build)' : false;

const SCHEMA = `ops_resptest_${process.pid}`;
const PORT = 4300 + (process.pid % 50);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'resp-admin@example.com', password: 'RespTestPassw0rd!' };
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-resptest-'));
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-resp-chrome-'));
const WIDTHS = [1920, 1600, 1366, 1280, 1024];
const LONG = 'very-long-technical-string-without-any-spaces-'.repeat(4);

let server: ChildProcess | null = null;
let chrome: ChildProcess | null = null;
let watchdog: http.Server | null = null;
let watchdogHits = 0;
let seed: { prdId: string; drId: string; tokens: Record<string, string> } | null = null;
let token = '';
let login: { tokens: { accessToken: string; refreshToken: string }; user: unknown } | null = null;

// ── Minimal DevTools protocol client ─────────────────────────────────────────
class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private handlers = new Map<string, Array<(p: any) => void>>();
  on(method: string, h: (p: any) => void) { this.handlers.set(method, [...(this.handlers.get(method) ?? []), h]); }
  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(String(ev.data));
      if (msg.method) { for (const h of this.handlers.get(msg.method) ?? []) h(msg.params); return; }
      const p = msg.id ? this.pending.get(msg.id) : undefined;
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
    });
  }
  static async connect(url: string) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    return new Cdp(ws);
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); setTimeout(() => reject(new Error(`${method} timed out`)), 30_000).unref(); });
  }
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluation failed');
    return r.result.value as T;
  }
  close() { this.ws.close(); }
}
let page: Cdp | null = null;

async function api(method: string, p: string, body?: unknown) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await r.text();
  assert.ok(r.status < 300, `${method} ${p} → ${r.status} ${raw.slice(0, 300)}`);
  return JSON.parse(raw);
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const evidence = {
  console: [] as string[], failed: [] as string[], currentDoc: '',
  inflight: new Map<string, { url: string; method: string; t: number; doc: string }>(),
};
/** Pending API requests of the CURRENT page, open live streams per page (document), failures and console errors */
const evidenceReport = () => {
  const now = Date.now();
  const list = (items: string[]) => (items.length ? items.map(x => `\n  ${x}`).join('') : ' none');
  const all = [...evidence.inflight.values()];
  const pending = all.filter(r => r.doc === evidence.currentDoc && !r.url.includes('/realtime/stream'))
    .map(r => `${r.method} ${r.url} pending ${Math.round((now - r.t) / 1000)}s`);
  const streams = all.filter(r => r.url.includes('/realtime/stream'));
  const byDoc = new Map<string, number>();
  for (const r of streams) byDoc.set(r.doc, (byDoc.get(r.doc) ?? 0) + 1);
  const streamLines = [...byDoc.entries()].map(([doc, n]) => `${doc === evidence.currentDoc ? 'current page' : `earlier page ${doc.slice(0, 8)}`}: ${n} open`);
  return `\n--- evidence ---\npending API requests on the current page:${list(pending)}\nlive streams the browser still considers open (${streams.length}):${list(streamLines)}\nfailed API requests (last 10):${list(evidence.failed.slice(-10))}\nconsole errors (last 10):${list(evidence.console.slice(-10))}`;
};
/** Is the server itself answering (outside the browser)? How many TCP connections are open to it? */
const serverEvidence = async () => {
  const t0 = Date.now();
  let direct: string;
  try {
    const r = await fetch(`${BASE}/api/health/live`, { signal: AbortSignal.timeout(5000) });
    direct = `HTTP ${r.status} in ${Date.now() - t0} ms`;
    const h = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) }).then(x => x.json()).catch(() => null) as { realtimeClients?: number } | null;
    direct += `; live-stream clients connected on the server: ${h?.realtimeClients ?? 'unknown'}`;
  }
  catch (e) { direct = `no answer after ${Date.now() - t0} ms (${(e as Error).message})`; }
  let conns = 'unknown';
  try {
    const out = execSync(process.platform === 'win32' ? 'netstat -ano -p tcp' : 'netstat -tn', { encoding: 'utf8', timeout: 5000 });
    const port = new URL(BASE).port;
    const lines = out.split(/\r?\n/).filter(l => l.includes('ESTABLISHED'));
    const toServer = lines.filter(l => { const cols = l.trim().split(" ").filter(Boolean); return (cols[2] ?? '').endsWith(`:${port}`); }).length;
    conns = `${toServer} established client connections to port ${port}`;
  } catch (e) { conns = `netstat failed: ${(e as Error).message}`; }
  return `
server direct check (outside the browser): ${direct}
${conns}`;
};
/** Database sessions of the test database at the moment of a failure (query text only, never parameter values) */
const dbEvidence = async () => {
  const c = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
  try {
    await c.connect();
    const rows = (await c.query(`select state, coalesce(wait_event_type || '/' || wait_event, '-') wait, round(extract(epoch from now() - coalesce(xact_start, query_start)))::int age_s,
        left(regexp_replace(query, '[[:space:]]+', ' ', 'g'), 100) q
      from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and state is not null order by age_s desc nulls last limit 15`)).rows;
    return `\ndatabase sessions (${rows.length}):` + rows.map(r => `\n  ${r.state} wait=${r.wait} age=${r.age_s}s  ${r.q}`).join('');
  } catch (e) { return `\ndatabase snapshot unavailable: ${(e as Error).message}`; } finally { await c.end().catch(() => {}); }
};
const waitFor = async (pred: () => Promise<boolean>, what = 'condition', timeoutMs = 15_000) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await pred().catch(() => false)) return; await sleep(200); }
  throw new Error(`${what}: not met in time${evidenceReport()}${await serverEvidence()}${await dbEvidence()}`);
};

let verified = false;
before(async () => {
  if (SKIP) return;
  const probe = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
  await probe.connect();
  try { await assertConnectedToTestDatabase(probe); } finally { await probe.end().catch(() => {}); }
  verified = true;
  // Deprecated external watchdog URL is set on purpose: it must be ignored (no request ever reaches it)
  watchdog = http.createServer((_q, r) => { watchdogHits++; r.end('OK'); });
  await new Promise<void>(r => watchdog!.listen(0, '127.0.0.1', () => r()));
  server = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: { ...process.env, DATABASE_URL, NODE_ENV: 'production', PORT: String(PORT), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password,
      JWT_SECRET: 'r'.repeat(40), PUBLIC_URL: 'https://ops.test.invalid', CLOUDFLARE_API_TOKEN: '', HOSTINGER_API_TOKEN: '', LOG_FORMAT: 'json',
      DEADMAN_HEARTBEAT_URL: `http://127.0.0.1:${(watchdog.address() as { port: number }).port}/ping/secret-uuid`, DEADMAN_INTERVAL_SEC: '10',
      NOTIFY_ALLOWED_PRIVATE_TARGETS: '127.0.0.1' },
    // SERVER_LOG=<file> keeps the test server's log for debugging
    stdio: process.env.SERVER_LOG ? (fd => ['ignore', fd, fd])(fs.openSync(process.env.SERVER_LOG, 'a')) : ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 150; i++) { try { if ((await fetch(`${BASE}/api/health/ready`)).status === 200) break; } catch { /* starting */ } await sleep(200); }

  const l = await api('POST', '/api/auth/login', ADMIN);
  login = l.data; token = l.data.tokens.accessToken;
  // Seed: servers with long names, an LB-mapped application, agent reports with long texts
  const prd = (await api('POST', '/api/v1/servers', { hostname: `prd-${'node'.repeat(8)}.production.example-company-datacenter.com`, ip: '198.51.100.71', environment: 'PRD', provider: 'Hostinger', region: 'Asia (Mumbai) — very long region name' })).data;
  const dr = (await api('POST', '/api/v1/servers', { hostname: `dr-${'node'.repeat(8)}.disaster-recovery.example-company-datacenter.com`, ip: '198.51.100.72', environment: 'DR', region: 'Europe (Frankfurt)' })).data;
  await api('POST', '/api/v1/applications', {
    name: 'Learning Management Platform With A Long Name', codeName: 'lms-long', tier: 'TIER_1', rtoTargetMin: 30, rpoTargetMin: 10, description: '',
    prdServerId: prd.id, drServerId: dr.id, prdUrl: `https://${'subdomain.'.repeat(4)}example.com/health/${LONG}`, drUrl: 'https://dr.example.com/health',
    loadBalancer: { accountId: 'a'.repeat(32), hostname: `lms.${'region.'.repeat(3)}example.com`, prdPoolId: 'b'.repeat(32), drPoolId: 'c'.repeat(32) },
  });
  const pgc = new pg.Client({ connectionString: DATABASE_URL });
  await pgc.connect();
  const tokens = Object.fromEntries((await pgc.query(`select id, agent_token from ${SCHEMA}.servers`)).rows.map(r => [r.id, r.agent_token]));
  await pgc.end();
  seed = { prdId: prd.id, drId: dr.id, tokens };
  for (const srv of [prd, dr]) {
    const now = new Date().toISOString();
    await fetch(`${BASE}/api/v1/agent/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[srv.id]}` },
      body: JSON.stringify({
        agentVersion: srv === prd ? '3.2.0' : '3.3.0', observedAt: now, sentAt: now, lastReportRttMs: 20, hostname: srv.hostname, os: 'Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)',
        cpuPercent: 91.5, ramPercent: 88.2, diskPercent: 96.4, load: [12.5, 10.1, 9.9], cpuCores: 4, uptimeSec: 9_999_999,
        services: [{ name: `php8.3-fpm-${LONG}`, status: 'failed', pid: 0, memoryMb: 0, since: '' }, { name: 'nginx', status: 'active', pid: 1, memoryMb: 30, since: 'Mon 2026-10-05 10:00:00 UTC' }],
        ...(srv === dr ? {
          filesystems: [{ mountPoint: `/var/lib/${LONG}`, filesystem: 'ext4', device: `/dev/mapper/${LONG}`, totalGb: 100, usedGb: 96, freeGb: 4, usedPercent: 96, inodeTotal: 100, inodeUsed: 90, inodeFree: 10, inodePercent: 90 }],
          pm2: [{ id: 0, name: `scholario-ops-${LONG}`, status: 'errored', pid: null, restartCount: 40, release: '20261008-101500-abc1234', ports: [4100] }],
          appChecks: [{ applicationId: 'x', name: 'LMS', environment: 'DR', port: 4100, path: `/api/health/${LONG}`, listening: false, status: 'DOWN', error: `nothing accepting connections ${LONG}`, checkedAt: now }],
          errors: [`services: ${LONG}`],
        } : {}),
      }),
    });
  }

  chrome = spawn(CHROME!, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars', `--user-data-dir=${PROFILE}`, '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let err = '';
    chrome!.stderr!.on('data', d => { err += d; const m = err.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
    setTimeout(() => reject(new Error(`Chrome did not start: ${err.slice(0, 500)}`)), 20_000).unref();
  });
  const browser = await Cdp.connect(wsUrl);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const port = new URL(wsUrl).port;
  page = await Cdp.connect(`ws://127.0.0.1:${port}/devtools/page/${targetId}`);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  // Evidence for failures: browser console errors, exceptions, pending and failed network requests
  await page.send('Network.enable');
  page.on('Runtime.consoleAPICalled', p => { if (p.type === 'error' || p.type === 'warning') evidence.console.push(`${new Date().toISOString().slice(11, 23)} console.${p.type}: ${(p.args ?? []).map((a: any) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`); });
  page.on('Runtime.exceptionThrown', p => evidence.console.push(`${new Date().toISOString().slice(11, 23)} exception: ${(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? '').slice(0, 300)}`));
  page.on('Network.requestWillBeSent', p => {
    if (p.type === 'Document') evidence.currentDoc = p.loaderId; // a new page (document) starts
    if (String(p.request.url).includes('/api/')) evidence.inflight.set(p.requestId, { url: p.request.url.replace(BASE, ''), method: p.request.method, t: Date.now(), doc: p.loaderId });
  });
  page.on('Network.responseReceived', p => { const r = evidence.inflight.get(p.requestId); if (r && p.response.status >= 400) evidence.failed.push(`${r.method} ${r.url} → HTTP ${p.response.status}`); });
  page.on('Network.loadingFinished', p => evidence.inflight.delete(p.requestId));
  page.on('Network.loadingFailed', p => { const r = evidence.inflight.get(p.requestId); if (r) { evidence.failed.push(`${r.method} ${r.url} → ${p.errorText}${p.canceled ? ' (canceled)' : ''}`); evidence.inflight.delete(p.requestId); } });
  // Log in the way the app does (tokens in localStorage), then load pages
  await page.send('Page.navigate', { url: `${BASE}/login` });
  await sleep(1500);
  await page.eval(`localStorage.setItem('scholario_access_token', ${JSON.stringify(login!.tokens.accessToken)});
    localStorage.setItem('scholario_refresh_token', ${JSON.stringify(login!.tokens.refreshToken ?? '')});
    localStorage.setItem('scholario_user', ${JSON.stringify(JSON.stringify(login!.user))}); true`);
});

after(async () => {
  page?.close();
  chrome?.kill();
  server?.kill();
  watchdog?.close();
  await sleep(500);
  await dropVerifiedTestSchema(verified, async () => {
    const pgc = new pg.Client({ connectionString: DATABASE_URL });
    try { await pgc.connect(); await pgc.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); } finally { await pgc.end().catch(() => {}); }
  });
  for (const d of [DATA_DIR, PROFILE]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* chrome may still hold files */ } }
});

/** Runs in the page: overflow / overlap problems inside `root` (default: the main content area). */
const CHECK = (rootSelector: string) => `(() => {
  const root = document.querySelector(${JSON.stringify(rootSelector)});
  if (!root) return { error: 'root not found: ${rootSelector}' };
  const problems = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > window.innerWidth + 1) problems.push('page scrolls horizontally: ' + doc.scrollWidth + ' > ' + window.innerWidth);
  const scrolls = el => { for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  const label = el => (el.tagName + '.' + String(el.className).slice(0, 60) + ' "' + (el.textContent || '').trim().slice(0, 50) + '"');
  const cards = [...root.querySelectorAll('[class*="rounded"][class*="border"]')];
  for (const card of cards) {
    // The card itself, or something around it, is an intentional horizontal scroll area (wide tables / diagrams)
    const ownOverflow = getComputedStyle(card).overflowX;
    if (scrolls(card) || ownOverflow === 'auto' || ownOverflow === 'scroll') continue;
    const c = card.getBoundingClientRect();
    if (c.width === 0) continue;
    for (const el of card.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Ignore content inside a horizontal scroll area that lives inside the card (tables)
      let inner = false;
      for (let p = el.parentElement; p && p !== card; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { inner = true; break; } }
      if (inner) continue;
      if (r.right > c.right + 1.5 || r.left < c.left - 1.5) { problems.push('sticks out of its card: ' + label(el) + ' (' + Math.round(r.left) + '–' + Math.round(r.right) + ' vs card ' + Math.round(c.left) + '–' + Math.round(c.right) + ')'); break; }
    }
  }
  // Text must not spill out of its own box (e.g. a status value running into the next field)
  for (const el of root.querySelectorAll('div, span, p, dd, dt, td, a, button, code, b, strong, li')) {
    if (scrolls(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'visible' || cs.display === 'inline' || el.clientWidth === 0) continue;
    if (el.scrollWidth > el.clientWidth + 2) { problems.push('content wider than its box: ' + label(el) + ' (' + el.scrollWidth + ' > ' + el.clientWidth + ')'); }
  }
  // Grid cells must not overlap each other
  for (const g of root.querySelectorAll('*')) {
    if (getComputedStyle(g).display !== 'grid') continue;
    const kids = [...g.children].map(k => k.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i], b = kids[j];
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 1 && h > 1) { problems.push('grid cells overlap in ' + label(g)); i = kids.length; break; }
    }
  }
  // The top bar: nothing may leave it (wrap below it or run past the window edge)
  const header = document.querySelector('header');
  if (header && root.tagName === 'MAIN') {
    const h = header.getBoundingClientRect();
    for (const el of header.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > Math.min(h.right, window.innerWidth) + 1 || r.bottom > h.bottom + 1 || r.top < h.top - 1) { problems.push('top bar: ' + label(el) + ' leaves the bar'); break; }
    }
  }
  return { problems: [...new Set(problems)].slice(0, 12), bodyText: document.body.innerText.length };
})()`;

async function visit(route: string, width: number, ready: string) {
  await page!.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
  // Navigate from inside the page: Page.navigate can hang while the page holds its realtime (SSE) stream open
  await page!.eval(`setTimeout(() => location.assign(${JSON.stringify(BASE + route)}), 0); true`);
  await sleep(400);
  for (let i = 0; i < 80; i++) {
    const ok = await page!.eval<boolean>(`location.pathname === ${JSON.stringify(route)} && document.body.innerText.includes(${JSON.stringify(ready)})`).catch(() => false);
    if (ok) break;
    await sleep(250);
  }
  await sleep(600); // let late data (availability, readiness) settle
}

async function shot(name: string) {
  if (!process.env.SCREENSHOT_DIR) return;
  const { data } = await page!.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.SCREENSHOT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
}

const PAGES: Array<{ route: string; ready: string }> = [
  { route: '/overview', ready: 'Dead-Man' },
  { route: '/infrastructure', ready: 'VPS INFRASTRUCTURE' },
  { route: '/monitors', ready: 'Dead-Man Heartbeat' },
  { route: '/setup', ready: 'Dead-man heartbeat' },
];

for (const width of WIDTHS) {
  test(`no page overflow, nothing outside its card, no overlapping fields at ${width}px`, { skip: SKIP }, async () => {
    const failures: string[] = [];
    for (const p of PAGES) {
      await visit(p.route, width, p.ready);
      const r = await page!.eval<{ problems: string[]; error?: string; bodyText: number }>(CHECK('main'));
      assert.ok(!r.error, r.error);
      assert.ok(r.bodyText > 200, `${p.route} did not render`);
      await shot(`${p.route.slice(1)}-${width}`);
      for (const x of r.problems) failures.push(`${p.route}: ${x}`);
    }
    // Server drawer: every tab
    await visit('/infrastructure', width, 'VPS INFRASTRUCTURE');
    await page!.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Inspect').click(), true`);
    await sleep(500);
    const tabs = await page!.eval<string[]>(`[...document.querySelectorAll('[role=tab]')].map(t => t.textContent.trim())`);
    assert.ok(tabs.length >= 10, `drawer tabs: ${tabs.join(', ')}`);
    for (let i = 0; i < tabs.length; i++) {
      await page!.eval(`document.querySelectorAll('[role=tab]')[${i}].click(), true`);
      await sleep(350);
      const r = await page!.eval<{ problems: string[] }>(CHECK('[role=dialog]'));
      if (i === 0) await shot(`drawer-overview-${width}`);
      for (const x of r.problems) failures.push(`drawer/${tabs[i]}: ${x}`);
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  });
}

/** Sends a fresh agent report (the agents seeded in before() have gone stale by now) */
async function report(serverId: string, extra: Record<string, unknown>) {
  const now = new Date().toISOString();
  const r = await fetch(`${BASE}/api/v1/agent/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seed!.tokens[serverId]}` },
    body: JSON.stringify({ agentVersion: '3.3.0', observedAt: now, sentAt: now, lastReportRttMs: 20, cpuPercent: 10, ramPercent: 20, diskPercent: 30, ...extra }) });
  assert.equal(r.status, 200);
}
const setSelect = (label: string, value: string) => page!.eval(`(() => {
  const s = document.querySelector('select[aria-label="${label}"]');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(value)});
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
const bodyText = () => page!.eval<string>('document.body.innerText');
const waitText = async (pred: (t: string) => boolean, what: string) => {
  for (let i = 0; i < 60; i++) { if (pred(await bodyText())) return; await sleep(250); }
  assert.fail(`timed out waiting for: ${what}${evidenceReport()}${await serverEvidence()}${await dbEvidence()}
--- page text ---
${(await bodyText()).slice(0, 3000)}`);
};

/** Every page of the app (routes in src/App.tsx) — no page overflow, nothing outside its card, no overlaps */
const ALL_ROUTES = ['/applications', '/incidents', '/resilience', '/backups', '/dependencies', '/hostinger', '/cloudflare',
  '/deployments', '/runbooks', '/maintenance', '/communications', '/reliability', '/resources', '/reports', '/audit', '/users'];
for (const width of [1366, 1024]) {
  test(`all other pages render cleanly at ${width}px`, { skip: SKIP }, async () => {
    const failures: string[] = [];
    for (const route of ALL_ROUTES) {
      await visit(route, width, '');
      // Wait until the page content (not only the shell) has rendered
      for (let i = 0; i < 40; i++) { if ((await page!.eval<number>(`document.querySelector('main')?.innerText.length ?? 0`)) > 120) break; await sleep(250); }
      // …and table skeletons have been replaced by real rows (pulse dots elsewhere are tiny, skeleton bars are not)
      for (let i = 0; i < 40; i++) {
        const skeletons = await page!.eval<number>(`[...document.querySelectorAll('main .animate-pulse')].filter(e => e.getBoundingClientRect().width > 40).length`);
        if (skeletons === 0) break; await sleep(250);
      }
      await sleep(500);
      const r = await page!.eval<{ problems: string[]; error?: string }>(CHECK('main'));
      assert.ok(!r.error, r.error);
      await shot(`page${route.replace(/\//g, '-')}-${width}`);
      for (const x of r.problems) failures.push(`${route}: ${x}`);
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  });
}

test('heartbeat stream in the browser: ICT stopped on PRD → server stays CONNECTED, node FAILING; expand; filters; recovery; no watchdog', { skip: SKIP }, async () => {
  const svc = [{ name: 'nginx', status: 'active', pid: 1, memoryMb: 20, since: '' }, { name: 'pm2-root', status: 'active', pid: 2, memoryMb: 30, since: '' }];
  const ict = (status: 'HEALTHY' | 'DOWN') => [{ applicationId: 'ict', name: 'ICT Production', environment: 'PRD', port: 4100, path: '/health', listening: status === 'HEALTHY', status,
    statusCode: status === 'HEALTHY' ? 200 : null, latencyMs: status === 'HEALTHY' ? 5 : null, error: status === 'DOWN' ? 'timed out' : null, checkedAt: new Date().toISOString() }];
  // ICT stops: two failed checks in a row while the PRD agent keeps reporting
  await report(seed!.prdId, { services: svc, appChecks: ict('DOWN') });
  await report(seed!.prdId, { services: svc, appChecks: ict('DOWN') });
  await report(seed!.drId, { services: svc });
  await visit('/monitors', 1366, 'Dead-Man Watchdog Heartbeat Stream');
  // The seeded LMS URL monitor can also be failing by the time this runs. The PRD reason must name ICT.
  await waitText(t => /application heartbeats? failing \([^)]*ICT Production/.test(t), 'collapsed PRD reason');
  await shot('heartbeat-ict-down-collapsed');
  let t = await bodyText();
  for (const x of ['PRD VPS · 198.51.100.71', 'DR VPS · 198.51.100.72', 'Overall node', 'UI stream: 1 Hz refresh (animation only)', 'Heartbeat type']) assert.ok(t.includes(x), x);
  assert.match(t, /Server\s*CONNECTED/, 'the server heartbeat itself stays connected');
  assert.equal(t.includes('pm2-root'), false, 'collapsed by default');
  // Expand PRD
  await page!.eval(`[...document.querySelectorAll('button[aria-expanded]')].find(b => b.textContent.includes('PRD VPS ·')).click(), true`);
  await waitText(x => x.includes('pm2-root'), 'expanded PRD');
  await shot('heartbeat-ict-down-expanded');
  t = await bodyText();
  for (const x of ['APPLICATIONS', 'SERVICES', 'DATABASE', 'ICT Production', 'consecutive failure']) assert.ok(t.toUpperCase().includes(x.toUpperCase()), x);
  // Filters: failing applications → only ICT on PRD
  await setSelect('Heartbeat type', 'APPLICATION');
  await setSelect('Status', 'FAILING');
  await waitText(x => /ICT Production\s*— PRD/.test(x), 'filtered list');
  t = await bodyText();
  assert.ok(/ICT Production\s*— PRD/.test(t), 'ICT on PRD');
  assert.equal(/ICT Production\s*— DR/.test(t), false, 'the ICT agent check was reported for PRD only');
  assert.equal(t.includes('pm2-root'), false);
  await setSelect('Server', 'DR');
  await waitText(x => !/ICT Production/.test(x), 'ICT failure is not on DR');
  await setSelect('Heartbeat type', 'SERVICE'); await setSelect('Status', 'HEALTHY'); await setSelect('Server', 'PRD');
  await waitText(x => /2 matching heartbeats/i.test(x), 'healthy PRD services');
  await page!.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Clear filters')).click(), true`);
  await waitText(x => x.includes('Overall node'), 'back to the server-first view');
  // Recovery arrives over the live stream; the parent recalculates without a reload
  await report(seed!.prdId, { services: svc, appChecks: ict('HEALTHY') });
  await waitText(x => !/application heartbeats? failing \([^)]*ICT Production/.test(x), 'PRD ICT recovered without reload');
  await visit('/overview', 1366, 'Dead-Man');
  assert.ok((await bodyText()).includes('PRD VPS + DR VPS'), 'dead-man card names the monitored servers');
  const html = await page!.eval<string>('document.documentElement.outerHTML');
  assert.equal(html.includes('secret-uuid'), false, 'old watchdog URL in the DOM');
  for (const tok of Object.values(seed!.tokens)) assert.equal(html.includes(tok), false, 'agent token in the DOM');
  assert.equal(watchdogHits, 0, 'no request to the deprecated external watchdog');
});


test('live stream: after many page changes the server holds one live-stream connection for the tab (no leaked streams)', { skip: SKIP }, async () => {
  for (const route of ['/overview', '/monitors', '/incidents', '/communications', '/reliability', '/backups', '/audit', '/overview', '/applications', '/communications']) {
    await visit(route, 1366, '');
  }
  const clients = async () => ((await fetch(`${BASE}/api/health`).then(r => r.json())) as { realtimeClients: number }).realtimeClients;
  await waitFor(async () => (await clients()) <= 1, `at most one live stream on the server (got ${await clients()})`, 10_000);
  // …and the page is fully usable: a normal request completes quickly
  const t0 = Date.now();
  const status = await page!.eval<number>(`fetch('/api/health', { cache: 'no-store' }).then(r => r.status)`);
  assert.equal(status, 200);
  assert.ok(Date.now() - t0 < 3000, `request from the page took ${Date.now() - t0} ms`);
});

test('notifications page end to end: create a channel in the form, test send fails → delivery log (live), filters, resend, 24 h stats, delete', { skip: SKIP }, async () => {
  const setInput = (selector: string, value: string) => page!.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const click = (text: string, within = 'document') => page!.eval(`(() => {
    const b = [...${within}.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(text)});
    if (!b) throw new Error('no button ' + ${JSON.stringify(text)});
    b.click(); return true;
  })()`);
  const card = `[...document.querySelectorAll('div')].reverse().find(d => d.textContent.includes('UI test webhook') && d.querySelector('button') && [...d.querySelectorAll('button')].some(b => b.textContent.includes('SEND TEST')))`;

  await visit('/communications', 1366, 'NOTIFICATION CHANNELS');
  // 1. Create through the form (an https target nobody listens on: every delivery fails, quickly)
  await click('Add channel');
  await waitText(t => t.includes('New channel'), 'channel form');
  await setInput('input[placeholder="e.g. Ops on-call Teams"]', 'UI test webhook');
  await page!.eval(`(() => {
    const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'WEBHOOK'));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'WEBHOOK');
    s.dispatchEvent(new Event('change', { bubbles: true })); return true;
  })()`);
  const fillUrl = `(() => {
    const el = [...document.querySelectorAll('input')].find(i => (i.placeholder || '').startsWith('https://'));
    if (!el) return false;
    if (el.value !== 'https://127.0.0.1:1/scholario-hook') {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'https://127.0.0.1:1/scholario-hook');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const name = document.querySelector('input[placeholder="e.g. Ops on-call Teams"]');
    return el.value === 'https://127.0.0.1:1/scholario-hook' && name && name.value === 'UI test webhook';
  })()`;
  await waitFor(async () => page!.eval<boolean>(fillUrl), 'channel form filled');
  await sleep(300);
  assert.equal(await page!.eval<boolean>(fillUrl), true, 'form values kept after re-render');
  await click('Create channel');
  await waitText(t => t.includes('UI test webhook'), 'channel card');
  await waitText(t => t.includes('NOTIFICATIONS: 1 channel enabled'), 'header badge follows the live channel list');
  await waitText(t => t.toUpperCase().includes('DELIVERY HEALTH') && t.includes('Success rate'.toUpperCase()) || t.toUpperCase().includes('SUCCESS RATE'), 'delivery health card');
  await waitText(t => t.includes('Nothing sent yet') || t.includes('DELIVERY LOG') || t.includes('Delivery log'), 'delivery log section');

  // 2. Test send: fails after retries; the log updates live (no reload)
  await page!.eval(`${card}.querySelector('button[title="Send a test notification"]').click(), true`);
  await waitFor(async () => /FAILED[\s\S]{0,40}3 attempts/.test(await bodyText()), 'failed test delivery in the log', 40_000);
  let t = await bodyText();
  assert.ok(t.includes('TEST'), 'type column');
  assert.ok(t.includes('Scholario Ops test notification'), 'what was sent');

  // 3. Filters
  await setSelect('Filter by result', 'DELIVERED');
  await waitText(x => x.includes('No deliveries match these filters'), 'no delivered rows');
  await setSelect('Filter by result', 'FAILED');
  await waitText(x => /FAILED[\s\S]{0,40}3 attempts/.test(x), 'failed rows back');

  // 4. Resend → a second (failed) row marked as resend; 24 h stats on the card
  await page!.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Resend').click(), true`);
  await waitFor(async () => (await bodyText()).includes('resend'), 'resend row', 40_000);
  // At least these two failures (background alerts to this channel can add more)
  await waitFor(async () => /0 delivered\s*·\s*([2-9]|\d{2,}) failed/.test(await bodyText()), '24 h stats on the card', 15_000);
  // 4b. Read state. Other alerts can arrive meanwhile (the agents seeded for this file go stale), so the
  // log is filtered to this test's TEST messages and the sidebar badge is checked relative to its value.
  const LOG_ROWS = `table[aria-label="Notification delivery log"] tbody tr`;
  const navBadge = `(() => { const a = [...document.querySelectorAll('aside button, aside a')].find(x => x.textContent.includes('Notifications')); const m = a && a.textContent.match(/Notifications\\s*(\\d+)/); return m ? Number(m[1]) : 0; })()`;
  await setSelect('Filter by notification type', 'TEST');
  await waitFor(async () => (await page!.eval<number>(`document.querySelectorAll('${LOG_ROWS}').length`)) === 2, 'two TEST deliveries');
  assert.equal(await page!.eval<number>(`document.querySelectorAll('${LOG_ROWS}[data-unread="true"]').length`), 2, 'both start unread');
  try {
    await waitFor(async () => (await page!.eval<number>(navBadge)) >= 2, 'sidebar badge counts them');
  } catch (e) {
    const api = await page!.eval<string>(`fetch('/api/v1/notifications/unread-count', { headers: { Authorization: 'Bearer ' + localStorage.getItem('scholario_access_token') } }).then(r => r.status + ' ' + r.text())`);
    const nav = await page!.eval<string>(`[...document.querySelectorAll('aside button, aside a')].find(x => x.textContent.includes('Notifications'))?.textContent ?? '(no nav item)'`);
    throw new Error(`${(e as Error).message}
unread-count API: ${api}
sidebar item text: ${JSON.stringify(nav)}`);
  }
  const badgeBefore = await page!.eval<number>(navBadge);
  await page!.eval(`document.querySelector('input[aria-label="Select all on this page"]').click(), true`);
  await waitText(x => x.includes('2 selected'), 'bulk bar');
  await page!.eval(`[...document.querySelectorAll('[role=toolbar] button')].find(b => b.textContent.includes('Mark read')).click(), true`);
  await waitFor(async () => (await page!.eval<number>(`document.querySelectorAll('${LOG_ROWS}[data-unread="true"]').length`)) === 0, 'rows marked read');
  await waitFor(async () => (await page!.eval<number>(navBadge)) < badgeBefore, 'badge went down');
  await page!.eval(`document.querySelector('input[aria-label="Select all on this page"]').click(), true`);
  await page!.eval(`[...document.querySelectorAll('[role=toolbar] button')].find(b => b.textContent.includes('Mark unread')).click(), true`);
  await waitFor(async () => (await page!.eval<number>(`document.querySelectorAll('${LOG_ROWS}[data-unread="true"]').length`)) === 2, 'rows unread again');
  await page!.eval(`document.querySelector('input[aria-label="Show unread only"]').click(), true`);
  await waitFor(async () => (await page!.eval<number>(`document.querySelectorAll('${LOG_ROWS}').length`)) === 2, 'unread-only filter');
  await click('Mark all read');
  await waitText(x => x.includes('No deliveries match these filters'), 'nothing unread after mark all read');
  await page!.eval(`document.querySelector('input[aria-label="Show unread only"]').click(), true`);
  await waitFor(async () => (await page!.eval<number>(`document.querySelectorAll('${LOG_ROWS}').length`)) === 2, 'all rows back');
  assert.equal(await page!.eval<number>(`document.querySelectorAll('${LOG_ROWS}[data-unread="true"]').length`), 0, 'read after mark all read');
  await setSelect('Filter by notification type', '');

  // 4c. Detail panel: open from the log, attempt history, Esc closes and focus returns to the row
  await page!.eval(`[...document.querySelectorAll('table[aria-label="Notification delivery log"] tbody tr')].find(tr => tr.textContent.includes('Scholario Ops test notification')).querySelector('button[title^="Details:"]').click(), true`);
  await waitFor(async () => page!.eval<boolean>(`!!document.querySelector('[role=dialog][aria-modal=true]')`), 'detail panel opened');
  await waitText(x => x.toUpperCase().includes('ATTEMPTS ON THIS CHANNEL (') && x.includes('Not linked to an incident'), 'detail content');
  t = await bodyText();
  assert.ok(t.includes('Scholario Ops test notification'), 'message title in the panel');
  assert.ok(/Failed · 3 attempts/.test(t), 'result with attempts');
  assert.ok(t.includes('Test message sent by'), 'the message text that was sent');
  assert.equal(await page!.eval<boolean>(`document.querySelector('[role=dialog]').contains(document.activeElement)`), true, 'focus moved into the panel');
  await page!.eval(`document.querySelector('[role=dialog]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`);
  await waitFor(async () => page!.eval<boolean>(`!document.querySelector('[role=dialog][aria-modal=true]')`), 'Esc closes the panel');
  await waitFor(async () => (await page!.eval<string>(`document.activeElement?.getAttribute('title') ?? ''`)).startsWith('Details:'), 'focus returned to the row that opened the panel');

  // An incident-driven notification shows its incident and links to it
  const inc = (await api('POST', '/api/v1/incidents', { title: 'Detail panel incident', severity: 'HIGH', environment: 'PRD' })).data as { id: string };
  await waitFor(async () => (await bodyText()).includes(inc.id), 'incident notification in the log', 30_000);
  await page!.eval(`[...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes(${JSON.stringify(inc.id)})).querySelector('button[title^="Details:"]').click(), true`);
  await waitText(x => x.includes(`${inc.id} · Detail panel incident`) && x.includes('Open incident'), 'incident context in the panel');
  await page!.eval(`[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.includes('Open incident')).click(), true`);
  await waitFor(async () => (await page!.eval<string>('location.pathname + location.search')) === `/incidents?id=${inc.id}`, 'Open incident navigates to it');
  await visit('/communications', 1366, 'NOTIFICATION CHANNELS');

  await shot('notifications-delivery-log-1366');
  const r = await page!.eval<{ problems: string[]; error?: string }>(CHECK('main'));
  assert.deepEqual(r.problems, [], r.problems.join('\n'));
  const html = await page!.eval<string>('document.documentElement.outerHTML');
  assert.equal((html.match(/127\.0\.0\.1:1\/scholario-hook/g) ?? []).length <= 1, true, 'the target appears only on the admin channel card, never in the log');

  // 5. Delete through the UI
  await page!.eval(`[...${card}.querySelectorAll('button')].find(b => b.textContent.trim() === 'Delete').click(), true`);
  await waitText(x => x.includes('Delete this channel?'), 'confirm delete');
  await click('Delete');
  await waitFor(async () => !(await bodyText()).includes('Delete this channel?') && (await page!.eval<boolean>(`!${card}`)), 'channel card removed');
  t = await bodyText();
  assert.ok(t.includes('UI test webhook'), 'the log keeps the history of a deleted channel');
});

test('escalation steps editor: add ordered steps, out-of-order is flagged, save persists them, remove clears', { skip: SKIP }, async () => {
  const setValue = (selector: string, value: string) => page!.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true })); return true;
  })()`);
  const click = (text: string) => page!.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) throw new Error('no button ' + ${JSON.stringify(text)} + ' — buttons on the page: ' + [...document.querySelectorAll('button')].map(x => x.textContent.trim()).filter(Boolean).slice(0, 40).join(' | ')); b.click(); return true; })()`);
  const addStepOnHigh = `[...document.querySelectorAll('tr')].find(tr => tr.querySelector('td')?.textContent.trim() === 'HIGH').querySelector('button:not([aria-label])')`;
  await visit('/communications', 1366, 'ESCALATION POLICIES');
  await page!.eval(`[...[...document.querySelectorAll('tr')].find(tr => tr.querySelector('td')?.textContent.trim() === 'HIGH').querySelectorAll('button')].find(b => b.textContent.includes('Add step')).click(), true`);
  await waitFor(async () => page!.eval<boolean>(`!!document.querySelector('input[aria-label="HIGH step 1 minutes"]')`), 'step 1 added');
  await page!.eval(`[...[...document.querySelectorAll('tr')].find(tr => tr.querySelector('td')?.textContent.trim() === 'HIGH').querySelectorAll('button')].find(b => b.textContent.includes('Add step')).click(), true`);
  await waitFor(async () => page!.eval<boolean>(`!!document.querySelector('input[aria-label="HIGH step 2 minutes"]')`), 'step 2 added');
  await setValue('input[aria-label="HIGH step 2 minutes"]', '10');   // earlier than step 1 (15)
  await waitText(x => x.includes('Must come later than step 1 (15 min)'), 'out-of-order step flagged');
  await setValue('input[aria-label="HIGH step 2 minutes"]', '40');
  await setValue('input[aria-label="HIGH step 2 team"]', 'Head of IT');
  await waitText(x => !x.includes('Must come later than step 1'), 'warning cleared');
  const saveIdle = `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Save policies'); return !!b && b.disabled; })()`;
  await click('Save policies');
  await waitFor(async () => page!.eval<boolean>(saveIdle), 'first save finished (button back to idle)');
  await waitFor(async () => {
    const p = ((await api('GET', '/api/v1/escalation-policies')).data as Array<{ severity: string; steps?: Array<{ afterMin: number; label: string }> }>).find(x => x.severity === 'HIGH');
    return JSON.stringify(p?.steps?.map(s => [s.afterMin, s.label])) === JSON.stringify([[15, ''], [40, 'Head of IT']]);
  }, 'steps saved on the server');
  // Remove both steps and save: back to no escalation
  for (const n of [2, 1]) await page!.eval(`document.querySelector('button[aria-label="Remove HIGH step ${n}"]').click(), true`);
  await waitFor(async () => page!.eval<boolean>(`!document.querySelector('input[aria-label="HIGH step 1 minutes"]') && [...document.querySelectorAll('button')].some(x => x.textContent.trim() === 'Save policies' && !x.disabled)`), 'steps removed in the editor, save enabled');
  await click('Save policies');
  await waitFor(async () => {
    const p = ((await api('GET', '/api/v1/escalation-policies')).data as Array<{ severity: string; steps?: unknown[] }>).find(x => x.severity === 'HIGH');
    return !p || !p.steps || p.steps.length === 0;
  }, 'steps removed on the server');
  void addStepOnHigh;

  // Quiet hours: CRITICAL can never be held; WARNING gets a window in an explicit time zone
  await waitFor(async () => page!.eval<boolean>(saveIdle), 'previous save finished (controls enabled again)');
  const critCell = await page!.eval<string>(`[...document.querySelectorAll('tr')].find(tr => tr.querySelector('td')?.textContent.trim() === 'CRITICAL').textContent`);
  assert.ok(critCell.includes('Never held'), 'CRITICAL shows "Never held"');
  await page!.eval(`document.querySelector('input[aria-label="WARNING quiet hours"]').click(), true`);
  await waitFor(async () => page!.eval<boolean>(`!!document.querySelector('input[aria-label="WARNING quiet hours start"]')`), 'quiet-hours fields shown');
  await setValue('input[aria-label="WARNING quiet hours start"]', '21:30');
  await setValue('input[aria-label="WARNING quiet hours end"]', '06:45');
  await setValue('input[aria-label="WARNING quiet hours time zone"]', 'Asia/Kolkata');
  await waitFor(async () => page!.eval<boolean>(`[...document.querySelectorAll('button')].some(x => x.textContent.trim() === 'Save policies' && !x.disabled)`), 'save enabled');
  await click('Save policies');
  await waitFor(async () => {
    const p = ((await api('GET', '/api/v1/escalation-policies')).data as Array<{ severity: string; quietHours?: { enabled: boolean; start: string; end: string; timezone: string } }>).find(x => x.severity === 'WARNING');
    return p?.quietHours?.enabled === true && p.quietHours.start === '21:30' && p.quietHours.end === '06:45' && p.quietHours.timezone === 'Asia/Kolkata';
  }, 'quiet hours saved on the server');
  await waitFor(async () => page!.eval<boolean>(saveIdle), 'save finished');
  await page!.eval(`document.querySelector('input[aria-label="WARNING quiet hours"]').click(), true`);
  await waitFor(async () => page!.eval<boolean>(`[...document.querySelectorAll('button')].some(x => x.textContent.trim() === 'Save policies' && !x.disabled)`), 'save enabled again');
  await click('Save policies');
  await waitFor(async () => {
    const p = ((await api('GET', '/api/v1/escalation-policies')).data as Array<{ severity: string; quietHours?: { enabled: boolean } }>).find(x => x.severity === 'WARNING');
    return !p || p.quietHours?.enabled === false;
  }, 'quiet hours switched off on the server');
});

test('incident links: /incidents?id=… (the link in every notification) opens that incident, and the address keeps the id', { skip: SKIP }, async () => {
  const target = (await api('POST', '/api/v1/incidents', { title: 'Deep link test', severity: 'WARNING', environment: 'PRD' })).data as { id: string };
  await page!.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 1000, deviceScaleFactor: 1, mobile: false });
  await page!.eval(`setTimeout(() => location.assign(${JSON.stringify(`${BASE}/incidents?id=${encodeURIComponent(target.id)}`)}), 0); true`);
  await sleep(400);
  await waitFor(async () => (await bodyText()).includes('Timeline ('), 'incident detail opened');
  assert.ok((await bodyText()).includes(target.id), 'the linked incident is the one shown');
  await sleep(1000);
  assert.equal(await page!.eval<string>('new URLSearchParams(location.search).get("id")'), target.id, 'the id stays in the address');

  // In-app navigation to another incident while one is selected: the address wins (regression)
  const other = (await api('POST', '/api/v1/incidents', { title: 'Deep link test 2', severity: 'WARNING', environment: 'PRD' })).data as { id: string };
  await page!.eval(`history.pushState({}, '', ${JSON.stringify(`/incidents?id=${other.id}`)}); dispatchEvent(new PopStateEvent('popstate')); true`);
  await waitFor(async () => (await page!.eval<string>('new URLSearchParams(location.search).get("id")')) === other.id && (await bodyText()).includes(other.id), 'second incident opened');
  await sleep(800);
  assert.equal(await page!.eval<string>('new URLSearchParams(location.search).get("id")'), other.id, 'not overwritten by the previous selection');
});

test('critical alerts in the browser: opt-in toggle, a new CRITICAL incident notifies once (not old ones), tab title count, click opens Incidents', { skip: SKIP }, async () => {
  // Headless Chrome has no notification UI: a recording stand-in for window.Notification, installed before the app loads
  const { identifier } = await page!.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__notes = [];
    window.Notification = class {
      constructor(title, opts) { window.__notes.push({ title, body: opts && opts.body, tag: opts && opts.tag }); window.__lastNote = this; this.onclick = null; }
      close() {}
      static get permission() { return sessionStorage.getItem('perm') || 'default'; }
      static requestPermission() { sessionStorage.setItem('perm', 'granted'); return Promise.resolve('granted'); }
    };` });
  try {
    await visit('/overview', 1366, 'Dead-Man');
    const toggle = `[...document.querySelectorAll('button[aria-pressed]')].find(b => /ALERTS (ON|OFF)/.test(b.textContent))`;
    assert.equal(await page!.eval<string>(`${toggle}?.getAttribute('aria-pressed')`), 'false', 'off by default');
    await page!.eval(`${toggle}.click(), true`);
    await waitFor(async () => (await page!.eval<string>(`${toggle}.getAttribute('aria-pressed')`)) === 'true', 'toggle on');
    assert.equal(await page!.eval<string>(`localStorage.getItem('scholario.criticalAlerts')`), 'on', 'remembered per browser');

    // A real outage: a PRD monitor whose endpoint answers 503 → the engine opens a CRITICAL incident
    const down = http.createServer((_q, res) => { res.writeHead(503); res.end('down'); });
    await new Promise<void>(r => down.listen(0, '127.0.0.1', () => r()));
    const mon = (await api('POST', '/api/v1/monitors', {
      name: 'Browser alert test', type: 'HTTP', target: `http://127.0.0.1:${(down.address() as { port: number }).port}/health`,
      environment: 'PRD', intervalSec: 3600, failureConfirmationThreshold: 1, retries: 1,
    })).data;
    try {
      await api('POST', `/api/v1/monitors/${mon.id}/probe`, {});
      await waitFor(async () => (await page!.eval<number>('window.__notes.length')) >= 1, 'notification recorded');
    } finally { down.close(); }
    const incId = (await page!.eval<{ tag: string }[]>('window.__notes'))[0].tag;
    const notes = await page!.eval<Array<{ title: string; tag: string }>>('window.__notes');
    assert.equal(notes.length, 1);
    assert.match(notes[0].title, /^CRITICAL: .*Browser alert test/);
    assert.match(incId, /^INC-/);
    assert.match(await page!.eval<string>('document.title'), /^\(\d+\) CRITICAL · /);

    // Acknowledging updates the incident (no second notification) and lowers the title count
    const before = Number(/^\((\d+)\)/.exec(await page!.eval<string>('document.title'))![1]);
    await api('POST', `/api/v1/incidents/${incId}/acknowledge`, {});
    await waitFor(async () => !(await page!.eval<string>('document.title')).startsWith(`(${before})`), 'title count lowered');
    assert.equal(await page!.eval<number>('window.__notes.length'), 1, 'one notification per incident');

    // Clicking the notification opens the Incidents page
    await page!.eval('window.__lastNote.onclick(), true');
    await waitFor(async () => (await page!.eval<string>('location.pathname')) === '/incidents', 'navigated to incidents');

    // After a reload, incidents that are already open are the baseline, not news
    await visit('/overview', 1366, 'Dead-Man');
    await sleep(2000);
    assert.equal(await page!.eval<number>('window.__notes.length'), 0, 'no notification for incidents open before the page loaded');
    await api('DELETE', `/api/v1/monitors/${mon.id}`);
  } finally {
    await page!.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await page!.eval(`localStorage.removeItem('scholario.criticalAlerts'), true`);
  }
});

test('UI polish: dialogs are named, take focus, close on Escape; refresh tooltip; runbook reset confirms; unknown URLs show a not-found page; page names', { skip: SKIP }, async () => {
  const dialog = `(() => {
    const d = document.querySelector('[role=dialog][aria-modal=true]');
    if (!d) return null;
    const id = d.getAttribute('aria-labelledby');
    return { name: (id ? document.getElementById(id)?.textContent : d.getAttribute('aria-label'))?.trim() ?? '', focusInside: d.contains(document.activeElement),
      close: [...d.querySelectorAll('button[aria-label^="Close"]')].map(b => b.getAttribute('aria-label')) };
  })()`;
  const esc = () => page!.eval(`(document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`);
  const clickText = (text: string) => page!.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) throw new Error('no button ' + ${JSON.stringify(text)}); b.click(); return true; })()`);
  const checkDialog = async (what: string, open: () => Promise<unknown>, name: RegExp, closeLabel: string) => {
    await open();
    await waitFor(async () => Boolean(await page!.eval(dialog)), `${what}: dialog opened`);
    const d = (await page!.eval<{ name: string; focusInside: boolean; close: string[] }>(dialog))!;
    assert.match(d.name, name, `${what}: accessible name`);
    assert.ok(d.focusInside, `${what}: focus moved into the dialog`);
    assert.ok(d.close.includes(closeLabel), `${what}: labelled close button (${d.close.join(', ')})`);
    await shot(`dialog-${what.replace(/\W+/g, '-')}`);
    await esc();
    await waitFor(async () => !(await page!.eval(dialog)), `${what}: Escape closes it`);
  };

  // 1. Dialogs
  const inc = (await api('POST', '/api/v1/incidents', { title: 'Dialog test incident', severity: 'WARNING', environment: 'PRD' })).data as { id: string };
  await visit('/incidents', 1366, 'Declare incident');
  await checkDialog('incident detail', () => page!.eval(`history.pushState({}, '', ${JSON.stringify(`/incidents?id=${inc.id}`)}); dispatchEvent(new PopStateEvent('popstate')); true`), /Dialog test incident/, 'Close incident details');
  await checkDialog('declare incident', () => clickText('Declare incident'), /DECLARE INCIDENT/, 'Close declare incident');
  await visit('/applications', 1366, 'Learning Management Platform');
  await checkDialog('application detail', () => page!.eval(`document.querySelector('h3[title^="Learning Management Platform"]').closest('.cursor-pointer').click(), true`), /Learning Management Platform/, 'Close application details');
  await visit('/infrastructure', 1366, 'VPS INFRASTRUCTURE');
  await checkDialog('server detail', () => page!.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Inspect').click(), true`), /^Server /, 'Close server details');
  await visit('/monitors', 1366, 'CREATE MONITOR');
  await checkDialog('create monitor', () => clickText('CREATE MONITOR'), /CREATE MONITOR/, 'Close create monitor');

  // 2. The top-bar refresh button says what it does (it does not run the monitor checks)
  const refresh = await page!.eval<{ title: string; label: string } | null>(`(() => { const b = document.querySelector('header button[aria-label^="Reload dashboard data"]'); return b && { title: b.title, label: b.getAttribute('aria-label') }; })()`);
  assert.ok(refresh, 'refresh button labelled');
  assert.match(refresh!.title, /does not run monitor checks/);
  assert.doesNotMatch(refresh!.title, /probe all monitors/i);

  // 3. Runbook reset asks first; Cancel keeps the progress, Reset clears it
  const rb = (await api('POST', '/api/v1/runbooks', { title: 'Reset confirm runbook', description: '', category: 'DATABASE', estimatedDurationMin: 10, steps: [{ title: 'First step' }, { title: 'Second step' }] })).data as { id: string };
  await api('POST', `/api/v1/runbooks/${rb.id}/steps/1/toggle`, {});
  const done = async () => ((await api('GET', '/api/v1/runbooks')).data as Array<{ id: string; steps: Array<{ completed: boolean }> }>).find(r => r.id === rb.id)!.steps.filter(s => s.completed).length;
  assert.equal(await done(), 1);
  await visit('/runbooks', 1366, 'Reset confirm runbook');
  await page!.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Reset confirm runbook')).click(), true`);
  await waitText(t => t.includes('1 / 2 steps') && t.includes('Reset progress'), 'runbook selected');
  await clickText('Reset progress');
  await waitText(t => t.includes('Clear 1 completed step(s)?'), 'reset asks for confirmation');
  await shot('runbook-reset-confirm');
  assert.equal(await done(), 1, 'nothing reset before confirming');
  await clickText('Cancel');
  await waitText(t => !t.includes('Clear 1 completed step(s)?'), 'cancel closes the question');
  assert.equal(await done(), 1, 'Cancel keeps the progress');
  await clickText('Reset progress');
  await waitText(t => t.includes('Clear 1 completed step(s)?'), 'asked again');
  await clickText('Reset');
  await waitFor(async () => (await done()) === 0, 'Reset clears the progress');
  await api('DELETE', `/api/v1/runbooks/${rb.id}`);

  // 4. Unknown URL: a not-found page inside the app (sidebar kept, address kept), with a way back
  await visit('/no-such-page', 1366, 'Page not found');
  assert.equal(await page!.eval<string>('location.pathname'), '/no-such-page', 'not redirected');
  const nf = await bodyText();
  assert.ok(nf.includes('There is no page at /no-such-page'), 'names the missing address');
  assert.ok(await page!.eval<boolean>(`!!document.querySelector('aside')`), 'sidebar still available');
  await shot('not-found-1366');
  await clickText('Go to Overview');
  await waitFor(async () => (await page!.eval<string>('location.pathname')) === '/overview', 'back to Overview');

  // 5. One name per page: sidebar, page title and command palette agree
  const nav = await page!.eval<string>(`document.querySelector('aside').innerText`);
  for (const s of ['Notifications', 'PRD / DR Readiness', 'Alerting']) assert.ok(nav.toLowerCase().includes(s.toLowerCase()), `sidebar has ${s}`);
  assert.ok(!/Communications/i.test(nav), 'no "Communications" in the sidebar');
  await visit('/communications', 1366, 'NOTIFICATIONS & ESCALATION');
  assert.ok(!(await bodyText()).includes('COMMUNICATIONS & ESCALATION'));
  await visit('/resilience', 1366, 'PRD / DR READINESS');
  assert.ok(!(await bodyText()).includes('DISASTER RECOVERY & TRAFFIC FAILOVER'));
});

test('Setup: dependency register — add entries, record and edit a dependency, see who is affected, delete with confirmation', { skip: SKIP }, async () => {
  const SECTION = 'section[aria-labelledby="dependency-register-title"]';
  const clickText = (text: string, within = SECTION) => page!.eval(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(within)} + ' button')].find(x => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) throw new Error('no button ' + ${JSON.stringify(text)}); b.click(); return true; })()`);
  const clickLabel = (label: string) => page!.eval(`(() => { const b = document.querySelector(${JSON.stringify(`${SECTION} button[aria-label="${label}"]`)}); if (!b) throw new Error('no button ' + ${JSON.stringify(label)}); b.click(); return true; })()`);
  // Sets a field of the open editor form the way typing / choosing does (React listens for input/change events)
  const fill = (form: string, field: string, value: string) => page!.eval(`(() => {
    const f = document.querySelector(${JSON.stringify(`form[aria-label="${form}"]`)});
    const l = f && [...f.querySelectorAll('label')].find(x => x.querySelector('span')?.textContent.trim() === ${JSON.stringify(field)});
    const el = l && l.querySelector('input, select');
    if (!el) throw new Error('no field ' + ${JSON.stringify(field)});
    if (el.tagName === 'SELECT') {
      const opt = [...el.options].find(o => o.value === ${JSON.stringify(value)} || o.textContent.startsWith(${JSON.stringify(value)}));
      if (!opt) throw new Error('no option ' + ${JSON.stringify(value)});
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, opt.value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  })()`);
  const submit = (form: string) => page!.eval(`(document.querySelector(${JSON.stringify(`form[aria-label="${form}"]`)}).requestSubmit(), true)`);
  const registry = async () => (await api('GET', '/api/v1/registry')).data as { components: Array<{ id: string; name: string; kind: string; owner: string; tier: string; userCount: number | null; served: string[] }>; links: Array<{ id: string; type: string; fromId: string; toId: string; featureId: string | null }> };
  const sectionText = () => page!.eval<string>(`document.querySelector(${JSON.stringify(SECTION)})?.innerText ?? ''`);
  const showSection = () => page!.eval(`(document.querySelector(${JSON.stringify(SECTION)}).scrollIntoView({ block: 'start' }), true)`).then(() => sleep(200));

  await visit('/setup', 1366, 'DEPENDENCY REGISTER');
  // 1. Add an application with users and teams served, then a database
  await clickText('Add entry');
  await waitFor(async () => Boolean(await page!.eval(`!!document.querySelector('form[aria-label="New register entry"]')`)), 'entry editor opened');
  await fill('New register entry', 'Kind', 'APPLICATION');
  await fill('New register entry', 'Name', 'Reg UI Portal');
  await fill('New register entry', 'Owner', 'Student Services');
  await fill('New register entry', 'Tier', 'TIER_1');
  await fill('New register entry', 'Users', '2400');
  await fill('New register entry', 'Teams or customers served', 'Students, Parents');
  await showSection();
  await shot('register-new-entry-1366');
  await submit('New register entry');
  await waitFor(async () => (await registry()).components.some(c => c.name === 'Reg UI Portal'), 'application saved');
  const portal = (await registry()).components.find(c => c.name === 'Reg UI Portal')!;
  assert.equal(portal.kind, 'APPLICATION');
  assert.equal(portal.owner, 'Student Services');
  assert.equal(portal.userCount, 2400);
  assert.deepEqual(portal.served, ['Students', 'Parents']);

  await waitFor(async () => !(await page!.eval<boolean>(`!!document.querySelector('form[aria-label="New register entry"]')`)), 'editor closed after saving');
  await clickText('Add entry');
  await waitFor(async () => Boolean(await page!.eval(`!!document.querySelector('form[aria-label="New register entry"]')`)), 'entry editor opened again');
  await fill('New register entry', 'Kind', 'DATABASE');
  const dbFields = await page!.eval<string>(`document.querySelector('form[aria-label="New register entry"]').innerText`);
  assert.ok(!dbFields.includes('Users') && !dbFields.includes('Teams or customers served'), 'a database has no user count or audience fields');
  await fill('New register entry', 'Name', 'Reg UI Database');
  await fill('New register entry', 'Owner', 'DBA team');
  await fill('New register entry', 'Tier', 'TIER_1');
  await submit('New register entry');
  await waitFor(async () => (await registry()).components.some(c => c.name === 'Reg UI Database'), 'database saved');
  const dbc = (await registry()).components.find(c => c.name === 'Reg UI Database')!;
  await waitText(t => t.includes('Reg UI Portal') && t.includes('Reg UI Database') && t.includes('Student Services') && t.includes('2,400'), 'both rows shown');

  // 2. Record "Portal depends on Database" (soft), then edit it to hard
  await clickText('Add dependency');
  await waitFor(async () => Boolean(await page!.eval(`!!document.querySelector('form[aria-label="New dependency"]')`)), 'dependency editor opened');
  await fill('New dependency', 'A (depends on B)', portal.id);
  await fill('New dependency', 'B (needed by A)', dbc.id);
  await fill('New dependency', 'Type', 'SOFT');
  await fill('New dependency', 'Notes', 'Read-only mode without the database');
  await submit('New dependency');
  await waitFor(async () => (await registry()).links.some(l => l.fromId === portal.id && l.toId === dbc.id && l.type === 'SOFT'), 'soft link saved');
  await waitFor(async () => /Reg UI Portal depends on Reg UI Database\s*SOFT/.test(await sectionText()), 'link listed as SOFT');
  await clickLabel('Edit dependency Reg UI Portal on Reg UI Database');
  await waitFor(async () => Boolean(await page!.eval(`!!document.querySelector('form[aria-label="Edit dependency"]')`)), 'link editor opened');
  await fill('Edit dependency', 'Type', 'HARD');
  await submit('Edit dependency');
  await waitFor(async () => (await registry()).links.some(l => l.fromId === portal.id && l.toId === dbc.id && l.type === 'HARD'), 'edited to HARD');
  await waitFor(async () => /Reg UI Portal depends on Reg UI Database\s*HARD/.test(await sectionText()), 'link listed as HARD');

  // 3. Impact of the database: the portal stops, with its users and teams
  await clickLabel('Impact of Reg UI Database');
  await waitFor(async () => /IF REG UI DATABASE FAILS[\s\S]*Users who lose service: at least 2,400\.[\s\S]*not a total[\s\S]*Students, Parents[\s\S]*Stops working \(1\)[\s\S]*Reg UI Portal/.test(await sectionText()), 'impact shown');
  assert.doesNotMatch(await sectionText(), /up to|degraded only/i, 'counts are lower bounds, not a maximum');
  await showSection();
  await shot('register-impact-1366');
  for (const w of [1366, 1024]) {
    await page!.send('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    await showSection();
    const r = await page!.eval<{ problems: string[]; error?: string }>(CHECK(SECTION));
    assert.ok(!r.error, r.error);
    assert.deepEqual(r.problems, [], `register layout at ${w}px`);
    await shot(`register-${w}`);
  }
  await clickLabel('Close impact');

  // 4. Delete asks first; Cancel keeps it; Delete removes the entry and its link
  await clickLabel('Delete Reg UI Database');
  await waitFor(async () => (await sectionText()).includes('Delete with 1 link(s)?'), 'delete asks');
  assert.ok((await registry()).components.some(c => c.id === dbc.id), 'nothing deleted before confirming');
  await clickText('Cancel');
  await waitFor(async () => !(await sectionText()).includes('Delete with 1 link(s)?'), 'cancel closes the question');
  await clickLabel('Delete Reg UI Database');
  await waitFor(async () => (await sectionText()).includes('Delete with 1 link(s)?'), 'asked again');
  await clickText('Delete');
  await waitFor(async () => { const r = await registry(); return !r.components.some(c => c.id === dbc.id) && !r.links.some(l => l.toId === dbc.id); }, 'entry and link deleted');
  await waitFor(async () => !(await sectionText()).includes('Reg UI Database'), 'row gone');
  await api('DELETE', `/api/v1/registry/${portal.id}`);
});

if (SKIP) test(`responsive browser checks skipped: ${SKIP}`, { skip: SKIP }, () => {});

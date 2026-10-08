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
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find(p => p && fs.existsSync(p));
const BUILT = fs.existsSync(path.join('dist', 'index.html'));
const SKIP = !CHROME ? 'no Chrome / Chromium / Edge found (set CHROME_PATH)' : !BUILT ? 'frontend not built (run npm run build)' : !process.env.DATABASE_URL ? 'DATABASE_URL not set' : false;

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
let token = '';
let login: { tokens: { accessToken: string; refreshToken: string }; user: unknown } | null = null;

// ── Minimal DevTools protocol client ─────────────────────────────────────────
class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(String(ev.data));
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

before(async () => {
  if (SKIP) return;
  // Deprecated external watchdog URL is set on purpose: it must be ignored (no request ever reaches it)
  watchdog = http.createServer((_q, r) => { watchdogHits++; r.end('OK'); });
  await new Promise<void>(r => watchdog!.listen(0, '127.0.0.1', () => r()));
  server = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password,
      JWT_SECRET: 'r'.repeat(40), PUBLIC_URL: 'https://ops.test.invalid', CLOUDFLARE_API_TOKEN: '', HOSTINGER_API_TOKEN: '', LOG_FORMAT: 'json',
      DEADMAN_HEARTBEAT_URL: `http://127.0.0.1:${(watchdog.address() as { port: number }).port}/ping/secret-uuid`, DEADMAN_INTERVAL_SEC: '10' },
    stdio: ['ignore', 'ignore', 'ignore'],
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
  const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  const tokens = Object.fromEntries((await pgc.query(`select id, agent_token from ${SCHEMA}.servers`)).rows.map(r => [r.id, r.agent_token]));
  await pgc.end();
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
  if (!SKIP) {
    const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await pgc.connect().then(() => pgc.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)).catch(() => {}).finally(() => pgc.end().catch(() => {}));
  }
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

test('dead-man heartbeat stream shows the monitored PRD / DR infrastructure from agent reports; no external watchdog', { skip: SKIP }, async () => {
  await visit('/monitors', 1366, 'Dead-Man Watchdog Heartbeat Stream');
  const text = await page!.eval<string>('document.body.innerText');
  for (const t of ['PRD VPS', 'DR VPS', 'Server heartbeat', 'Application checks', 'Services', 'Database', 'UI stream: 1 Hz refresh (animation only)']) assert.ok(text.includes(t), t);
  assert.match(text, /HEARTBEAT FAILING|DEGRADED/, 'seeded failed service / failing app check');
  await visit('/overview', 1366, 'Dead-Man');
  const overview = await page!.eval<string>('document.body.innerText');
  assert.ok(overview.includes("PRD VPS + DR VPS"), "dead-man card names the monitored servers");
  const html = await page!.eval<string>('document.documentElement.outerHTML');
  assert.equal(html.includes('secret-uuid'), false, 'old watchdog URL in the DOM');
  assert.equal(watchdogHits, 0, 'no request to the deprecated external watchdog');
});

if (SKIP) test(`responsive browser checks skipped: ${SKIP}`, { skip: SKIP }, () => {});

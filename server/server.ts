/**
 * Scholario Ops — control-plane server.
 *
 * Serves the REST API (/api), the realtime SSE stream and the React SPA.
 * All data is real: monitors probe your endpoints, the telemetry agent reports
 * from your VPS nodes, and Cloudflare / Hostinger are read through their APIs.
 * PostgreSQL (DATABASE_URL, schema DB_SCHEMA) is the single source of truth.
 *
 * Startup order: listen immediately (liveness) → wait for PostgreSQL with retries →
 * migrate + load → start monitoring. Until the database is ready the API answers 503
 * and /api/health/ready reports "starting", so a slow or restarting database never
 * makes the process crash-loop.
 */
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, isCloudflareConfigured, isHostingerConfigured, DATA_DIR } from './config.ts';
import { initStore, flush, flushMetrics } from './store.ts';
import { closePool, query, SCHEMA } from './db.ts';
import { startHistory, flushChecks } from './history.ts';
import { bootstrapAdmin } from './auth.ts';
import { buildRouter } from './routes.ts';
import { startEngine } from './engine.ts';
import { syncCloudflare } from './cloudflare.ts';
import { syncHostinger } from './hostinger.ts';
import { syncLoadBalancers } from './loadbalancer.ts';
import { closeAllSseClients } from './events.ts';
import { log } from './logger.ts';
import { evaluateAlerts } from './alerts.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const startedAt = Date.now();

let storeReady = false;
let shuttingDown = false;
let lastStartupError: string | null = null;

/**
 * Production configuration check. Problems that make the deployment unsafe or broken stop
 * the start; weaker settings print a warning. Secrets are never printed.
 */
function checkProductionConfig() {
  if (isDev) return;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!config.databaseUrl) errors.push('DATABASE_URL is not set');
  if (!config.publicUrl) warnings.push('PUBLIC_URL is not set — agent install commands and notification links will use the request host');
  else if (!config.publicUrl.startsWith('https://')) warnings.push(`PUBLIC_URL (${config.publicUrl}) is not https:// — agents would send telemetry unencrypted`);
  if ((process.env.JWT_SECRET ?? '').trim().length < 32) warnings.push('JWT_SECRET is not set (or < 32 chars) — using a generated secret stored in DATA_DIR; set one in .env so sessions survive a DATA_DIR loss');
  if (config.host === '0.0.0.0' || config.host === '::') warnings.push(`HOST=${config.host} exposes Node directly — behind nginx use HOST=127.0.0.1`);
  if (!process.env.CLOUDFLARE_API_TOKEN) warnings.push('CLOUDFLARE_API_TOKEN is not set — Cloudflare pages will show "Not configured"');
  if (!config.deadManHeartbeatUrl) warnings.push('DEADMAN_HEARTBEAT_URL is not set — nobody is alerted if this Ops server itself goes down');
  for (const w of warnings) log.warn('config', w);
  if (errors.length) {
    for (const e of errors) log.error('config', e);
    process.exit(1);
  }
}

/** Runs a periodic task; an exception in one run is logged and never stops the schedule or the process. */
function every(component: string, ms: number, task: () => unknown) {
  setInterval(() => {
    try {
      const r = task();
      if (r instanceof Promise) r.catch(err => log.error(component, 'scheduled task failed', { error: err as Error }));
    } catch (err) {
      log.error(component, 'scheduled task failed', { error: err as Error });
    }
  }, ms).unref();
}

// ── Simple per-IP rate limit for the API (agents/heartbeats authenticate with their own tokens) ──
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = config.apiRateLimitPerMin;
const hits = new Map<string, { n: number; reset: number }>();
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 60_000).unref();
function rateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.path.startsWith('/v1/agent/') || req.path.startsWith('/v1/heartbeat/') || req.path.startsWith('/health')) return next();
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const e = hits.get(key);
  if (!e || e.reset < now) { hits.set(key, { n: 1, reset: now + RATE_WINDOW_MS }); return next(); }
  if (++e.n > RATE_MAX) {
    res.setHeader('Retry-After', String(Math.ceil((e.reset - now) / 1000)));
    res.status(429).json({ success: false, message: 'Too many requests — slow down and try again in a minute' });
    return;
  }
  next();
}

async function waitForStore() {
  let delay = 2000;
  for (let attempt = 1; !shuttingDown; attempt++) {
    try {
      const { migrations, imported } = await initStore();
      if (migrations.length) log.info('db', `applied migrations: ${migrations.join(', ')}`);
      if (imported) log.info('db', `imported previous JSON data into PostgreSQL: ${imported}`);
      lastStartupError = null;
      return;
    } catch (err) {
      lastStartupError = (err as Error).message;
      log.error('db', `PostgreSQL not ready (attempt ${attempt}) — retrying in ${Math.round(delay / 1000)}s`, { error: err as Error });
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(30_000, delay * 2);
    }
  }
}

function startBackgroundWork() {
  startHistory();
  bootstrapAdmin();
  startEngine();
  // Cloudflare Load Balancer pools + pool health (read-only). Runs even without a token so the
  // dashboard shows "Not configured" instead of nothing.
  void syncLoadBalancers().catch(err => log.error('loadbalancer', 'initial sync failed', { error: err as Error }));
  every('loadbalancer', config.cloudflareLbSyncIntervalSec * 1000, () => syncLoadBalancers().catch(() => {}));
  if (isCloudflareConfigured()) {
    void syncCloudflare().catch(() => {});
    every('cloudflare', config.cloudflareSyncIntervalSec * 1000, () => syncCloudflare().catch(() => {}));
  }
  if (isHostingerConfigured()) {
    void syncHostinger().catch(() => {});
    every('hostinger', config.hostingerSyncIntervalSec * 1000, () => syncHostinger().catch(() => {}));
  }
  // Alerts derived from state (agent offline, DB down, replication, backups, DR readiness, SSL expiry)
  every('alerts', 60_000, evaluateAlerts);
}

async function main() {
  checkProductionConfig();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!isDev) {
      res.setHeader('X-Frame-Options', 'DENY');
      // Everything the dashboard loads comes from this origin (plus Google Fonts for the typefaces)
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join('; '));
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    }
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    }
    next();
  });

  // Request log: errors, slow requests and changes (query strings are never logged — they can carry tickets)
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const isApi = req.path.startsWith('/api/');
      if (!isApi || req.path === '/api/v1/realtime/stream') return;
      const fields = { method: req.method, path: req.path, status: res.statusCode, ms, ip: req.ip, user: req.user?.email };
      if (res.statusCode >= 500) log.error('http', 'request failed', fields);
      else if (res.statusCode >= 400 && res.statusCode !== 401) log.warn('http', 'request rejected', fields);
      else if (ms > 3000) log.warn('http', 'slow request', fields);
      else if (req.method !== 'GET') log.info('http', 'request', fields);
    });
    next();
  });

  // ── Health: liveness (process up) and readiness (database usable) — before everything else ──
  app.get(['/api/health/live', '/health/live'], (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'alive', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), timestamp: new Date().toISOString() });
  });
  app.get(['/api/health/ready', '/health/ready'], async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const checks: Record<string, string> = { store: storeReady ? 'loaded' : 'starting' };
    let ok = storeReady && !shuttingDown;
    try {
      const t0 = Date.now();
      await Promise.race([query('SELECT 1'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after 3s')), 3000))]);
      checks.database = `ok (${Date.now() - t0}ms)`;
    } catch (err) {
      ok = false;
      checks.database = `unavailable: ${(err as Error).message}`;
    }
    if (shuttingDown) checks.process = 'shutting down';
    res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'not_ready', checks, ...(lastStartupError && !storeReady ? { startupError: lastStartupError } : {}), timestamp: new Date().toISOString() });
  });

  // Until PostgreSQL is loaded the API cannot answer correctly
  app.use('/api', (_req, res, next) => {
    if (storeReady) return next();
    res.setHeader('Retry-After', '5');
    res.status(503).json({ success: false, message: 'Scholario Ops is starting — waiting for the database' });
  });

  app.use('/api', rateLimit);
  app.use(express.json({ limit: '1mb' }));
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const type = (err as { type?: string }).type;
    if (type === 'entity.parse.failed') { res.status(400).json({ success: false, message: 'Request body is not valid JSON' }); return; }
    if (type === 'entity.too.large') { res.status(413).json({ success: false, message: 'Request body is too large' }); return; }
    next(err);
  });

  const api = buildRouter();
  app.use('/api', api);
  // Plain /health (detailed status) for uptime checkers
  app.get('/health', (req, res, next) => {
    if (!storeReady) { res.status(503).json({ status: 'starting' }); return; }
    req.url = '/health'; api(req, res, next);
  });

  if (isDev) {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const dist = path.resolve(__dirname, fs.existsSync(path.join(__dirname, 'dist', 'index.html')) ? 'dist' : '../dist');
    if (!fs.existsSync(path.join(dist, 'index.html'))) {
      log.warn('server', `${dist}/index.html not found — run "npm run build" (API still works)`);
    }
    // Vite emits content-hashed files under /assets: cache them for a year; everything else briefly
    app.use('/assets', express.static(path.join(dist, 'assets'), { index: false, maxAge: '365d', immutable: true }));
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  // Last-resort error handler: never leak stack traces
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error('http', 'unhandled error', { path: req.path, error: err as Error });
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Internal server error' });
  });

  const server = http.createServer(app);
  server.keepAliveTimeout = 65_000; // longer than nginx's upstream keepalive
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.error('server', `Port ${config.port} is already in use — Scholario Ops is probably already running. Open http://localhost:${config.port}, or stop the other copy (Ctrl+C in its terminal). To run a second copy on purpose set another PORT, e.g.  $env:PORT=3001; npm run dev`);
    } else {
      log.error('server', `Could not start: ${err.message}`);
    }
    void closePool().finally(() => process.exit(1));
  });

  await new Promise<void>(resolve => server.listen(config.port, config.host, resolve));
  log.info('server', 'Scholario Ops listening', {
    url: `http://${config.host}:${config.port}`, mode: isDev ? 'development' : 'production', publicUrl: config.publicUrl || null,
    database: `PostgreSQL schema "${SCHEMA}"`, dataDir: DATA_DIR, cloudflare: isCloudflareConfigured() ? 'configured' : 'not configured',
    hostinger: isHostingerConfigured() ? 'configured' : 'not configured',
  });
  if (typeof process.send === 'function') process.send('ready'); // PM2 wait_ready

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('server', `${signal} received — finishing requests, saving data, closing connections`);
    closeAllSseClients();
    server.close();
    server.closeIdleConnections?.();
    void Promise.allSettled([flush(), flushMetrics(), flushChecks()])
      .then(() => closePool())
      .then(() => log.info('server', 'shutdown complete'))
      .finally(() => process.exit(0));
    setTimeout(() => { log.warn('server', 'shutdown timed out — exiting'); process.exit(0); }, 8000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // PM2 sends a "shutdown" message instead of a signal when shutdown_with_message is set (needed on Windows)
  process.on('message', msg => { if (msg === 'shutdown') shutdown('PM2 shutdown message'); });

  await waitForStore();
  if (shuttingDown) return;
  storeReady = true;
  startBackgroundWork();
  log.info('server', 'ready — database loaded, monitoring started');
}

// A bug in one async path must not take monitoring down silently
process.on('unhandledRejection', reason => {
  log.error('process', 'unhandled promise rejection', { error: reason instanceof Error ? reason : new Error(String(reason)) });
});
process.on('uncaughtException', err => {
  // State may be inconsistent: log, try to save, and exit so PM2 restarts a clean process
  log.error('process', 'uncaught exception — exiting for a clean restart', { error: err });
  void flush().finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 3000).unref();
});

main().catch(err => {
  log.error('server', 'fatal error starting Scholario Ops', { error: err as Error });
  process.exit(1);
});

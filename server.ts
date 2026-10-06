/**
 * Scholario Ops — control-plane server.
 *
 * Serves the REST API (/api), the realtime SSE stream and the React SPA.
 * All data is real: monitors probe your endpoints, the telemetry agent reports
 * from your VPS nodes, and Cloudflare / Hostinger are read through their APIs.
 * State is persisted to DATA_DIR (default ./data).
 */
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, isCloudflareConfigured, isHostingerConfigured, DATA_DIR } from './backend/config.ts';
import { flush, flushMetrics } from './backend/store.ts';
import { bootstrapAdmin } from './backend/auth.ts';
import { buildRouter } from './backend/routes.ts';
import { startEngine } from './backend/engine.ts';
import { syncCloudflare } from './backend/cloudflare.ts';
import { syncHostinger } from './backend/hostinger.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

async function main() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!isDev) res.setHeader('X-Frame-Options', 'DENY');
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

  app.use(express.json({ limit: '1mb' }));
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const type = (err as { type?: string }).type;
    if (type === 'entity.parse.failed') { res.status(400).json({ success: false, message: 'Request body is not valid JSON' }); return; }
    if (type === 'entity.too.large') { res.status(413).json({ success: false, message: 'Request body is too large' }); return; }
    next(err);
  });

  const api = buildRouter();
  app.use('/api', api);
  // Plain /health for load balancers and uptime checkers
  app.get('/health', (req, res, next) => { req.url = '/health'; api(req, res, next); });

  if (isDev) {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const dist = path.resolve(__dirname, fs.existsSync(path.join(__dirname, 'dist', 'index.html')) ? 'dist' : '../dist');
    if (!fs.existsSync(path.join(dist, 'index.html'))) {
      console.warn(`[server] ${dist}/index.html not found — run "npm run build" (API still works)`);
    }
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  bootstrapAdmin();
  startEngine();

  if (isCloudflareConfigured()) {
    void syncCloudflare().catch(() => {});
    setInterval(() => { void syncCloudflare().catch(() => {}); }, config.cloudflareSyncIntervalSec * 1000).unref();
  }
  if (isHostingerConfigured()) {
    void syncHostinger().catch(() => {});
    setInterval(() => { void syncHostinger().catch(() => {}); }, config.hostingerSyncIntervalSec * 1000).unref();
  }

  const server = http.createServer(app);
  server.listen(config.port, config.host, () => {
    console.log('\n============================================================');
    console.log(' SCHOLARIO OPS CONTROL CENTER');
    console.log(` URL:        http://${config.host}:${config.port}${isDev ? '  (development)' : ''}`);
    console.log(` Public URL: ${config.publicUrl || '(not set — set PUBLIC_URL for agent install links)'}`);
    console.log(` Data dir:   ${DATA_DIR}`);
    console.log(` Cloudflare: ${isCloudflareConfigured() ? 'configured' : 'not configured'}`);
    console.log(` Hostinger:  ${isHostingerConfigured() ? 'configured' : 'not configured'}`);
    console.log('============================================================\n');
    if (typeof process.send === 'function') process.send('ready'); // PM2 wait_ready
  });

  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} received — saving data and shutting down`);
    flush();
    flushMetrics();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('Fatal error starting Scholario Ops:', err);
  process.exit(1);
});

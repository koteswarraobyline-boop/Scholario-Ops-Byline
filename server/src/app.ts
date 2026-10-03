import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';

import { config } from './config';
import { logger } from './utils/logger';
import { requestId } from './middleware/requestId';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

// Route modules
import authRoutes from './modules/auth/auth.routes';
import usersRoutes from './modules/users/users.routes';
import applicationsRoutes from './modules/applications/applications.routes';
import serversRoutes from './modules/servers/servers.routes';
import monitorsRoutes from './modules/monitors/monitors.routes';
import incidentsRoutes from './modules/incidents/incidents.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import drRoutes from './modules/dr/dr.routes';
import backupsRoutes from './modules/backups/backups.routes';
import deploymentsRoutes from './modules/deployments/deployments.routes';
import runbooksRoutes from './modules/runbooks/runbooks.routes';
import maintenanceRoutes from './modules/maintenance/maintenance.routes';
import cloudflareRoutes from './modules/cloudflare/cloudflare.routes';
import hostingerRoutes from './modules/hostinger/hostinger.routes';
import reportsRoutes from './modules/reports/reports.routes';
import auditRoutes from './modules/audit/audit.routes';

// Telemetry / Dead-man ingest
import { Router, Request, Response, NextFunction } from 'express';
import { ServersService } from './modules/servers/servers.service';
import { recordHeartbeat } from './workers/deadManWorker';
import { authenticate } from './middleware/authenticate';
import { broadcast } from './realtime/websocket';
import { ok } from './utils/response';

export function createApp(): Application {
  const app = express();

  // ── Security headers ──────────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: false, // handled by Cloudflare / nginx
    crossOriginEmbedderPolicy: false,
  }));

  // ── CORS ──────────────────────────────────────────────────────────────────
  app.use(cors({
    origin: config.cors.origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  }));

  // ── Compression ───────────────────────────────────────────────────────────
  app.use(compression());

  // ── Request ID ────────────────────────────────────────────────────────────
  app.use(requestId);

  // ── Structured request logging ────────────────────────────────────────────
  if (!config.isTest()) {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
  }

  // ── Body parsing ──────────────────────────────────────────────────────────
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // ── Global rate limit ─────────────────────────────────────────────────────
  app.use('/api/', rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
  }));

  // ── Health check (no auth required) ───────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'scholario-ops-api',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '1.0.0',
    });
  });

  // ── Telemetry endpoints (agent → backend, uses API key auth from header) ──
  const telemetryRouter = Router();

  // Agent heartbeat/metrics ingest
  telemetryRouter.post('/metrics', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await ServersService.ingestTelemetry(req.body);
      // Broadcast realtime update
      broadcast('server.health.changed', {
        serverId: req.body.serverId,
        cpuPercent: req.body.cpuPercent,
        ramPercent: req.body.ramPercent,
        diskPercent: req.body.diskPercent,
      });
      ok(res, { received: true });
    } catch (err) { next(err); }
  });

  // Dead-man watchdog heartbeat
  telemetryRouter.post('/heartbeat', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { target } = req.body as { target: string };
      await recordHeartbeat(target);
      ok(res, { received: true, timestamp: new Date().toISOString() });
    } catch (err) { next(err); }
  });

  app.use('/api/telemetry', telemetryRouter);

  // ── API routes ────────────────────────────────────────────────────────────
  app.use('/api/auth',         authRoutes);
  app.use('/api/users',        usersRoutes);
  app.use('/api/applications', applicationsRoutes);
  app.use('/api/servers',      serversRoutes);
  app.use('/api/monitors',     monitorsRoutes);
  app.use('/api/incidents',    incidentsRoutes);
  app.use('/api/notifications',notificationsRoutes);
  app.use('/api/dr',           drRoutes);
  app.use('/api/backups',      backupsRoutes);
  app.use('/api/deployments',  deploymentsRoutes);
  app.use('/api/runbooks',     runbooksRoutes);
  app.use('/api/maintenance',  maintenanceRoutes);
  app.use('/api/cloudflare',   cloudflareRoutes);
  app.use('/api/hostinger',    hostingerRoutes);
  app.use('/api/reports',      reportsRoutes);
  app.use('/api/audit',        auditRoutes);

  // ── WebSocket status (info endpoint) ──────────────────────────────────────
  app.get('/api/realtime/status', authenticate, (_req, res) => {
    const { getConnectedCount } = require('./realtime/websocket');
    ok(res, { connected: getConnectedCount(), timestamp: new Date().toISOString() });
  });

  // ── 404 + Error handler ───────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

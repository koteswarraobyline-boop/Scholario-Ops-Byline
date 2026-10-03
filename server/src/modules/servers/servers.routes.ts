import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { ServersService } from './servers.service';
import { AuditService } from '../audit/audit.service';
import { ok, created, noContent, paginated } from '../../utils/response';

const router = Router();

const telemetrySchema = z.object({
  serverId: z.string().uuid(),
  agentVersion: z.string().optional(),
  cpuPercent: z.number().min(0).max(100),
  ramPercent: z.number().min(0).max(100),
  diskPercent: z.number().min(0).max(100),
  loadAvg1m: z.number().min(0),
  loadAvg5m: z.number().min(0),
  loadAvg15m: z.number().min(0),
  networkInKbps: z.number().min(0),
  networkOutKbps: z.number().min(0),
  observedAt: z.string(),
  services: z.array(z.object({
    name: z.string(),
    status: z.string(),
    version: z.string().optional(),
    pid: z.number().optional(),
    memoryMb: z.number().optional(),
    cpuPercent: z.number().optional(),
    lastRestart: z.string().optional(),
  })).optional(),
  processes: z.array(z.object({
    pid: z.number(),
    name: z.string(),
    user: z.string().optional(),
    cpuPercent: z.number().optional(),
    memMb: z.number().optional(),
    status: z.string().optional(),
  })).optional(),
  logs: z.array(z.object({
    level: z.string(),
    service: z.string().optional(),
    message: z.string(),
    loggedAt: z.string().optional(),
  })).optional(),
});

// GET /api/servers
router.get('/', authenticate, requirePermission('read', 'servers'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await ServersService.list({
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 50),
      applicationId: req.query.applicationId as string,
      environment: req.query.environment as string,
      region: req.query.region as string,
      status: req.query.status as string,
    });
    paginated(res, result);
  } catch (err) { next(err); }
});

// GET /api/servers/:id
router.get('/:id', authenticate, requirePermission('read', 'servers'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const server = await ServersService.getById(req.params.id);
    ok(res, server);
  } catch (err) { next(err); }
});

// GET /api/servers/:id/metrics
router.get('/:id/metrics', authenticate, requirePermission('read', 'servers'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hours = Number(req.query.hours ?? 1);
    const metrics = await ServersService.getMetricsHistory(req.params.id, hours);
    ok(res, metrics);
  } catch (err) { next(err); }
});

// POST /api/servers — create
router.post('/', authenticate, requirePermission('create', 'servers'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const srv = await ServersService.create(req.body);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'SERVER_CREATED', category: 'INFRASTRUCTURE',
      targetId: srv.id, details: `Created server: ${srv.hostname}`, requestId: String(req.id ?? ''),
    });
    created(res, srv);
  } catch (err) { next(err); }
});

// PATCH /api/servers/:id
router.patch('/:id', authenticate, requirePermission('update', 'servers'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const srv = await ServersService.update(req.params.id, req.body);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'SERVER_UPDATED', category: 'INFRASTRUCTURE',
      targetId: req.params.id, details: `Updated server`, requestId: String(req.id ?? ''),
    });
    ok(res, srv);
  } catch (err) { next(err); }
});

// DELETE /api/servers/:id
router.delete('/:id', authenticate, requirePermission('delete', 'servers'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ServersService.softDelete(req.params.id);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'SERVER_DELETED', category: 'INFRASTRUCTURE',
      targetId: req.params.id, details: `Soft-deleted server`, requestId: String(req.id ?? ''),
    });
    noContent(res);
  } catch (err) { next(err); }
});

// POST /api/telemetry/heartbeat — agent endpoint (uses API key auth, not JWT)
router.post('/telemetry/ingest', validate(telemetrySchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ServersService.ingestTelemetry(req.body);
    ok(res, { received: true, timestamp: new Date().toISOString() });
  } catch (err) { next(err); }
});

export default router;

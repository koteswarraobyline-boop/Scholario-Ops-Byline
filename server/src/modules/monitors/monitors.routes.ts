import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { MonitorsService } from './monitors.service';
import { AuditService } from '../audit/audit.service';
import { ok, created, noContent, paginated } from '../../utils/response';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['HTTP','HTTPS','DNS','TCP','SSL','APP_HEALTH','APP_READINESS',
    'API_BUSINESS','CRON_HEARTBEAT','WORKER_HEARTBEAT','INFRA_CPU','INFRA_RAM',
    'INFRA_DISK','DB_CONN','DB_REPLICATION','BACKUP_FRESHNESS','DEAD_MAN']),
  target: z.string().min(1),
  applicationId: z.string().uuid().optional(),
  serverId: z.string().uuid().optional(),
  environment: z.enum(['PRD','DR']).default('PRD'),
  intervalSec: z.number().int().min(10).default(30),
  timeoutSec: z.number().int().min(1).max(60).default(10),
  retries: z.number().int().min(0).max(5).default(2),
  warningThresholdMs: z.number().int().positive().default(500),
  criticalThresholdMs: z.number().int().positive().default(2000),
  failureConfirmationThreshold: z.number().int().min(1).max(10).default(3),
  recoveryConfirmationThreshold: z.number().int().min(1).max(10).default(3),
  runbookId: z.string().uuid().optional(),
});

router.get('/', authenticate, requirePermission('read', 'monitors'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await MonitorsService.list({
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 50),
      applicationId: req.query.applicationId as string,
      status: req.query.status as string,
      type: req.query.type as string,
      environment: req.query.environment as string,
    });
    paginated(res, result);
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, requirePermission('read', 'monitors'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await MonitorsService.getById(req.params.id));
  } catch (err) { next(err); }
});

router.post('/', authenticate, requirePermission('create', 'monitors'), validate(createSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mon = await MonitorsService.create(req.body);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'MONITOR_CREATED', category: 'MONITOR',
      targetId: mon.id, details: `Created monitor: ${mon.name}`, requestId: req.id,
    });
    created(res, mon);
  } catch (err) { next(err); }
});

router.patch('/:id', authenticate, requirePermission('update', 'monitors'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mon = await MonitorsService.update(req.params.id, req.body);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'MONITOR_UPDATED', category: 'MONITOR',
      targetId: req.params.id, details: `Updated monitor`, requestId: req.id,
    });
    ok(res, mon);
  } catch (err) { next(err); }
});

// POST /api/monitors/:id/probe — run a single probe now
router.post('/:id/probe', authenticate, requirePermission('run', 'monitors'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await MonitorsService.runProbe(req.params.id);
    ok(res, result);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requirePermission('delete', 'monitors'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await MonitorsService.softDelete(req.params.id);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'MONITOR_DELETED', category: 'MONITOR',
      targetId: req.params.id, details: `Deleted monitor`, requestId: req.id,
    });
    noContent(res);
  } catch (err) { next(err); }
});

export default router;

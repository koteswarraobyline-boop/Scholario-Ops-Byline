import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { query, queryOne } from '../../database/pool';
import { AuditService } from '../audit/audit.service';
import { ok, created, paginated, parsePagination } from '../../utils/response';
import { NotFoundError } from '../../utils/errors';

const router = Router();

const createSchema = z.object({
  title: z.string().min(1).max(500),
  applicationId: z.string().uuid().optional(),
  environment: z.enum(['PRD','DR']).default('PRD'),
  startTime: z.string(),
  endTime: z.string(),
  expectedImpact: z.string().optional(),
  suppressMonitors: z.array(z.string()).default([]),
  reason: z.string().optional(),
});

router.get('/', authenticate, requirePermission('read', 'monitors'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>);
    const [cnt] = await query<{ count: string }>(`SELECT COUNT(*) as count FROM maintenance_windows`);
    const total = parseInt(cnt?.count ?? '0', 10);
    const rows = await query(
      `SELECT mw.*, a.name AS app_name FROM maintenance_windows mw
       LEFT JOIN applications a ON a.id = mw.application_id
       ORDER BY mw.start_time DESC LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    paginated(res, { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, requirePermission('read', 'monitors'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mw = await queryOne(`SELECT mw.*, a.name AS app_name FROM maintenance_windows mw LEFT JOIN applications a ON a.id = mw.application_id WHERE mw.id = $1`, [req.params.id]);
    if (!mw) throw new NotFoundError('Maintenance window');
    ok(res, mw);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requirePermission('create', 'maintenance'), validate(createSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const d = req.body;
    const [mw] = await query(
      `INSERT INTO maintenance_windows
         (id,title,application_id,environment,start_time,end_time,expected_impact,suppress_monitors,reason,approved_by,approved_by_id,created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [uuidv4(), d.title, d.applicationId ?? null, d.environment, d.startTime, d.endTime,
       d.expectedImpact ?? null, d.suppressMonitors, d.reason ?? null,
       req.user!.email, req.user!.sub, req.user!.sub]
    );
    // Suppress affected monitors
    if (d.suppressMonitors?.length) {
      await query(
        `UPDATE monitors SET active_maintenance = TRUE WHERE id = ANY($1::uuid[])`,
        [d.suppressMonitors]
      );
    }
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'MAINTENANCE_CREATED', category: 'MAINTENANCE',
      targetId: mw.id, details: `Created maintenance: ${d.title}`, requestId: req.id,
    });
    created(res, mw);
  } catch (err) { next(err); }
});

router.patch('/:id/complete', authenticate, requirePermission('update', 'maintenance'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const mw = await queryOne<{ id: string; suppress_monitors: string[] }>(
      `SELECT id, suppress_monitors FROM maintenance_windows WHERE id = $1`, [req.params.id]
    );
    if (!mw) throw new NotFoundError('Maintenance window');

    await query(`UPDATE maintenance_windows SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`, [req.params.id]);

    // Re-enable monitors
    if (mw.suppress_monitors?.length) {
      await query(`UPDATE monitors SET active_maintenance = FALSE WHERE id = ANY($1::uuid[])`, [mw.suppress_monitors]);
    }
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'MAINTENANCE_COMPLETED', category: 'MAINTENANCE',
      targetId: req.params.id, details: `Maintenance window completed`, requestId: req.id,
    });
    ok(res, { status: 'COMPLETED' });
  } catch (err) { next(err); }
});

export default router;

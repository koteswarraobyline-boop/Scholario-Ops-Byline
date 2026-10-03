import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { query, queryOne } from '../../database/pool';
import { AuditService } from '../audit/audit.service';
import { ok, created, noContent, paginated, parsePagination } from '../../utils/response';
import { NotFoundError } from '../../utils/errors';

const router = Router();

const createSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  category: z.enum(['DATABASE','FAILOVER','WEB_SERVER','PERFORMANCE','DEAD_MAN','NETWORK','SECURITY']),
  estimatedDurationMin: z.number().int().positive().default(15),
  steps: z.array(z.object({
    stepOrder: z.number().int().positive(),
    title: z.string().min(1),
    instruction: z.string().min(1),
    command: z.string().optional(),
  })).min(1),
});

router.get('/', authenticate, requirePermission('read', 'runbooks'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>);
    const conds = ['r.deleted_at IS NULL'];
    const vals: unknown[] = [];
    let i = 1;
    if (req.query.category) { conds.push(`r.category = $${i++}`); vals.push(req.query.category); }
    const where = `WHERE ${conds.join(' AND ')}`;
    const [cnt] = await query<{ count: string }>(`SELECT COUNT(*) as count FROM runbooks r ${where}`, vals);
    const total = parseInt(cnt?.count ?? '0', 10);
    const rows = await query(
      `SELECT r.*, COUNT(rs.id)::int AS step_count
       FROM runbooks r
       LEFT JOIN runbook_steps rs ON rs.runbook_id = r.id
       ${where} GROUP BY r.id ORDER BY r.category, r.title
       LIMIT $${i} OFFSET $${i+1}`,
      [...vals, pageSize, offset]
    );
    paginated(res, { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, requirePermission('read', 'runbooks'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rb = await queryOne(`SELECT * FROM runbooks WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (!rb) throw new NotFoundError('Runbook');
    const steps = await query(`SELECT * FROM runbook_steps WHERE runbook_id = $1 ORDER BY step_order`, [req.params.id]);
    ok(res, { ...rb, steps });
  } catch (err) { next(err); }
});

router.post('/', authenticate, requirePermission('execute', 'runbooks'), validate(createSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const d = req.body;
    const [rb] = await query(
      `INSERT INTO runbooks (id,title,description,category,estimated_duration_min,created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [uuidv4(), d.title, d.description ?? null, d.category, d.estimatedDurationMin, req.user!.sub]
    );
    for (const step of d.steps) {
      await query(
        `INSERT INTO runbook_steps (id,runbook_id,step_order,title,instruction,command)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [uuidv4(), rb.id, step.stepOrder, step.title, step.instruction, step.command ?? null]
      );
    }
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'RUNBOOK_CREATED', category: 'RUNBOOK',
      targetId: rb.id, details: `Created runbook: ${rb.title}`, requestId: req.id,
    });
    const steps = await query(`SELECT * FROM runbook_steps WHERE runbook_id = $1 ORDER BY step_order`, [rb.id]);
    created(res, { ...rb, steps });
  } catch (err) { next(err); }
});

// POST /:id/execute — start an execution session
router.post('/:id/execute', authenticate, requirePermission('execute', 'runbooks'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rb = await queryOne<{ id: string; title: string }>(
      `SELECT id, title FROM runbooks WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]
    );
    if (!rb) throw new NotFoundError('Runbook');

    const [cnt] = await query<{ count: string }>(`SELECT COUNT(*) as count FROM runbook_steps WHERE runbook_id = $1`, [req.params.id]);
    const totalSteps = parseInt(cnt?.count ?? '0', 10);

    const [exec] = await query(
      `INSERT INTO runbook_executions (id,runbook_id,incident_id,executed_by_id,executed_by,total_steps)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [uuidv4(), req.params.id, req.body.incidentId ?? null, req.user!.sub, req.user!.email, totalSteps]
    );

    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'RUNBOOK_EXECUTION', category: 'RUNBOOK',
      targetId: req.params.id, details: `Started execution of: ${rb.title}`, requestId: req.id,
    });
    created(res, exec);
  } catch (err) { next(err); }
});

// PATCH /executions/:execId/steps/:stepId — mark step complete/incomplete
router.patch('/executions/:execId/steps/:stepId', authenticate, requirePermission('execute', 'runbooks'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { completed } = req.body as { completed: boolean };
    if (completed) {
      await query(
        `INSERT INTO runbook_step_completions (id,execution_id,step_id,completed_by_id,completed_by)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (execution_id,step_id) DO NOTHING`,
        [uuidv4(), req.params.execId, req.params.stepId, req.user!.sub, req.user!.email]
      );
      await query(
        `UPDATE runbook_executions SET steps_done = (
           SELECT COUNT(*) FROM runbook_step_completions WHERE execution_id = $1
         ) WHERE id = $1`,
        [req.params.execId]
      );
    } else {
      await query(
        `DELETE FROM runbook_step_completions WHERE execution_id = $1 AND step_id = $2`,
        [req.params.execId, req.params.stepId]
      );
    }
    ok(res, { completed, executionId: req.params.execId, stepId: req.params.stepId });
  } catch (err) { next(err); }
});

export default router;

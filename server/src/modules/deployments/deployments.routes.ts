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
  applicationId: z.string().uuid(),
  version: z.string().min(1),
  commitHash: z.string().optional(),
  commitMessage: z.string().optional(),
  environment: z.enum(['PRD', 'DR']).default('PRD'),
  author: z.string().optional(),
});

router.get('/', authenticate, requirePermission('read', 'deployments'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>);
    const conds = ['1=1'];
    const vals: unknown[] = [];
    let i = 1;
    if (req.query.applicationId) { conds.push(`d.application_id = $${i++}`); vals.push(req.query.applicationId); }
    if (req.query.status) { conds.push(`d.status = $${i++}`); vals.push(req.query.status); }
    const where = `WHERE ${conds.join(' AND ')}`;
    const [cnt] = await query<{ count: string }>(`SELECT COUNT(*) as count FROM deployments d ${where}`, vals);
    const total = parseInt(cnt?.count ?? '0', 10);
    const rows = await query(
      `SELECT d.*, a.name AS app_name FROM deployments d
       LEFT JOIN applications a ON a.id = d.application_id
       ${where} ORDER BY d.started_at DESC
       LIMIT $${i} OFFSET $${i+1}`,
      [...vals, pageSize, offset]
    );
    paginated(res, { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, requirePermission('read', 'deployments'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dep = await queryOne(`SELECT d.*, a.name AS app_name FROM deployments d LEFT JOIN applications a ON a.id = d.application_id WHERE d.id = $1`, [req.params.id]);
    if (!dep) throw new NotFoundError('Deployment');
    const events = await query(`SELECT * FROM deployment_events WHERE deployment_id = $1 ORDER BY occurred_at ASC`, [req.params.id]);
    ok(res, { ...dep, events });
  } catch (err) { next(err); }
});

router.post('/', authenticate, requirePermission('read', 'deployments'), validate(createSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const d = req.body;
    const [dep] = await query<Record<string,unknown>>(
      `INSERT INTO deployments (id,application_id,version,commit_hash,commit_message,environment,author,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'BUILDING') RETURNING *`,
      [uuidv4(), d.applicationId, d.version, d.commitHash ?? null, d.commitMessage ?? null, d.environment, d.author ?? req.user!.email]
    );
    await query(
      `INSERT INTO deployment_events (id,deployment_id,stage,status,message) VALUES ($1,$2,'BUILD','STARTED','Deployment initiated')`,
      [uuidv4(), dep.id]
    );
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'DEPLOYMENT_CREATED', category: 'INFRASTRUCTURE',
      targetId: dep.id as string, details: `Deploy ${d.version} for app ${d.applicationId}`, requestId: String(req.id ?? ''),
    });
    created(res, dep);
  } catch (err) { next(err); }
});

// PATCH /:id/status — update deployment stage
router.patch('/:id/status', authenticate, requirePermission('read', 'deployments'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, message } = req.body as { status: string; message?: string };
    const completedStatuses = ['SUCCESS', 'FAILED', 'ROLLED_BACK'];
    const isComplete = completedStatuses.includes(status);
    const [dep] = await query<Record<string,unknown>>(
      `UPDATE deployments SET status = $1,
         completed_at = CASE WHEN $2 THEN NOW() ELSE completed_at END,
         duration_sec = CASE WHEN $3 THEN EXTRACT(EPOCH FROM (NOW() - started_at))::INT ELSE duration_sec END,
         updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [status, isComplete, isComplete, req.params.id]
    );
    if (!dep) throw new NotFoundError('Deployment');
    await query(
      `INSERT INTO deployment_events (id,deployment_id,stage,status,message) VALUES ($1,$2,$3,$4,$5)`,
      [uuidv4(), req.params.id, status, status, message ?? `Stage: ${status}`]
    );
    ok(res, dep);
  } catch (err) { next(err); }
});

export default router;

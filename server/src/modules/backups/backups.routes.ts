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
  serverId: z.string().uuid().optional(),
  type: z.enum(['DAILY_SNAPSHOT', 'MYSQL_DUMP', 'FILE_STORAGE']),
  sizeGb: z.number().positive().optional(),
  destination: z.string().optional(),
  retentionDays: z.number().int().positive().default(30),
  encrypted: z.boolean().default(true),
  integrityHash: z.string().optional(),
  status: z.enum(['SUCCESS','FAILED','RUNNING','STALE','UNKNOWN']).default('UNKNOWN'),
});

router.get('/', authenticate, requirePermission('read', 'backups'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>);
    const conds = ['1=1'];
    const vals: unknown[] = [];
    let i = 1;
    if (req.query.applicationId) { conds.push(`b.application_id = $${i++}`); vals.push(req.query.applicationId); }
    if (req.query.status) { conds.push(`b.status = $${i++}`); vals.push(req.query.status); }
    const where = `WHERE ${conds.join(' AND ')}`;
    const [cnt] = await query<{ count: string }>(`SELECT COUNT(*) as count FROM backups b ${where}`, vals);
    const total = parseInt(cnt?.count ?? '0', 10);
    const rows = await query(
      `SELECT b.*, a.name AS app_name FROM backups b
       LEFT JOIN applications a ON a.id = b.application_id
       ${where} ORDER BY b.completed_at DESC NULLS LAST
       LIMIT $${i} OFFSET $${i+1}`,
      [...vals, pageSize, offset]
    );
    paginated(res, { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, requirePermission('read', 'backups'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const backup = await queryOne(`SELECT b.*, a.name AS app_name FROM backups b LEFT JOIN applications a ON a.id = b.application_id WHERE b.id = $1`, [req.params.id]);
    if (!backup) throw new NotFoundError('Backup');
    ok(res, backup);
  } catch (err) { next(err); }
});

router.post('/', authenticate, requirePermission('read', 'backups'), validate(createSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const d = req.body;
    const [backup] = await query(
      `INSERT INTO backups (id,application_id,server_id,type,size_gb,destination,retention_days,encrypted,integrity_hash,status,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $11 THEN NOW() ELSE NULL END) RETURNING *`,
      [uuidv4(), d.applicationId, d.serverId ?? null, d.type, d.sizeGb ?? null,
       d.destination ?? null, d.retentionDays, d.encrypted, d.integrityHash ?? null,
       d.status, d.status === 'SUCCESS']
    );
    created(res, backup);
  } catch (err) { next(err); }
});

// PATCH /:id/verify — record integrity verification result
router.patch('/:id/verify', authenticate, requirePermission('read', 'backups'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { verified, hash } = req.body as { verified: boolean; hash?: string };
    const [updated] = await query(
      `UPDATE backups SET integrity_verified = $1, integrity_hash = COALESCE($2, integrity_hash), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [verified, hash ?? null, req.params.id]
    );
    if (!updated) throw new NotFoundError('Backup');
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'BACKUP_INTEGRITY_VERIFIED', category: 'INFRASTRUCTURE',
      targetId: req.params.id, details: `Integrity verification: ${verified}`, requestId: req.id,
    });
    ok(res, updated);
  } catch (err) { next(err); }
});

// PATCH /:id/restore-test — record a restore drill result
router.patch('/:id/restore-test', authenticate, requirePermission('read', 'backups'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { restoreStatus, durationMin } = req.body as { restoreStatus: string; durationMin?: number };
    const [updated] = await query(
      `UPDATE backups SET restore_status = $1, restore_tested_at = NOW(), restore_duration_min = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [restoreStatus, durationMin ?? null, req.params.id]
    );
    if (!updated) throw new NotFoundError('Backup');
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'BACKUP_RESTORE_TEST', category: 'INFRASTRUCTURE',
      targetId: req.params.id, details: `Restore drill: ${restoreStatus} in ${durationMin}m`, requestId: req.id,
    });
    ok(res, updated);
  } catch (err) { next(err); }
});

export default router;

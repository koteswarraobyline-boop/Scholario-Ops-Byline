import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { requireRole, requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import * as AuthService from '../auth/auth.service';
import { query, queryOne } from '../../database/pool';
import { AuditService } from '../audit/audit.service';
import { ok, created, noContent, paginated, parsePagination } from '../../utils/response';
import { NotFoundError } from '../../utils/errors';

const router = Router();

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(255),
  displayName: z.string().max(100).optional(),
  roleName: z.enum(['viewer', 'operator', 'it_administrator', 'super_admin']),
});

const updateUserSchema = z.object({
  fullName: z.string().min(1).max(255).optional(),
  displayName: z.string().max(100).optional(),
  roleName: z.enum(['viewer', 'operator', 'it_administrator', 'super_admin']).optional(),
  isActive: z.boolean().optional(),
  isOnCall: z.boolean().optional(),
});

// GET /api/users
router.get('/', authenticate, requirePermission('manage', 'users'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, offset } = parsePagination(req.query as Record<string, unknown>);
    const [cnt] = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL`
    );
    const total = parseInt(cnt?.count ?? '0', 10);
    const rows = await query(
      `SELECT u.id, u.email, u.full_name, u.display_name, u.is_active, u.is_on_call,
              u.last_login_at, u.created_at, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.deleted_at IS NULL
       ORDER BY u.full_name ASC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );
    paginated(res, { data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

// GET /api/users/:id
router.get('/:id', authenticate, requirePermission('manage', 'users'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await queryOne(
      `SELECT u.id, u.email, u.full_name, u.display_name, u.is_active, u.is_on_call,
              u.last_login_at, u.created_at, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [req.params.id]
    );
    if (!user) throw new NotFoundError('User');
    ok(res, user);
  } catch (err) { next(err); }
});

// POST /api/users
router.post('/', authenticate, requirePermission('manage', 'users'), validate(createUserSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await AuthService.createUser(req.body);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'USER_CREATED', category: 'USER',
      targetId: user.id, details: `Created user: ${user.email} with role: ${user.roleName}`,
      requestId: String(req.id ?? ''),
    });
    created(res, user);
  } catch (err) { next(err); }
});

// PATCH /api/users/:id
router.patch('/:id', authenticate, requirePermission('manage', 'users'), validate(updateUserSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = req.body as { fullName?: string; displayName?: string; roleName?: string; isActive?: boolean; isOnCall?: boolean };
    const setClauses = ['updated_at = NOW()'];
    const vals: unknown[] = [];
    let i = 1;

    if (data.fullName !== undefined) { setClauses.push(`full_name = $${i++}`); vals.push(data.fullName); }
    if (data.displayName !== undefined) { setClauses.push(`display_name = $${i++}`); vals.push(data.displayName); }
    if (data.isActive !== undefined) { setClauses.push(`is_active = $${i++}`); vals.push(data.isActive); }
    if (data.isOnCall !== undefined) { setClauses.push(`is_on_call = $${i++}`); vals.push(data.isOnCall); }
    if (data.roleName) {
      const role = await queryOne<{ id: string }>(`SELECT id FROM roles WHERE name = $1`, [data.roleName]);
      if (role) { setClauses.push(`role_id = $${i++}`); vals.push(role.id); }
    }

    vals.push(req.params.id);
    const [updated] = await query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${i} AND deleted_at IS NULL RETURNING id, email, full_name, is_active`,
      vals
    );
    if (!updated) throw new NotFoundError('User');

    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'USER_UPDATED', category: 'USER',
      targetId: req.params.id, details: `Updated user fields`, requestId: String(req.id ?? ''),
    });
    ok(res, updated);
  } catch (err) { next(err); }
});

// DELETE /api/users/:id (soft delete)
router.delete('/:id', authenticate, requireRole('super_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.params.id === req.user!.sub) {
      throw new Error('Cannot delete your own account');
    }
    await query(`UPDATE users SET deleted_at = NOW(), is_active = FALSE WHERE id = $1`, [req.params.id]);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'USER_DELETED', category: 'USER',
      targetId: req.params.id, details: `Deactivated user account`, requestId: String(req.id ?? ''),
    });
    noContent(res);
  } catch (err) { next(err); }
});

export default router;

import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, AuthError } from '../utils/errors';
import { queryOne } from '../database/pool';
import { cacheGet, cacheSet } from '../database/redis';

// Role hierarchy — higher index = more permissions
const ROLE_HIERARCHY: Record<string, number> = {
  viewer: 1,
  operator: 2,
  it_administrator: 3,
  super_admin: 4,
};

/**
 * Require a minimum role level.
 * Usage: router.post('/...', authenticate, requireRole('operator'), handler)
 */
export function requireRole(minRole: keyof typeof ROLE_HIERARCHY) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new AuthError());

    const userLevel = ROLE_HIERARCHY[req.user.roleName] ?? 0;
    const required = ROLE_HIERARCHY[minRole] ?? 999;

    if (userLevel < required) {
      return next(
        new ForbiddenError(
          `This action requires the '${minRole}' role or above`
        )
      );
    }
    next();
  };
}

/**
 * Require a specific permission (action + resource).
 * Usage: router.post('/...', authenticate, requirePermission('acknowledge', 'incidents'), handler)
 */
export function requirePermission(action: string, resource: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) return next(new AuthError());

    // Super admins bypass all permission checks
    if (req.user.roleName === 'super_admin') return next();

    const cacheKey = `perms:${req.user.role}:${action}:${resource}`;
    let allowed = await cacheGet<boolean>(cacheKey);

    if (allowed === null) {
      const result = await queryOne<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = $1
           AND p.action = $2
           AND p.resource = $3`,
        [req.user.role, action, resource]
      );
      allowed = parseInt(result?.count ?? '0', 10) > 0;
      await cacheSet(cacheKey, allowed, 300); // cache 5 min
    }

    if (!allowed) {
      return next(
        new ForbiddenError(`Missing permission: ${action}:${resource}`)
      );
    }
    next();
  };
}

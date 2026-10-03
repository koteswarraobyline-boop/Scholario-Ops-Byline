import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, authenticateStrict } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { DrService } from './dr.service';
import { ok } from '../../utils/response';

const router = Router();

const failoverSchema = z.object({
  applicationId: z.string().uuid(),
  target: z.enum(['DR', 'PRIMARY']),
  confirmationCode: z.string().optional(),
});

// GET /api/dr/:appId/readiness
router.get('/:appId/readiness', authenticate, requirePermission('read', 'applications'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await DrService.getReadiness(req.params.appId));
  } catch (err) { next(err); }
});

// POST /api/dr/failover — strict auth (re-validates user active status)
router.post('/failover', authenticateStrict, requirePermission('failover', 'applications'), validate(failoverSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { applicationId, target } = req.body as { applicationId: string; target: 'DR' | 'PRIMARY' };
    const result = await DrService.triggerFailover(
      applicationId, target, req.user!.sub, req.user!.email
    );
    ok(res, result);
  } catch (err) { next(err); }
});

export default router;

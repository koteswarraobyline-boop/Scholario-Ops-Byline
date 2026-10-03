import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/authorize';
import { AuditService } from './audit.service';
import { paginated } from '../../utils/response';

const router = Router();

// GET /api/audit — all roles can view but operators+ only
router.get(
  '/',
  authenticate,
  requireRole('operator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await AuditService.list({
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 50,
        category: req.query.category as string | undefined,
        operatorId: req.query.operatorId as string | undefined,
        targetId: req.query.targetId as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
      });
      paginated(res, result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

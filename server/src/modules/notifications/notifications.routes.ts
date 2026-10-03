import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { NotificationsService } from './notifications.service';
import { AuditService } from '../audit/audit.service';
import { ok, paginated } from '../../utils/response';

const router = Router();

router.get('/channels', authenticate, requirePermission('read', 'communications'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await NotificationsService.listChannels());
  } catch (err) { next(err); }
});

router.post('/channels/:id/test', authenticate, requirePermission('manage', 'communications'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await NotificationsService.sendTest(req.params.id);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'TEST_NOTIFICATION_SENT', category: 'NOTIFICATION',
      targetId: req.params.id, details: `Test notification dispatched, success: ${result}`,
      requestId: req.id,
    });
    ok(res, { success: result });
  } catch (err) { next(err); }
});

router.get('/deliveries', authenticate, requirePermission('read', 'communications'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await NotificationsService.listDeliveries({
      channelId: req.query.channelId as string,
      incidentId: req.query.incidentId as string,
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 25),
    });
    paginated(res, result);
  } catch (err) { next(err); }
});

export default router;

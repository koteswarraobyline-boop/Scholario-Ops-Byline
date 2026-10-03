import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { IncidentsService } from './incidents.service';
import { AuditService } from '../audit/audit.service';
import { ok, paginated } from '../../utils/response';

const router = Router();

const noteSchema = z.object({ content: z.string().min(1) });
const statusSchema = z.object({
  status: z.enum(['OPEN','ACKNOWLEDGED','INVESTIGATING','MITIGATING','MONITORING','RESOLVED','CLOSED']),
});
const severitySchema = z.object({
  severity: z.enum(['INFO','WARNING','HIGH','CRITICAL','EMERGENCY']),
});
const assignSchema = z.object({ ownerName: z.string().min(1), ownerId: z.string().uuid() });
const resolveSchema = z.object({ resolution: z.string().default('Resolved by operator') });

router.get('/', authenticate, requirePermission('read', 'incidents'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await IncidentsService.list({
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 25),
      status: req.query.status as string,
      severity: req.query.severity as string,
      applicationId: req.query.applicationId as string,
      environment: req.query.environment as string,
      open: req.query.open === 'true',
    });
    paginated(res, result);
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, requirePermission('read', 'incidents'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    ok(res, await IncidentsService.getById(req.params.id));
  } catch (err) { next(err); }
});

router.post('/:id/acknowledge', authenticate, requirePermission('acknowledge', 'incidents'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const inc = await IncidentsService.acknowledge(req.params.id, req.user!.sub, req.user!.email);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'INCIDENT_ACKNOWLEDGED', category: 'INCIDENT',
      targetId: req.params.id, details: `Acknowledged by ${req.user!.email}`, requestId: String(req.id ?? ''),
    });
    ok(res, inc);
  } catch (err) { next(err); }
});

router.patch('/:id/status', authenticate, requirePermission('update_status', 'incidents'), validate(statusSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body as { status: string };
    const inc = await IncidentsService.changeStatus(req.params.id, status, req.user!.email, req.user!.sub);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'INCIDENT_STATUS_CHANGE', category: 'INCIDENT',
      targetId: req.params.id, details: `Status → ${status}`, requestId: String(req.id ?? ''),
    });
    ok(res, inc);
  } catch (err) { next(err); }
});

router.patch('/:id/severity', authenticate, requirePermission('update_status', 'incidents'), validate(severitySchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { severity } = req.body as { severity: string };
    const inc = await IncidentsService.changeSeverity(req.params.id, severity, req.user!.email);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'INCIDENT_SEVERITY_CHANGE', category: 'INCIDENT',
      targetId: req.params.id, details: `Severity → ${severity}`, requestId: String(req.id ?? ''),
    });
    ok(res, inc);
  } catch (err) { next(err); }
});

router.patch('/:id/assign', authenticate, requirePermission('assign', 'incidents'), validate(assignSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ownerName, ownerId } = req.body as { ownerName: string; ownerId: string };
    const inc = await IncidentsService.assignOwner(req.params.id, ownerName, ownerId, req.user!.email);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'INCIDENT_REASSIGNED', category: 'INCIDENT',
      targetId: req.params.id, details: `Assigned to ${ownerName}`, requestId: String(req.id ?? ''),
    });
    ok(res, inc);
  } catch (err) { next(err); }
});

router.post('/:id/notes', authenticate, requirePermission('add_note', 'incidents'), validate(noteSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content } = req.body as { content: string };
    await IncidentsService.addNote(req.params.id, content, req.user!.sub, req.user!.email);
    ok(res, { message: 'Note added' });
  } catch (err) { next(err); }
});

router.post('/:id/resolve', authenticate, requirePermission('resolve', 'incidents'), validate(resolveSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { resolution } = req.body as { resolution: string };
    const inc = await IncidentsService.resolve(req.params.id, resolution, req.user!.email, req.user!.sub);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'INCIDENT_RESOLVED', category: 'INCIDENT',
      targetId: req.params.id, details: `Resolved: ${resolution}`, requestId: String(req.id ?? ''),
    });
    ok(res, inc);
  } catch (err) { next(err); }
});

export default router;

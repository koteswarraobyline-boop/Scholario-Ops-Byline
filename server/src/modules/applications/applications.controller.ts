import { Request, Response, NextFunction } from 'express';
import { ApplicationsService } from './applications.service';
import { AuditService } from '../audit/audit.service';
import { ok, created, noContent, paginated } from '../../utils/response';

export async function listApplications(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await ApplicationsService.list({
      page: Number(req.query.page ?? 1),
      pageSize: Number(req.query.pageSize ?? 25),
      status: req.query.status as string,
      tier: req.query.tier as string,
      search: req.query.search as string,
    });
    paginated(res, result);
  } catch (err) { next(err); }
}

export async function getApplication(req: Request, res: Response, next: NextFunction) {
  try {
    const app = await ApplicationsService.getById(req.params.id);
    ok(res, app);
  } catch (err) { next(err); }
}

export async function createApplication(req: Request, res: Response, next: NextFunction) {
  try {
    const app = await ApplicationsService.create(req.body);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'APPLICATION_CREATED', category: 'INFRASTRUCTURE',
      targetId: app.id, details: `Created application: ${app.name}`,
      requestId: req.id,
    });
    created(res, app);
  } catch (err) { next(err); }
}

export async function updateApplication(req: Request, res: Response, next: NextFunction) {
  try {
    const app = await ApplicationsService.update(req.params.id, req.body);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'APPLICATION_UPDATED', category: 'INFRASTRUCTURE',
      targetId: app.id, details: `Updated application: ${app.name}`,
      requestId: req.id,
    });
    ok(res, app);
  } catch (err) { next(err); }
}

export async function deleteApplication(req: Request, res: Response, next: NextFunction) {
  try {
    await ApplicationsService.softDelete(req.params.id);
    await AuditService.log({
      operatorId: req.user!.sub, operator: req.user!.email,
      action: 'APPLICATION_DELETED', category: 'INFRASTRUCTURE',
      targetId: req.params.id, details: `Soft-deleted application`,
      requestId: req.id,
    });
    noContent(res);
  } catch (err) { next(err); }
}

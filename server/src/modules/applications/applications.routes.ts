import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate';
import { requireRole, requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import * as ctrl from './applications.controller';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(100),
  codeName: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  tier: z.enum(['TIER_1', 'TIER_2', 'TIER_3']).default('TIER_2'),
  rtoTargetMin: z.number().int().positive().default(30),
  rpoTargetMin: z.number().int().positive().default(15),
  cloudflareZone: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  tier: z.enum(['TIER_1', 'TIER_2', 'TIER_3']).optional(),
  status: z.enum(['HEALTHY','WARNING','CRITICAL','UNKNOWN','MAINTENANCE','STALE']).optional(),
  rtoTargetMin: z.number().int().positive().optional(),
  rpoTargetMin: z.number().int().positive().optional(),
  cloudflareZone: z.string().optional(),
  prdServerId: z.string().uuid().optional(),
  drServerId: z.string().uuid().optional(),
  recentDeploymentVersion: z.string().optional(),
});

router.get('/', authenticate, requirePermission('read', 'applications'), ctrl.listApplications);
router.get('/:id', authenticate, requirePermission('read', 'applications'), ctrl.getApplication);
router.post('/', authenticate, requirePermission('create', 'applications'), validate(createSchema), ctrl.createApplication);
router.patch('/:id', authenticate, requirePermission('update', 'applications'), validate(updateSchema), ctrl.updateApplication);
router.delete('/:id', authenticate, requirePermission('delete', 'applications'), ctrl.deleteApplication);

export default router;

import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { config } from '../../config';
import * as controller from './auth.controller';

const router = Router();

const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMax,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

// POST /api/auth/login
router.post('/login', authLimiter, validate(loginSchema), controller.loginHandler);

// POST /api/auth/refresh
router.post('/refresh', validate(refreshSchema), controller.refreshHandler);

// POST /api/auth/logout
router.post('/logout', controller.logoutHandler);

// GET /api/auth/me
router.get('/me', authenticate, controller.getMeHandler);

// POST /api/auth/change-password
router.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  controller.changePasswordHandler
);

export default router;

import { Request, Response, NextFunction } from 'express';
import * as AuthService from './auth.service';
import { ok, created } from '../../utils/response';
import { AuditService } from '../audit/audit.service';

export async function loginHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const { user, tokens } = await AuthService.login(
      email,
      password,
      req.ip,
      req.get('user-agent')
    );

    await AuditService.log({
      operatorId: user.id,
      operator: user.fullName,
      action: 'LOGIN',
      category: 'AUTH',
      targetId: user.id,
      details: `User ${user.email} logged in`,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestId: String(req.id ?? ''),
    });

    ok(res, { user, tokens });
  } catch (err) {
    next(err);
  }
}

export async function refreshHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { refreshToken } = req.body as { refreshToken: string };
    const result = await AuthService.refreshTokens(refreshToken);
    ok(res, result);
  } catch (err) {
    next(err);
  }
}

export async function logoutHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { refreshToken } = req.body as { refreshToken: string };
    if (refreshToken) await AuthService.logout(refreshToken);

    if (req.user) {
      await AuditService.log({
        operatorId: req.user.sub,
        operator: req.user.email,
        action: 'LOGOUT',
        category: 'AUTH',
        targetId: req.user.sub,
        details: 'User logged out',
        requestId: String(req.id ?? ''),
      });
    }

    ok(res, { message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

export async function getMeHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await AuthService.getMe(req.user!.sub);
    ok(res, user);
  } catch (err) {
    next(err);
  }
}

export async function changePasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };
    await AuthService.changePassword(req.user!.sub, currentPassword, newPassword);
    ok(res, { message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
}

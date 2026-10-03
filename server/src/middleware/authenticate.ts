import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthError } from '../utils/errors';
import { queryOne } from '../database/pool';

export interface JwtPayload {
  sub: string;      // user id
  email: string;
  role: string;
  roleName: string;
  iat: number;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AuthError('No token provided'));
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.auth.jwtSecret) as JwtPayload;
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(new AuthError('Token expired'));
    } else {
      next(new AuthError('Invalid token'));
    }
  }
}

// Optional auth — doesn't fail if no token, just leaves req.user undefined
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }
  const token = authHeader.slice(7);
  try {
    req.user = jwt.verify(token, config.auth.jwtSecret) as JwtPayload;
  } catch {
    // ignore invalid token for optional routes
  }
  next();
}

// Verify user still exists and is active (for sensitive operations)
export async function authenticateStrict(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  authenticate(req, res, async (err) => {
    if (err) return next(err);
    const user = await queryOne<{ id: string; is_active: boolean }>(
      'SELECT id, is_active FROM users WHERE id = $1 AND deleted_at IS NULL',
      [req.user!.sub]
    );
    if (!user || !user.is_active) {
      return next(new AuthError('Account is inactive or not found'));
    }
    next();
  });
}

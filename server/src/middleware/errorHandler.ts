import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { config } from '../config';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = (req as Request & { id?: string }).id;

  if (err instanceof AppError) {
    logger.warn({ err, requestId, path: req.path }, 'Application error');
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code ?? 'ERROR',
        message: err.message,
      },
      requestId,
    });
    return;
  }

  // Unexpected error — log full details, hide from client in prod
  logger.error({ err, requestId, path: req.path }, 'Unhandled error');
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: config.isDev() ? err.message : 'An internal error occurred',
    },
    requestId,
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}

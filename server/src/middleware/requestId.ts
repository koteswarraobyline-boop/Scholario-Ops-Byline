import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare global {
  namespace Express {
    interface Request {
      id: string;
      startTime: number;
      // Override express-serve-static-core ReqId to always be string
    }
  }
}

// Ensure req.id is always a string (pino-http may set it as number)
declare module 'http' {
  interface IncomingMessage {
    id: string;
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.id = (req.headers['x-request-id'] as string) || uuidv4();
  req.startTime = Date.now();
  res.setHeader('X-Request-Id', req.id);
  next();
}

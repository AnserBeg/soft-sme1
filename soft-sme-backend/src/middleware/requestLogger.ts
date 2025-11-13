import { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export function requestLogger() {
  return function (req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const existingId = (req.headers['x-request-id'] as string) || '';
    const reqId = existingId || uuidv4();
    (req as any).id = reqId;
    res.setHeader('X-Request-Id', reqId);

    const metaStart = {
      id: reqId,
      method: req.method,
      path: req.originalUrl || req.url,
      ip: req.ip,
    };
    logger.info('req:start', metaStart);

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const metaEnd = {
        id: reqId,
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        durationMs,
      };
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      (logger as any)[level]('req:done', metaEnd);
    });

    next();
  };
}


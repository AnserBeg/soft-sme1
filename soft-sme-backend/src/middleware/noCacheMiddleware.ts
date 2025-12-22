import { Request, Response, NextFunction } from 'express';

export const applyNoCacheHeaders = (res: Response): void => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
};

export const noCacheMiddleware = (_req: Request, res: Response, next: NextFunction) => {
  applyNoCacheHeaders(res);
  next();
};

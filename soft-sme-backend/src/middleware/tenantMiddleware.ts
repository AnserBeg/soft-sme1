import { Request, Response, NextFunction } from 'express';
import { runWithTenantContext } from '../db';

function resolveTenantId(req: Request): string | undefined {
  const fromUser = (req.user as any)?.company_id;
  if (fromUser) {
    return String(fromUser);
  }

  const header = req.headers['x-tenant-id'] || req.headers['X-Tenant-Id'];
  if (header) {
    return Array.isArray(header) ? header[0] : String(header);
  }

  return undefined;
}

export function tenantContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    res.status(400).json({ message: 'Tenant context is required' });
    return;
  }

  runWithTenantContext(tenantId, () => {
    next();
  });
}

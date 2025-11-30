import { Request } from 'express';

// Centralized helper to extract a numeric companyId from the authenticated request
export function getCompanyIdFromRequest(req: Request): number | null {
  const raw =
    (req.user as any)?.company_id ??
    (req.params as any)?.companyId ??
    (req.body as any)?.company_id;

  const companyId = Number(raw);
  return Number.isInteger(companyId) ? companyId : null;
}

export function requireCompanyId(req: Request): number {
  const companyId = getCompanyIdFromRequest(req);
  if (!companyId) {
    throw new Error('Missing company context');
  }
  return companyId;
}

import { Request } from 'express';
import { Pool } from 'pg';
import { resolveTenantCompanyId } from './tenantCompany';

// Centralized helper to extract a numeric companyId from the authenticated request
export function getCompanyIdFromRequest(req: Request): number | null {
  const headerValue =
    req.headers['x-tenant-id'] ??
    req.headers['x-company-id'] ??
    (req.headers as any)['x-company_id'];

  const raw =
    (req.user as any)?.company_id ??
    (req.params as any)?.companyId ??
    (req.body as any)?.company_id ??
    (req.query as any)?.company_id ??
    (req.query as any)?.companyId ??
    (Array.isArray(headerValue) ? headerValue[0] : headerValue);

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

export async function resolveTenantCompanyIdFromRequest(
  req: Request,
  pool: Pool
): Promise<number | null> {
  const requestedCompanyId = getCompanyIdFromRequest(req);
  if (!requestedCompanyId) {
    return null;
  }

  const tenantCompanyId = await resolveTenantCompanyId(pool, String(requestedCompanyId));
  if (!tenantCompanyId) {
    return null;
  }

  const parsed = Number(tenantCompanyId);
  return Number.isInteger(parsed) ? parsed : null;
}

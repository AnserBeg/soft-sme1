import { Pool } from 'pg';

/**
 * Tenant DBs can be either:
 * - isolated per company (each tenant gets its own database), where local company_id values
 *   are often "1" regardless of the shared auth company's ID, or
 * - shared across multiple companies, where company_id matches the shared auth company's ID.
 *
 * This helper normalizes the company_id used for tenant-scoped queries by probing the tenant DB.
 */
export async function resolveTenantCompanyId(
  pool: Pool,
  requestedCompanyId?: string | null
): Promise<string | null> {
  if (requestedCompanyId === undefined || requestedCompanyId === null || requestedCompanyId === '') {
    return null;
  }

  try {
    const result = await pool.query(
      `
      SELECT DISTINCT company_id
      FROM users
      WHERE company_id IS NOT NULL
      LIMIT 2
      `
    );

    const distinct = result.rows
      .map(row => row.company_id)
      .filter(value => value !== null && value !== undefined)
      .map(value => String(value));

    if (distinct.length === 1) {
      return distinct[0];
    }
  } catch {
    /* best-effort */
  }

  return String(requestedCompanyId);
}


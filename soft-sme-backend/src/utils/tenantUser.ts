import { Pool } from 'pg';

type AuthenticatedUser = {
  id?: string;
  email?: string;
  company_id?: string;
};

/**
 * Resolve the current user's ID within a tenant-scoped database.
 * The auth middleware pulls user data from the shared DB, so IDs can
 * diverge from the tenant copy. We first try the provided ID, then
 * fall back to the user's email within the same company.
 */
export async function resolveTenantUserId(
  pool: Pool,
  user?: AuthenticatedUser
): Promise<number | null> {
  if (!user?.id) {
    return null;
  }

  const companyId = user.company_id;

  const byId = await pool.query(
    companyId
      ? 'SELECT id FROM users WHERE id = $1 AND company_id = $2'
      : 'SELECT id FROM users WHERE id = $1',
    companyId ? [user.id, companyId] : [user.id]
  );
  if (byId.rows.length > 0) {
    return byId.rows[0].id;
  }

  if (user.email) {
    const byEmail = await pool.query(
      companyId
        ? 'SELECT id FROM users WHERE email = $1 AND company_id = $2'
        : 'SELECT id FROM users WHERE email = $1',
      companyId ? [user.email, companyId] : [user.email]
    );
    if (byEmail.rows.length > 0) {
      return byEmail.rows[0].id;
    }
  }

  console.warn('[tenant-users] Unable to resolve tenant user ID', {
    sharedId: user.id,
    email: user.email,
    companyId,
  });
  return null;
}

import { Pool } from 'pg';
import { sharedPool } from '../dbShared';

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
  const sharedId = Number.isFinite(Number(user.id)) ? Number(user.id) : null;

  // First try an explicit mapping via shared_user_id to avoid ID drift between shared and tenant DBs.
  if (sharedId !== null) {
    const bySharedId = await pool.query(
      companyId
        ? 'SELECT id FROM users WHERE shared_user_id = $1 AND company_id = $2'
        : 'SELECT id FROM users WHERE shared_user_id = $1',
      companyId ? [sharedId, companyId] : [sharedId],
    );
    if (bySharedId.rows.length > 0) {
      return bySharedId.rows[0].id;
    }
  }

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
      // Opportunistically backfill shared_user_id when we can resolve by email.
      if (sharedId !== null) {
        try {
          await pool.query(
            'UPDATE users SET shared_user_id = $1 WHERE id = $2',
            [sharedId, byEmail.rows[0].id],
          );
        } catch {
          /* non-blocking */
        }
      }
      return byEmail.rows[0].id;
    }
  }

  console.warn('[tenant-users] Unable to resolve tenant user ID', {
    sharedId: user.id,
    email: user.email,
    companyId,
  });

  // Best-effort sync: if the shared auth DB has the user but the tenant DB doesn't,
  // upsert the tenant copy so downstream mobile/profile access can work.
  if (sharedId !== null && companyId && user.email) {
    try {
      const sharedUser = await sharedPool.query(
        'SELECT id, email, username, password_hash, access_role, company_id FROM users WHERE id = $1',
        [sharedId],
      );
      const row = sharedUser.rows[0];
      if (row && String(row.company_id) === String(companyId)) {
        const upserted = await pool.query(
          `
          INSERT INTO users (email, username, password_hash, access_role, company_id)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (company_id, email)
          DO UPDATE SET
            username = EXCLUDED.username,
            password_hash = EXCLUDED.password_hash,
            access_role = EXCLUDED.access_role,
            updated_at = NOW()
          RETURNING id
          `,
          [row.email, row.username, row.password_hash, row.access_role, row.company_id],
        );

        const tenantId = upserted.rows[0]?.id ?? null;
        if (tenantId) {
          try {
            await pool.query('UPDATE users SET shared_user_id = $1 WHERE id = $2', [sharedId, tenantId]);
          } catch {
            /* tenant schema may not have shared_user_id yet */
          }
          return tenantId;
        }
      }
    } catch (err) {
      console.warn('[tenant-users] Best-effort tenant user sync failed', {
        sharedId,
        email: user.email,
        companyId,
      });
    }
  }
  return null;
}

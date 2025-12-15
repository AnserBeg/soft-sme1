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
    // Prefer lookup without company_id to support deployments where each tenant has its own DB
    // and the per-tenant copy uses a local company_id (often "1") instead of the shared company_id.
    const bySharedIdNoCompany = await pool.query(
      'SELECT id FROM users WHERE shared_user_id = $1',
      [sharedId]
    );
    if (bySharedIdNoCompany.rows.length > 0) {
      return bySharedIdNoCompany.rows[0].id;
    }

    if (companyId) {
      const bySharedIdWithCompany = await pool.query(
        'SELECT id FROM users WHERE shared_user_id = $1 AND company_id = $2',
        [sharedId, companyId]
      );
      if (bySharedIdWithCompany.rows.length > 0) {
        return bySharedIdWithCompany.rows[0].id;
      }
    }
  }

  // Next, try the raw id as-is (works when tenant DB shares the same users table/ids).
  // Again, prefer no company_id filter first to support per-tenant DBs.
  const byIdNoCompany = await pool.query('SELECT id FROM users WHERE id = $1', [
    user.id,
  ]);
  if (byIdNoCompany.rows.length > 0) {
    return byIdNoCompany.rows[0].id;
  }

  if (companyId) {
    const byIdWithCompany = await pool.query(
      'SELECT id FROM users WHERE id = $1 AND company_id = $2',
      [user.id, companyId]
    );
    if (byIdWithCompany.rows.length > 0) {
      return byIdWithCompany.rows[0].id;
    }
  }

  if (user.email) {
    const byEmailNoCompany = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [user.email]
    );
    if (byEmailNoCompany.rows.length > 0) {
      // Opportunistically backfill shared_user_id when we can resolve by email.
      if (sharedId !== null) {
        try {
          await pool.query('UPDATE users SET shared_user_id = $1 WHERE id = $2', [
            sharedId,
            byEmailNoCompany.rows[0].id,
          ]);
        } catch {
          /* non-blocking */
        }
      }
      return byEmailNoCompany.rows[0].id;
    }

    if (companyId) {
      const byEmailWithCompany = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND company_id = $2',
        [user.email, companyId]
      );
      if (byEmailWithCompany.rows.length > 0) {
        // Opportunistically backfill shared_user_id when we can resolve by email.
        if (sharedId !== null) {
          try {
            await pool.query(
              'UPDATE users SET shared_user_id = $1 WHERE id = $2',
              [sharedId, byEmailWithCompany.rows[0].id]
            );
          } catch {
            /* non-blocking */
          }
        }
        return byEmailWithCompany.rows[0].id;
      }
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

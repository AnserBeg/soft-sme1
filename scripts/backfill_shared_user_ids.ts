import { sharedPool } from '../soft-sme-backend/src/dbShared';
import { getTenantPool } from '../soft-sme-backend/src/db';

type UserRow = { id: number; email: string; company_id: string | number | null; shared_user_id?: number | null };

function parseTenantIds(): string[] {
  const raw = process.env.TENANT_DATABASE_URLS;
  if (!raw || !raw.trim()) {
    return [process.env.DEFAULT_TENANT_ID || 'default'];
  }

  // Supports JSON object or semicolon-separated "1=url;2=url".
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return Object.keys(parsed);
    }
  } catch {
    /* ignore */
  }

  return raw
    .split(';')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => entry.split('=')[0].trim())
    .filter(Boolean);
}

async function backfillTenant(tenantId: string) {
  const tenantPool = getTenantPool(tenantId);
  console.log(`[backfill] Processing tenant ${tenantId}`);

  const sharedUsersRes = await sharedPool.query<UserRow>('SELECT id, email, company_id FROM users');
  const tenantUsersRes = await tenantPool.query<UserRow>(
    'SELECT id, email, company_id, shared_user_id FROM users',
  );

  const sharedLookup = new Map<string, UserRow>();
  for (const u of sharedUsersRes.rows) {
    const key = `${u.email?.toLowerCase() || ''}|${u.company_id ?? ''}`;
    sharedLookup.set(key, u);
  }

  let updated = 0;
  for (const tUser of tenantUsersRes.rows) {
    const key = `${tUser.email?.toLowerCase() || ''}|${tUser.company_id ?? ''}`;
    const shared = sharedLookup.get(key);
    if (!shared) continue;

    if (tUser.shared_user_id !== shared.id) {
      await tenantPool.query('UPDATE users SET shared_user_id = $1 WHERE id = $2', [
        shared.id,
        tUser.id,
      ]);
      updated += 1;
    }
  }

  console.log(`[backfill] Tenant ${tenantId}: updated ${updated} user(s)`);
}

async function main() {
  const tenantIds = parseTenantIds();
  for (const tenantId of tenantIds) {
    await backfillTenant(tenantId);
  }
  await sharedPool.end();
  console.log('[backfill] Completed');
}

main().catch(err => {
  console.error('Backfill failed', err);
  process.exit(1);
});

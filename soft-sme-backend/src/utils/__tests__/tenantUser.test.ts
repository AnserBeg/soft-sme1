jest.mock('../../dbShared', () => ({
  sharedPool: { query: jest.fn() },
}));

import { resolveTenantUserId } from '../tenantUser';

describe('resolveTenantUserId', () => {
  test('resolves by shared_user_id without company filter (per-tenant DB)', async () => {
    const pool: any = {
      query: jest.fn(async (sql: string, params: any[]) => {
        if (sql === 'SELECT id FROM users WHERE shared_user_id = $1') {
          expect(params).toEqual([25]);
          return { rows: [{ id: 4 }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const tenantUserId = await resolveTenantUserId(pool, {
      id: '25',
      email: 'mobile@gmail.com',
      company_id: '2',
    });

    expect(tenantUserId).toBe(4);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('falls back to shared_user_id with company filter when needed', async () => {
    const pool: any = {
      query: jest.fn(async (sql: string, params: any[]) => {
        if (sql === 'SELECT id FROM users WHERE shared_user_id = $1') {
          return { rows: [] };
        }
        if (sql === 'SELECT id FROM users WHERE shared_user_id = $1 AND company_id = $2') {
          expect(params).toEqual([31, '1']);
          return { rows: [{ id: 1 }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const tenantUserId = await resolveTenantUserId(pool, {
      id: '31',
      email: 'nicholaskuzoff@gmail.com',
      company_id: '1',
    });

    expect(tenantUserId).toBe(1);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test('resolves by email without company filter and backfills shared_user_id', async () => {
    const pool: any = {
      query: jest.fn(async (sql: string, params: any[]) => {
        if (sql === 'SELECT id FROM users WHERE shared_user_id = $1') {
          return { rows: [] };
        }
        if (sql === 'SELECT id FROM users WHERE shared_user_id = $1 AND company_id = $2') {
          return { rows: [] };
        }
        if (sql === 'SELECT id FROM users WHERE id = $1') {
          return { rows: [] };
        }
        if (sql === 'SELECT id FROM users WHERE id = $1 AND company_id = $2') {
          return { rows: [] };
        }
        if (sql === 'SELECT id FROM users WHERE email = $1') {
          expect(params).toEqual(['user@example.com']);
          return { rows: [{ id: 123 }] };
        }
        if (sql === 'UPDATE users SET shared_user_id = $1 WHERE id = $2') {
          expect(params).toEqual([99, 123]);
          return { rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const tenantUserId = await resolveTenantUserId(pool, {
      id: '99',
      email: 'user@example.com',
      company_id: '2',
    });

    expect(tenantUserId).toBe(123);
    expect(pool.query).toHaveBeenCalledWith(
      'UPDATE users SET shared_user_id = $1 WHERE id = $2',
      [99, 123]
    );
  });

  test('skips shared_user_id lookup when column missing', async () => {
    const pool: any = {
      query: jest.fn(async (sql: string, params: any[]) => {
        if (sql === 'SELECT id FROM users WHERE shared_user_id = $1') {
          const err: any = new Error('column "shared_user_id" does not exist');
          err.code = '42703';
          throw err;
        }
        if (sql === 'SELECT id FROM users WHERE id = $1') {
          expect(params).toEqual(['24']);
          return { rows: [{ id: 24 }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const tenantUserId = await resolveTenantUserId(pool, {
      id: '24',
      email: 'user@example.com',
      company_id: '2',
    });

    expect(tenantUserId).toBe(24);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
});

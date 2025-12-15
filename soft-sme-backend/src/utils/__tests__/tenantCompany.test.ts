import { resolveTenantCompanyId } from '../tenantCompany';

describe('resolveTenantCompanyId', () => {
  test('uses the tenant DB company_id when only one exists', async () => {
    const pool: any = {
      query: jest.fn(async () => ({ rows: [{ company_id: 1 }] })),
    };

    const resolved = await resolveTenantCompanyId(pool, '2');
    expect(resolved).toBe('1');
  });

  test('keeps requested company_id when multiple exist', async () => {
    const pool: any = {
      query: jest.fn(async () => ({ rows: [{ company_id: 1 }, { company_id: 2 }] })),
    };

    const resolved = await resolveTenantCompanyId(pool, '2');
    expect(resolved).toBe('2');
  });

  test('falls back to requested company_id on query failure', async () => {
    const pool: any = {
      query: jest.fn(async () => {
        throw new Error('db down');
      }),
    };

    const resolved = await resolveTenantCompanyId(pool, '2');
    expect(resolved).toBe('2');
  });
});


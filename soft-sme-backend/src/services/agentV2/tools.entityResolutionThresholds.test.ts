import type { Pool } from 'pg';
import { AgentToolsV2 } from './tools';
import { AgentAnalyticsLogger } from './analyticsLogger';

describe('AgentToolsV2 entity resolution thresholds', () => {
  let pool: jest.Mocked<Pool>;

  beforeEach(() => {
    pool = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: jest.fn(),
    } as unknown as jest.Mocked<Pool>;

    jest.spyOn(AgentAnalyticsLogger.prototype, 'logEvent').mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('auto-resolves customers when the top fuzzy score meets the high threshold', async () => {
    const tools = new AgentToolsV2(pool);
    jest
      .spyOn(tools as any, 'performFuzzyEntitySearch')
      .mockResolvedValue([
        { id: 7, label: 'Acme Corp', score: 0.63, extra: {} },
        { id: 9, label: 'Acme Services', score: 0.58, extra: {} },
      ]);

    const resolvedId = await (tools as any).resolveCustomerIdFromPayload({ customer_name: 'Acme Corp' }, 101);

    expect(resolvedId).toBe(7);
  });

  it('asks for disambiguation when scores fall in the mid confidence band', async () => {
    const tools = new AgentToolsV2(pool);
    jest
      .spyOn(tools as any, 'performFuzzyEntitySearch')
      .mockResolvedValue([
        {
          id: 11,
          label: 'Acme Primary',
          score: 0.44,
          extra: { city: 'Springfield', province: 'IL', country: 'USA' },
        },
        { id: 12, label: 'Acme Backup', score: 0.4, extra: {} },
        { id: 13, label: 'Acme Warehouse', score: 0.38, extra: {} },
      ]);

    await expect(
      (tools as any).resolveCustomerIdFromPayload({ customer_name: 'Acme' }, 102),
    ).rejects.toThrow(/Multiple customers match "Acme"\. Top matches: Acme Primary \(#11\)/);
  });

  it('requests refinement when no fuzzy matches meet the minimum confidence', async () => {
    const tools = new AgentToolsV2(pool);
    jest
      .spyOn(tools as any, 'performFuzzyEntitySearch')
      .mockResolvedValue([
        { id: 21, label: 'Acme Maybe', score: 0.22, extra: { city: 'Calgary', province: 'AB', country: 'Canada' } },
      ]);

    await expect(
      (tools as any).resolveCustomerIdFromPayload({ customer_name: 'Acme' }, 103),
    ).rejects.toThrow(/I found only low-confidence customer matches for "Acme"\. Closest match: Acme Maybe \(#21\)/);
  });

  it('uses canonical part matches before attempting fuzzy search', async () => {
    const tools = new AgentToolsV2(pool);
    const fuzzySpy = jest.spyOn(tools as any, 'performFuzzyEntitySearch');

    (pool.query as jest.Mock).mockImplementation(async (text: string) => {
      if (text.includes('FROM inventory WHERE canonical_part_number = $1')) {
        return { rows: [{ part_id: 404 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const resolvedId = await (tools as any).resolvePartIdFromPayload({ part_number: 'ABC-123' }, 104);

    expect(resolvedId).toBe(404);
    expect(fuzzySpy).not.toHaveBeenCalled();
  });
});

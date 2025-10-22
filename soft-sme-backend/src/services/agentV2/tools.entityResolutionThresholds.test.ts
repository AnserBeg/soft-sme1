import type { Pool } from 'pg';
import { AgentToolsV2 } from './tools';
import { AgentAnalyticsLogger } from './analyticsLogger';
import { getFuzzyConfig } from '../../config';

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
    const { minScoreAuto, minScoreShow } = getFuzzyConfig();
    const autoScore = Math.min(0.99, minScoreAuto + 0.03);
    const secondaryScore = Math.max(minScoreShow, Math.min(minScoreAuto - 0.05, autoScore - 0.05));
    jest
      .spyOn(tools as any, 'performFuzzyEntitySearch')
      .mockResolvedValue([
        { id: 7, label: 'Acme Corp', score: autoScore, extra: {} },
        { id: 9, label: 'Acme Services', score: secondaryScore, extra: {} },
      ]);

    const resolvedId = await (tools as any).resolveCustomerIdFromPayload({ customer_name: 'Acme Corp' }, 101);

    expect(resolvedId).toBe(7);
  });

  it('asks for disambiguation when scores fall in the mid confidence band', async () => {
    const tools = new AgentToolsV2(pool);
    const { minScoreAuto, minScoreShow } = getFuzzyConfig();
    const epsilon = 0.01;
    const gap = minScoreAuto - minScoreShow;
    const midScore = gap > epsilon
      ? minScoreAuto - epsilon
      : minScoreShow + gap / 2;
    jest
      .spyOn(tools as any, 'performFuzzyEntitySearch')
      .mockResolvedValue([
        {
          id: 11,
          label: 'Acme Primary',
          score: midScore,
          extra: { city: 'Springfield', province: 'IL', country: 'USA' },
        },
        { id: 12, label: 'Acme Backup', score: Math.max(minScoreShow, midScore - 0.04), extra: {} },
        { id: 13, label: 'Acme Warehouse', score: Math.max(minScoreShow, midScore - 0.06), extra: {} },
      ]);

    await expect(
      (tools as any).resolveCustomerIdFromPayload({ customer_name: 'Acme' }, 102),
    ).rejects.toThrow(/Multiple customers match "Acme"\. Top matches: Acme Primary \(#11\)/);
  });

  it('requests refinement when no fuzzy matches meet the minimum confidence', async () => {
    const tools = new AgentToolsV2(pool);
    const { minScoreShow } = getFuzzyConfig();
    const lowScore = Math.max(0, minScoreShow - 0.13);
    jest
      .spyOn(tools as any, 'performFuzzyEntitySearch')
      .mockResolvedValue([
        { id: 21, label: 'Acme Maybe', score: lowScore, extra: { city: 'Calgary', province: 'AB', country: 'Canada' } },
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

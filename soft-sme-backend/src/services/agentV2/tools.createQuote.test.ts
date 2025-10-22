import type { Pool } from 'pg';
import { AgentToolsV2 } from './tools';
import { QuoteService } from '../QuoteService';
import { AgentAnalyticsLogger } from './analyticsLogger';
import * as idempotency from '../../lib/idempotency';

describe('AgentToolsV2.createQuote customer resolution', () => {
  let pool: jest.Mocked<Pool>;
  let fetchMock: jest.Mock;
  let client: { query: jest.Mock; release: jest.Mock };

  beforeEach(() => {
    client = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    };
    pool = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      connect: jest.fn().mockResolvedValue(client),
    } as unknown as jest.Mocked<Pool>;
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    jest.spyOn(AgentAnalyticsLogger.prototype, 'logEvent').mockResolvedValue();
    jest.spyOn(idempotency, 'idempotentWrite').mockImplementation(async (options: any) => {
      const workResult = await options.work();
      return options.buildDeterministicResult(workResult);
    });
  });

  afterEach(() => {
    delete (global as any).fetch;
    jest.restoreAllMocks();
  });

  it('uses the provided customer_id when available', async () => {
    const quoteSpy = jest
      .spyOn(QuoteService.prototype, 'createQuote')
      .mockResolvedValue({ quote_id: 1, quote_number: 'QO-TEST' } as any);
    const tools = new AgentToolsV2(pool);

    const result = await tools.createQuote(10, {
      customer_id: '4',
      product_name: 'Truck Deck',
      estimated_cost: 15000,
    });

    expect(quoteSpy).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 4, product_name: 'Truck Deck' }),
      expect.anything()
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 1, number: 'QO-TEST', status: 'Open', total: null });
  });

  it('looks up the customer_id by name when not provided', async () => {
    const quoteSpy = jest
      .spyOn(QuoteService.prototype, 'createQuote')
      .mockResolvedValue({ quote_id: 2, quote_number: 'QO-LOOKUP' } as any);

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        matches: [
          { id: 7, label: 'Test Customer', score: 0.92, extra: {} },
        ],
      }),
    } as any);

    const tools = new AgentToolsV2(pool);

    const result = await tools.createQuote(11, {
      customer_name: 'Test Customer',
      product_name: 'Truck Deck',
      estimated_cost: 15000,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const urlArg = fetchMock.mock.calls[0][0] as URL;
    expect(urlArg.pathname).toBe('/api/search/fuzzy');
    expect(urlArg.searchParams.get('type')).toBe('customer');
    expect(urlArg.searchParams.get('q')).toBe('TEST CUSTOMER');
    expect(quoteSpy).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 7 }), expect.anything());
    expect(result).toEqual({ id: 2, number: 'QO-LOOKUP', status: 'Open', total: null });
  });

  it('throws when the customer cannot be resolved from the provided information', async () => {
    const quoteSpy = jest.spyOn(QuoteService.prototype, 'createQuote');
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ matches: [] }) } as any);

    const tools = new AgentToolsV2(pool);

    await expect(
      tools.createQuote(12, {
        customer_name: 'Unknown Customer',
        product_name: 'Truck Deck',
        estimated_cost: 15000,
      })
    ).rejects.toThrow('No customers matched "Unknown Customer". Please refine the customer details or provide the customer ID.');

    expect(quoteSpy).not.toHaveBeenCalled();
  });
});

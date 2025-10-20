import type { Pool } from 'pg';
import { AgentToolsV2 } from './tools';
import { QuoteService } from '../QuoteService';

describe('AgentToolsV2.createQuote customer resolution', () => {
  let pool: jest.Mocked<Pool>;

  beforeEach(() => {
    pool = { query: jest.fn() } as unknown as jest.Mocked<Pool>;
  });

  afterEach(() => {
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
      expect.objectContaining({ customer_id: 4, product_name: 'Truck Deck' })
    );
    const lookupCalls = (pool.query as jest.Mock).mock.calls.filter((call) =>
      typeof call[0] === 'string' && call[0].includes('customermaster')
    );
    expect(lookupCalls).toHaveLength(0);
    expect(result).toEqual({ quote_id: 1, quote_number: 'QO-TEST' });
  });

  it('looks up the customer_id by name when not provided', async () => {
    const quoteSpy = jest
      .spyOn(QuoteService.prototype, 'createQuote')
      .mockResolvedValue({ quote_id: 2, quote_number: 'QO-LOOKUP' } as any);
    (pool.query as jest.Mock).mockResolvedValueOnce({ rowCount: 1, rows: [{ customer_id: 7 }] });

    const tools = new AgentToolsV2(pool);

    const result = await tools.createQuote(11, {
      customer_name: 'Test Customer',
      product_name: 'Truck Deck',
      estimated_cost: 15000,
    });

    expect(pool.query).toHaveBeenCalledWith(
      'SELECT customer_id FROM customermaster WHERE LOWER(customer_name) = LOWER($1)',
      ['Test Customer']
    );
    expect(quoteSpy).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 7 }));
    expect(result).toEqual({ quote_id: 2, quote_number: 'QO-LOOKUP' });
  });

  it('throws when the customer cannot be resolved from the provided information', async () => {
    const quoteSpy = jest.spyOn(QuoteService.prototype, 'createQuote');
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const tools = new AgentToolsV2(pool);

    await expect(
      tools.createQuote(12, {
        customer_name: 'Unknown Customer',
        product_name: 'Truck Deck',
        estimated_cost: 15000,
      })
    ).rejects.toThrow('Unable to resolve a customer_id from the provided customer information.');

    expect(quoteSpy).not.toHaveBeenCalled();
  });
});

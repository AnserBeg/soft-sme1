import { fuzzySearch } from './FuzzySearchService';

jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

const mockQuery = require('../db').pool.query as jest.Mock;

describe('fuzzySearch', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('canonicalizes vendor queries with diacritics and returns matches', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 101,
          label: 'Acme Industries',
          score: '0.89',
          canonical_value: 'ACME INDUSTRIES',
          city: 'Detroit',
          province: 'MI',
          country: 'USA',
        },
      ],
    });

    const matches = await fuzzySearch({ type: 'vendor', query: 'Âcmé Industries' });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe('ACME INDUSTRIES');
    expect(params[1]).toBe(0.35);
    expect(params[2]).toBe('ACME INDUSTRIES%');
    expect(params[3]).toBe(10);

    expect(matches).toEqual([
      {
        id: 101,
        label: 'Acme Industries',
        score: 0.89,
        extra: {
          type: 'vendor',
          canonical: 'ACME INDUSTRIES',
          city: 'Detroit',
          province: 'MI',
          country: 'USA',
        },
      },
    ]);
  });

  it('canonicalizes part queries and respects provided limits and min score', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 55,
          label: 'PN-123',
          score: 0.72,
          canonical_value: 'PN123',
          part_description: 'Hydraulic Pump',
          unit: 'EA',
          part_type: 'inventory',
        },
      ],
    });

    const matches = await fuzzySearch({ type: 'part', query: ' pn-123 ', limit: 5, minScore: 0.42 });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe('PN123');
    expect(params[1]).toBe(0.42);
    expect(params[2]).toBe('PN123%');
    expect(params[3]).toBe(5);

    expect(matches).toEqual([
      {
        id: 55,
        label: 'PN-123',
        score: 0.72,
        extra: {
          type: 'part',
          canonical: 'PN123',
          description: 'Hydraulic Pump',
          unit: 'EA',
          partType: 'inventory',
        },
      },
    ]);
  });

  it('orders exact canonical matches ahead of typo-similar results', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await fuzzySearch({ type: 'vendor', query: 'Acme' });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [text] = mockQuery.mock.calls[0];
    expect(text).toContain('similarity(canonical_name, $1)');
    expect(text).toContain('ORDER BY (canonical_name = $1) DESC, score DESC');
  });

  it('returns empty results when canonical query is empty and skips the database call', async () => {
    const matches = await fuzzySearch({ type: 'customer', query: '!!!' });

    expect(mockQuery).not.toHaveBeenCalled();
    expect(matches).toEqual([]);
  });
});

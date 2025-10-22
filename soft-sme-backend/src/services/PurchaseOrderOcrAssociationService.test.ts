import { PurchaseOrderOcrAssociationService } from './PurchaseOrderOcrAssociationService';
import { PurchaseOrderOcrNormalizedData } from './PurchaseOrderOcrService';

jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

const mockQuery = require('../db').pool.query as jest.Mock;

describe('PurchaseOrderOcrAssociationService', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prefers an existing inventory part when the canonical number already exists', async () => {
    const normalized: PurchaseOrderOcrNormalizedData = {
      vendorName: null,
      vendorAddress: null,
      billNumber: null,
      billDate: null,
      gstRate: null,
      currency: null,
      documentType: 'invoice',
      detectedKeywords: [],
      lineItems: [
        {
          rawLine: '1 ABC-123 Widget 2 EA 10 20',
          partNumber: 'ABC-123',
          description: 'Widget Assembly',
          quantity: 2,
          unit: 'EA',
          unitCost: 10,
          totalCost: 20,
        },
      ],
    };

    const partRow = {
      part_id: 101,
      part_number: 'ABC-123',
      part_description: 'Widget Assembly',
      unit: 'EA',
      last_unit_cost: 8,
      canonical_part_number: 'ABC123',
      canonical_name: 'WIDGET ASSEMBLY',
    };

    jest
      .spyOn(PurchaseOrderOcrAssociationService as any, 'findPartsByCanonicalNumbers')
      .mockResolvedValue([partRow]);
    const fuzzySpy = jest.spyOn(PurchaseOrderOcrAssociationService as any, 'findPartByFuzzy');

    const result = await PurchaseOrderOcrAssociationService.enrich({ normalized, rawText: '' });

    const match = result.normalized.lineItems[0]?.match;
    expect(match).toMatchObject({
      status: 'existing',
      partId: 101,
      matchedPartNumber: 'ABC-123',
      normalizedPartNumber: 'ABC123',
    });
    expect(result.warnings).toEqual([]);
    expect(fuzzySpy).not.toHaveBeenCalled();
  });
});

import { VoiceService } from './VoiceService';
import { Pool } from 'pg';

const buildMockPool = () => {
  const query = jest.fn();
  return { query } as unknown as Pool & { query: jest.Mock };
};

describe('VoiceService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.TELNYX_API_KEY;
    delete process.env.LIVEKIT_SIP_INGRESS_NUMBER;
    delete process.env.TELNYX_CONNECTION_ID;
    delete process.env.TELNYX_FROM_NUMBER;
  });

  it('initiates vendor call without Telnyx configuration', async () => {
    const pool = buildMockPool();
    const httpClient = { post: jest.fn() };
    const service = new VoiceService(pool, httpClient as any);

    const now = new Date();

    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ purchase_id: 1, vendor_id: 2, purchase_number: 'PO-2025-0001' }] })
      .mockResolvedValueOnce({ rows: [{ vendor_id: 2, vendor_name: 'PartsCo', telephone_number: '+15551234567' }] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 42,
            purchase_id: 1,
            vendor_id: 2,
            vendor_phone: '+15551234567',
            status: 'initiated',
            captured_email: null,
            emailed_at: null,
            structured_notes: null,
            transcript: null,
            created_at: now,
            updated_at: now,
            agent_session_id: null,
            purchase_number: 'PO-2025-0001',
            vendor_name: 'PartsCo',
          },
        ],
      });

    const result = await service.initiateVendorCall(1);

    expect(result.id).toBe(42);
    expect(result.telnyxPlaced).toBe(false);
    expect(result.purchase_number).toBe('PO-2025-0001');
    expect(httpClient.post).not.toHaveBeenCalled();
    expect((pool.query as jest.Mock).mock.calls[0][0]).toContain('FROM purchasehistory');
  });

  it('records Telnyx failure gracefully', async () => {
    process.env.TELNYX_API_KEY = 'key';
    process.env.LIVEKIT_SIP_INGRESS_NUMBER = '1001';
    process.env.TELNYX_CONNECTION_ID = 'connection';
    process.env.TELNYX_FROM_NUMBER = '+15550009999';

    const pool = buildMockPool();
    const httpClient = { post: jest.fn().mockRejectedValue(new Error('provider down')) };
    const service = new VoiceService(pool, httpClient as any);
    const now = new Date();

    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ purchase_id: 1, vendor_id: 3, purchase_number: 'PO-2025-0002' }] })
      .mockResolvedValueOnce({ rows: [{ vendor_id: 3, vendor_name: 'Vendor Inc', telephone_number: '+15551112222' }] })
      .mockResolvedValueOnce({ rows: [{ id: 77 }] })
      .mockResolvedValueOnce({ rows: [] }) // telnyx failure event insert
      .mockResolvedValueOnce({
        rows: [
          {
            id: 77,
            purchase_id: 1,
            vendor_id: 3,
            vendor_phone: '+15551112222',
            status: 'initiated',
            captured_email: null,
            emailed_at: null,
            structured_notes: null,
            transcript: null,
            created_at: now,
            updated_at: now,
            agent_session_id: null,
            purchase_number: 'PO-2025-0002',
            vendor_name: 'Vendor Inc',
          },
        ],
      });

    const session = await service.initiateVendorCall(1);

    expect(session.id).toBe(77);
    expect(session.telnyxPlaced).toBe(false);
    const calls = (pool.query as jest.Mock).mock.calls;
    const sawFailureEvent = calls.some(
      ([sql, params]) =>
        typeof sql === 'string' &&
        sql.includes('vendor_call_events') &&
        Array.isArray(params) &&
        params[1] === 'telnyx_call_failed'
    );
    expect(sawFailureEvent).toBe(true);
  });

  it('sends purchase order email and returns summary', async () => {
    const pool = buildMockPool();
    const httpClient = { post: jest.fn() };
    const service = new VoiceService(pool, httpClient as any);

    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ id: 7, purchase_id: 10, captured_email: 'vendor@example.com' }] })
      .mockResolvedValueOnce({ rows: [{ purchase_number: 'PO-2025-0003', vendor_name: 'Vendor' }] })
      .mockResolvedValueOnce({ rows: [{ part_number: 'ABC', quantity: 2, unit_cost: 3, part_description: 'Widget', unit: 'EA' }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await service.sendPurchaseOrderEmail(7);

    expect(response.success).toBe(true);
    expect(response.emailed_to).toBe('vendor@example.com');
    expect(response.purchase_number).toBe('PO-2025-0003');
    expect(response.items[0].part_number).toBe('ABC');
  });
});

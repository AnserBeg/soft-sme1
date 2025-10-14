import { AgentOrchestratorV2, AgentToolRegistry } from './orchestrator';
import { Pool } from 'pg';

describe('AgentOrchestratorV2', () => {
  const pool = {} as Pool;

  it('returns success trace for purchase order creation', async () => {
    const tools: AgentToolRegistry = {
      createPurchaseOrder: jest.fn().mockResolvedValue({ purchase_id: 101, purchase_number: 'PO-2025-00001' }),
    } as unknown as AgentToolRegistry;

    const orchestrator = new AgentOrchestratorV2(pool, tools);
    const reply = await orchestrator.handleMessage(1, 'Please create a purchase order for the vendor');

    expect(reply.type).toBe('action');
    expect(reply.traces).toBeDefined();
    expect(reply.traces?.[0].tool).toBe('createPurchaseOrder');
    expect(reply.traces?.[0].success).toBe(true);
    expect(reply.traces?.[0].message).toMatch(/purchase order/i);
    expect(reply.traces?.[0].link).toBe('/open-purchase-orders/101');
    expect(reply.catalog.some(entry => entry.name === 'createPurchaseOrder')).toBe(true);
  });

  it('returns failure trace when action tool throws', async () => {
    const tools: AgentToolRegistry = {
      createPurchaseOrder: jest.fn().mockRejectedValue(new Error('Vendor is required')),
    } as unknown as AgentToolRegistry;

    const orchestrator = new AgentOrchestratorV2(pool, tools);
    const reply = await orchestrator.handleMessage(1, 'create a PO for ACME');

    expect(reply.type).toBe('action');
    expect(reply.traces?.[0].success).toBe(false);
    expect(reply.traces?.[0].message).toMatch(/failed/i);
    expect(reply.traces?.[0].error).toBe('Vendor is required');
  });
});

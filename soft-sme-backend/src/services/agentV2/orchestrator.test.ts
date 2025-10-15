import { AgentOrchestratorV2, AgentToolRegistry } from './orchestrator';
import type { Pool } from 'pg';

describe('AgentOrchestratorV2 intent routing', () => {
  const pool = {} as Pool;

  const buildOrchestrator = (registry: Partial<AgentToolRegistry>) =>
    new AgentOrchestratorV2(pool, registry as AgentToolRegistry);

  it('routes how-to purchase order questions to documentation search', async () => {
    const retrieveDocs = jest.fn().mockResolvedValue([{ path: 'docs/po.md', section: 'Creating POs', chunk: 'Step 1' }]);
    const createPurchaseOrder = jest.fn().mockResolvedValue({ purchase_number: 'PO-2024-00001' });

    const orchestrator = buildOrchestrator({ retrieveDocs, createPurchaseOrder });

    const response = await orchestrator.handleMessage(1, 'How do I make a PO?');

    expect(retrieveDocs).toHaveBeenCalledTimes(1);
    expect(retrieveDocs).toHaveBeenCalledWith({ query: 'How do I make a PO?' });
    expect(createPurchaseOrder).not.toHaveBeenCalled();
    expect(response.events).toHaveLength(1);
    expect(response.events[0].type).toBe('docs');
  });

  it('still executes create purchase order requests phrased as commands', async () => {
    const retrieveDocs = jest.fn().mockResolvedValue([]);
    const createPurchaseOrder = jest
      .fn()
      .mockResolvedValue({ purchase_number: 'PO-2024-00002', purchase_id: 123 });

    const orchestrator = buildOrchestrator({ retrieveDocs, createPurchaseOrder });

    const response = await orchestrator.handleMessage(1, 'Please make me a PO');

    expect(createPurchaseOrder).toHaveBeenCalledTimes(1);
    expect(retrieveDocs).not.toHaveBeenCalled();
    expect(response.events).toHaveLength(1);

    const event = response.events[0];
    expect(event.type).toBe('text');
    if (event.type === 'text') {
      expect(event.content).toContain('PO-2024-00002');
    }
  });
});

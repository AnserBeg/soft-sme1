import { AgentOrchestratorV2, AgentToolRegistry } from './orchestrator';

describe('AgentOrchestratorV2 intent classification', () => {
  const createOrchestrator = (tools: Partial<AgentToolRegistry>) =>
    new AgentOrchestratorV2({} as any, tools as AgentToolRegistry);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('treats "make" phrasing as a request to create a purchase order', async () => {
    const createPurchaseOrder = jest.fn().mockResolvedValue({ message: 'Created' });
    const orchestrator = createOrchestrator({ createPurchaseOrder });

    const response = await orchestrator.handleMessage(1, 'can you help me make a po for bearings?');

    expect(createPurchaseOrder).toHaveBeenCalledTimes(1);
    expect(response.events).toHaveLength(1);
    expect(response.events[0]).toMatchObject({ type: 'text', content: 'Created' });
  });

  it('prioritizes emailing a purchase order when both "need" and "email" are present', async () => {
    const createPurchaseOrder = jest.fn();
    const emailPurchaseOrder = jest.fn().mockResolvedValue({ message: 'Sent' });
    const orchestrator = createOrchestrator({ createPurchaseOrder, emailPurchaseOrder });

    const response = await orchestrator.handleMessage(1, 'I need to email the PO to the vendor');

    expect(emailPurchaseOrder).toHaveBeenCalledTimes(1);
    expect(createPurchaseOrder).not.toHaveBeenCalled();
    expect(response.events[0]).toMatchObject({ type: 'text', content: 'Sent' });
  });
});

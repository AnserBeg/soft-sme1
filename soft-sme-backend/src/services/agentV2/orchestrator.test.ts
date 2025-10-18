import type { Pool } from 'pg';
import { AgentOrchestratorV2, AgentToolRegistry } from './orchestrator';
import aiAssistantService from '../aiAssistantService';
import { AIService } from '../aiService';

jest.mock('../aiAssistantService', () => ({
  __esModule: true,
  default: {
    sendMessage: jest.fn(),
  },
}));

describe('AgentOrchestratorV2 intent routing', () => {
  const pool = { query: jest.fn() } as unknown as Pool;
  const mockSendMessage = aiAssistantService.sendMessage as jest.Mock;

  const buildOrchestrator = (registry: Partial<AgentToolRegistry>) =>
    new AgentOrchestratorV2(pool, registry as AgentToolRegistry);

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(AIService, 'sendMessage').mockResolvedValue('fallback from test');
    (pool.query as jest.Mock).mockReset();
  });

  it('returns ai assistant response when Gemini provides a reply', async () => {
    mockSendMessage.mockResolvedValue({
      response: 'Gemini response',
      sources: [],
      confidence: 0.9,
      tool_used: 'llm',
    });

    const orchestrator = buildOrchestrator({});

    const response = await orchestrator.handleMessage(1, 'Hello there', { companyId: 1, userId: 2 });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(response.events).toHaveLength(1);
    expect(response.events[0]).toMatchObject({ type: 'text', content: 'Gemini response' });
  });

  it('falls back to documentation search when the ai assistant returns no text', async () => {
    mockSendMessage.mockResolvedValue({ response: '   ', sources: [], confidence: 0, tool_used: 'llm' });

    const retrieveDocs = jest.fn().mockResolvedValue([{ path: 'docs/po.md', section: 'Creating POs', chunk: 'Step 1' }]);
    const orchestrator = buildOrchestrator({ retrieveDocs });

    const response = await orchestrator.handleMessage(2, 'How do I make a PO?', { companyId: 1, userId: 2 });

    expect(retrieveDocs).toHaveBeenCalledTimes(1);
    expect(response.events[0].type).toBe('docs');
  });

  it('treats help requests for quotes as documentation lookups instead of actions', async () => {
    mockSendMessage.mockResolvedValue({ response: '', sources: [], confidence: 0, tool_used: 'llm' });

    const retrieveDocs = jest.fn().mockResolvedValue([{ path: 'docs/quotes.md', section: 'Creating quotes', chunk: 'Step 1' }]);
    const createQuote = jest.fn();
    const orchestrator = buildOrchestrator({ retrieveDocs, createQuote });

    const response = await orchestrator.handleMessage(4, 'Help me make a quote', { companyId: 1, userId: 2 });

    expect(retrieveDocs).toHaveBeenCalledTimes(1);
    expect(createQuote).not.toHaveBeenCalled();
    expect(response.events[0].type).toBe('docs');
  });

  it('executes registered tools for agent-origin instructions', async () => {
    mockSendMessage.mockResolvedValue({ response: '', sources: [], confidence: 0, tool_used: 'llm' });

    const createPurchaseOrder = jest
      .fn()
      .mockResolvedValue({ purchase_number: 'PO-2024-00002', purchase_id: 123 });

    const orchestrator = buildOrchestrator({ createPurchaseOrder });

    const response = await orchestrator.handleMessage(
      3,
      'createPurchaseOrder',
      { companyId: 1, userId: 2 },
      { origin: 'agent' }
    );

    expect(createPurchaseOrder).toHaveBeenCalledTimes(1);
    expect(response.reply).toBeDefined();
    expect(response.reply?.traces?.[0]?.tool).toBe('createPurchaseOrder');
  });
});

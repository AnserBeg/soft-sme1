import type { Pool } from 'pg';
import { AgentOrchestratorV2, AgentToolRegistry } from './orchestrator';
import { AgentAnalyticsLogger } from './analyticsLogger';
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

  describe('Answer composer integration', () => {
    let logEventSpy: jest.SpyInstance;
    let summarySpy: jest.SpyInstance;
    let counterSpy: jest.SpyInstance;

    const buildComposerOrchestrator = (toolImpl: any) =>
      new AgentOrchestratorV2(pool, { inventoryLookup: toolImpl } as AgentToolRegistry);

    const mockIntent = (instance: AgentOrchestratorV2) => {
      jest.spyOn(instance as any, 'classifyIntent').mockResolvedValue({ tool: 'inventoryLookup', args: {} });
    };

    beforeEach(() => {
      logEventSpy = jest.spyOn(AgentAnalyticsLogger.prototype as any, 'logEvent').mockResolvedValue(undefined);
      summarySpy = jest.spyOn(AgentAnalyticsLogger.prototype, 'logResponseSummary');
      counterSpy = jest.spyOn(AgentAnalyticsLogger.prototype, 'incrementCounter');
      mockSendMessage.mockResolvedValue({ response: '', sources: [], confidence: 0, tool_used: 'none' });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('composes success envelopes into actionable responses', async () => {
      const tool = jest.fn().mockResolvedValue({
        type: 'success',
        source: 'database',
        query: { entity_type: 'vendor', entity_name: 'Parts for Truck Inc' },
        rows: [
          {
            vendor_id: 42,
            vendor_name: 'Parts for Truck Inc',
            contact_person: 'Mira Patel',
            telephone_number: '555-0100',
          },
        ],
        total_rows: 1,
        attempts: { exact: true, fuzzy: false, schema_refreshed: false },
      });

      const orchestrator = buildComposerOrchestrator(tool);
      mockIntent(orchestrator);

      const response = await orchestrator.handleMessage(11, 'find vendor parts', { companyId: 1, userId: 2 });

      expect(tool).toHaveBeenCalledTimes(1);
      expect(response.events[0].content).toContain("Vendor 'Parts for Truck Inc' found (1 record).");
      expect(response.events[0].uiHints).toBeDefined();
      expect(response.events[0].severity).toBe('info');
      expect(summarySpy).toHaveBeenCalledWith(
        11,
        'inventoryLookup',
        expect.objectContaining({
          response_mode: 'success',
          candidates_count: 0,
          provided_next_steps: true,
        })
      );
      expect(counterSpy).not.toHaveBeenCalled();
      expect(logEventSpy).toHaveBeenCalled();
    });

    it('composes disambiguation envelopes with numbered options', async () => {
      const tool = jest.fn().mockResolvedValue({
        type: 'disambiguation',
        source: 'database',
        query: { entity_type: 'vendor', entity_name: 'Parts' },
        candidates: [
          { id: 42, display_name: 'Parts for Truck Inc', city: 'Calgary' },
          { id: 77, display_name: 'Parts 4 Trucks Incorporated', city: 'Edmonton' },
          { id: 88, display_name: 'Partsource', city: 'Red Deer' },
        ],
        attempts: { exact: true, fuzzy: true, schema_refreshed: false },
      });

      const orchestrator = buildComposerOrchestrator(tool);
      mockIntent(orchestrator);

      const response = await orchestrator.handleMessage(12, 'find vendor parts', { companyId: 1, userId: 2 });

      expect(response.events[0].content).toContain('Did you mean one of these vendors?');
      expect(response.events[0].content).toContain('Reply with the number or the exact name.');
      expect(summarySpy).toHaveBeenCalledWith(
        12,
        'inventoryLookup',
        expect.objectContaining({ response_mode: 'disambiguation', candidates_count: 3, provided_next_steps: false })
      );
      expect(counterSpy).not.toHaveBeenCalled();
    });

    it('captures empty envelopes with attempt telemetry and counter', async () => {
      const tool = jest.fn().mockResolvedValue({
        type: 'empty',
        source: 'database',
        query: { entity_type: 'vendor', entity_name: 'Unknown Vendor' },
        attempts: { exact: true, fuzzy: true, schema_refreshed: false },
      });

      const orchestrator = buildComposerOrchestrator(tool);
      mockIntent(orchestrator);

      const response = await orchestrator.handleMessage(13, 'find unknown vendor', { companyId: 1, userId: 2 });

      expect(response.events[0].content).toContain("No vendor named 'Unknown Vendor' was found.");
      expect(response.events[0].content).toContain('What I tried:');
      expect(response.events[0].severity).toBe('warning');
      expect(summarySpy).toHaveBeenCalledWith(
        13,
        'inventoryLookup',
        expect.objectContaining({ response_mode: 'empty', provided_next_steps: true })
      );
      expect(counterSpy).toHaveBeenCalledWith(13, 'empty_with_fuzzy_attempted');
    });

    it('returns categorized error guidance for tool errors', async () => {
      const tool = jest.fn().mockResolvedValue({
        type: 'error',
        source: 'database',
        query: { entity_type: 'vendor', entity_name: 'Parts' },
        attempts: { exact: true, fuzzy: false, schema_refreshed: false },
        error: { code: 'PERMISSION_DENIED', message: 'not allowed' },
      });

      const orchestrator = buildComposerOrchestrator(tool);
      mockIntent(orchestrator);

      const response = await orchestrator.handleMessage(14, 'find vendor parts', { companyId: 1, userId: 2 });

      expect(response.events[0].content).toContain("I don't have permission to view this data.");
      expect(response.events[0].severity).toBe('error');
      expect(summarySpy).toHaveBeenCalledWith(
        14,
        'inventoryLookup',
        expect.objectContaining({ response_mode: 'error', provided_next_steps: false })
      );
      expect(counterSpy).not.toHaveBeenCalled();
    });
  });
});

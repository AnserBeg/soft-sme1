const startToolTraceMock = jest.fn().mockImplementation((sessionId: number, tool: string) => ({
  traceId: `trace-${tool}`,
  sessionId,
  tool,
  startedAt: 0,
  metadata: {},
}));
const finishToolTraceMock = jest.fn();

jest.mock('../analyticsLogger', () => ({
  AgentAnalyticsLogger: jest.fn().mockImplementation(() => ({
    startToolTrace: startToolTraceMock,
    finishToolTrace: finishToolTraceMock,
    logEvent: jest.fn(),
    logFallback: jest.fn(),
    logRoutingMiss: jest.fn(),
    logResponseSummary: jest.fn(),
    incrementCounter: jest.fn(),
  })),
}));

const sendMessageMock = jest.fn().mockResolvedValue(null);

jest.mock('../aiAssistantService', () => ({
  __esModule: true,
  default: { sendMessage: sendMessageMock },
}));

import { AgentOrchestratorV2 } from '../orchestrator';

describe('AgentOrchestratorV2 tool schema validation', () => {
  beforeEach(() => {
    startToolTraceMock.mockClear();
    finishToolTraceMock.mockClear();
    sendMessageMock.mockClear();
  });

  it('emits an error event and skips service call when quote.create args are invalid', async () => {
    const pool = { query: jest.fn() } as any;
    const quoteCreate = jest.fn();
    const orchestrator = new AgentOrchestratorV2(pool, { 'quote.create': quoteCreate });

    jest.spyOn(orchestrator as any, 'classifyIntent').mockResolvedValue({
      tool: 'quote.create',
      args: {
        customer_id: 42,
        line_items: [
          {
            part_id: 11,
            qty: -1,
            unit_price: 125,
          },
        ],
      },
    });

    const response = await orchestrator.handleMessage(123, 'create a quote', {});

    expect(sendMessageMock).toHaveBeenCalled();
    expect(quoteCreate).not.toHaveBeenCalled();
    expect(response.events).toHaveLength(1);
    const [event] = response.events;
    expect(event.type).toBe('text');
    expect(event.severity).toBe('error');
    expect(event.content).toContain('Invalid arguments for tool "quote.create"');
    expect(event.content).toContain('Number must be greater than 0');
    expect(finishToolTraceMock).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: expect.any(String) }),
      expect.objectContaining({ status: 'failure' })
    );
  });

  it('emits an error for quote.update when patch has wrong types', async () => {
    const pool = { query: jest.fn() } as any;
    const quoteUpdate = jest.fn();
    const orchestrator = new AgentOrchestratorV2(pool, { 'quote.update': quoteUpdate });

    jest.spyOn(orchestrator as any, 'classifyIntent').mockResolvedValue({
      tool: 'quote.update',
      args: {
        quote_id: 42,
        patch: { status: 'INVALID_STATUS' },
      },
    });

    const response = await orchestrator.handleMessage(999, 'update quote', {});

    expect(quoteUpdate).not.toHaveBeenCalled();
    expect(response.events).toHaveLength(1);
    expect(response.events[0].type).toBe('text');
    expect(response.events[0].severity).toBe('error');
    expect(response.events[0].content).toContain('Invalid arguments for tool "quote.update"');
    expect(response.events[0].content).toContain('Invalid enum value');
    expect(finishToolTraceMock).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: expect.any(String) }),
      expect.objectContaining({ status: 'failure' })
    );
  });

  it('emits an error for quote.update when patch includes unknown fields', async () => {
    const pool = { query: jest.fn() } as any;
    const quoteUpdate = jest.fn();
    const orchestrator = new AgentOrchestratorV2(pool, { 'quote.update': quoteUpdate });

    jest.spyOn(orchestrator as any, 'classifyIntent').mockResolvedValue({
      tool: 'quote.update',
      args: {
        quote_id: 99,
        patch: { notes: 'hello', unexpected: 'nope' },
      },
    });

    const response = await orchestrator.handleMessage(321, 'update quote', {});

    expect(quoteUpdate).not.toHaveBeenCalled();
    expect(response.events).toHaveLength(1);
    expect(response.events[0].type).toBe('text');
    expect(response.events[0].severity).toBe('error');
    expect(response.events[0].content).toContain('Invalid arguments for tool "quote.update"');
    expect(response.events[0].content).toContain('Unrecognized key(s) in object');
    expect(finishToolTraceMock).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: expect.any(String) }),
      expect.objectContaining({ status: 'failure' })
    );
  });
});

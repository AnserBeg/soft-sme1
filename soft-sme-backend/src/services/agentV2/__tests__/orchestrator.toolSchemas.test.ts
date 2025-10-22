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
});

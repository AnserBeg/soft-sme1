jest.mock('../../db', () => {
  const mockClient = { query: jest.fn(), release: jest.fn() };
  return {
    pool: {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue(mockClient),
    },
  };
});

jest.mock('../../middleware/authMiddleware', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const handleMessageMock = jest.fn();

jest.mock('../../services/agentV2/orchestrator', () => ({
  AgentOrchestratorV2: jest.fn().mockImplementation(() => ({
    handleMessage: handleMessageMock,
    getToolCatalog: jest.fn().mockReturnValue([]),
  })),
}));

import type { Request, Response } from 'express';
import router from '../agentV2Routes';

describe('agentV2Routes validation', () => {
  beforeEach(() => {
    handleMessageMock.mockReset();
  });

  const getChatHandler = () => {
    const layer = (router as any).stack.find((entry: any) => entry.route?.path === '/chat');
    if (!layer) {
      throw new Error('Chat route not registered');
    }
    const postLayer = layer.route.stack.find((stackLayer: any) => stackLayer.method === 'post');
    if (!postLayer) {
      throw new Error('Chat POST handler not found');
    }
    return postLayer.handle as (req: Request, res: Response, next: () => void) => Promise<void>;
  };

  it('returns 422 with validation issues for empty message', async () => {
    const handler = getChatHandler();
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const res = { status, json } as unknown as Response;

    const req = {
      body: { sessionId: 'x', message: '' },
      headers: {},
    } as unknown as Request;

    await handler(req, res, jest.fn());

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Invalid payload',
        issues: expect.objectContaining({
          fieldErrors: expect.objectContaining({
            sessionId: expect.arrayContaining(['A positive integer sessionId is required.']),
            message: expect.arrayContaining(['Message is required.']),
          }),
        }),
      })
    );
  });

  it('returns 422 when tool invocation is missing quote_id', async () => {
    const handler = getChatHandler();
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const res = { status, json } as unknown as Response;

    const req = {
      body: { sessionId: 1, message: 'please close quote 123', userId: 5, companyId: 8 },
      headers: {},
    } as unknown as Request;

    handleMessageMock.mockRejectedValueOnce(new Error('quote_id is required'));

    await handler(req, res, jest.fn());

    expect(handleMessageMock).toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({ error: 'quote_id is required' });
  });
});

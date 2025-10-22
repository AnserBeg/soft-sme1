import type { Response as ExpressResponse } from 'express';
import { ReadableStream } from 'stream/web';

const mockPoolClient = { query: jest.fn(), release: jest.fn() };

jest.mock('../../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn().mockResolvedValue(mockPoolClient),
  },
}));

jest.mock('../aiConversationManager', () => ({
  ConversationManager: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../aiTaskQueueService', () => ({
  AITaskQueueService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../config', () => ({
  getDocsConfig: () => ({ requireCitations: false }),
  getFuzzyConfig: () => ({ minScoreAuto: 0.5, minScoreShow: 0.25, maxResults: 5 }),
}));

jest.mock('../aiService', () => ({
  AIService: { sendMessage: jest.fn().mockResolvedValue('fallback') },
}));

import AIAssistantService from '../aiAssistantService';

describe('AIAssistantService stream validation', () => {
  it('closes the stream with an error event when payload is missing a type', async () => {
    const service = Object.create(AIAssistantService.prototype) as AIAssistantService;
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"text":"hello"}\n\n'));
        controller.close();
      },
    });

    const sourceResponse = { body: stream } as unknown as globalThis.Response;

    const writes: string[] = [];
    const response = {
      writableEnded: false,
      write: jest.fn((chunk: string) => {
        writes.push(chunk);
        return true;
      }),
      flush: jest.fn(),
      end: jest.fn(function (this: { writableEnded: boolean }) {
        this.writableEnded = true;
      }),
    } as unknown as ExpressResponse & { writableEnded: boolean };

    await (service as any).forwardAgentStreamWithValidation(sourceResponse, response);

    const errorEvent = writes.find((chunk) => chunk.startsWith('event: error'));
    expect(errorEvent).toBeDefined();
    expect(errorEvent).toContain('Invalid event payload from agent stream');
    expect((response.end as jest.Mock)).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

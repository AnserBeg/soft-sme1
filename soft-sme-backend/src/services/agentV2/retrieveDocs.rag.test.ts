import type { Pool } from 'pg';
import { AgentToolsV2 } from './tools';
import { AgentAnalyticsLogger } from './analyticsLogger';
import { queryDocsRag } from '../../services/ragClient';
import type { RagResponse } from '../../services/ragClient';

jest.mock('../../services/ragClient', () => ({
  queryDocsRag: jest.fn(),
}));

describe('AgentToolsV2.retrieveDocs RAG mode', () => {
  const originalEnv = process.env.DOCS_RAG_MODE;
  const mockQueryDocsRag = queryDocsRag as jest.MockedFunction<typeof queryDocsRag>;

  beforeEach(() => {
    process.env.DOCS_RAG_MODE = 'python';
    mockQueryDocsRag.mockResolvedValue({
      answer: 'A',
      citations: [{ title: 'T', path: '/p', score: 0.9 }],
      chunks: [],
    } as RagResponse);
    jest.spyOn(AgentAnalyticsLogger.prototype, 'incrementCounter').mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.DOCS_RAG_MODE = originalEnv;
    jest.restoreAllMocks();
  });

  it('returns documentation citations when RAG succeeds', async () => {
    const pool = { query: jest.fn() } as unknown as Pool;
    const tools = new AgentToolsV2(pool);

    const result = await tools.retrieveDocs(1, 'how to create a quote');

    expect(mockQueryDocsRag).toHaveBeenCalledWith('how to create a quote', 5);
    expect(result.type).toBe('docs');
    expect(result.citations).toHaveLength(1);
  });
});

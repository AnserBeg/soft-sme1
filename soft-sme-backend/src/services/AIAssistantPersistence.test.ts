import { Pool } from 'pg';
import { ConversationManager } from './aiConversationManager';
import { AITaskQueueService } from './aiTaskQueueService';
import AITaskWorker from '../workers/aiTaskWorker';

const describeIfDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

if (!process.env.TEST_DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('Skipping AI assistant persistence tests because TEST_DATABASE_URL is not set.');
}

describeIfDb('AI Assistant persistence', () => {
  let pool: Pool;
  let conversationManager: ConversationManager;
  let queue: AITaskQueueService;
  let worker: AITaskWorker;
  let conversationId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    conversationManager = new ConversationManager(pool);
    queue = new AITaskQueueService(pool);
    worker = new AITaskWorker(pool);

    conversationId = await conversationManager.ensureConversation(undefined, 9999);
    await conversationManager.addMessage(conversationId, 'user', 'Hello persistence test');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_docs (
        id SERIAL PRIMARY KEY,
        path TEXT,
        section TEXT,
        chunk TEXT
      )
    `);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM ai_messages WHERE conversation_id = $1', [conversationId]);
    await pool.query('DELETE FROM ai_conversations WHERE id = $1', [conversationId]);
    await pool.query("DELETE FROM ai_task_queue WHERE conversation_id = $1", [conversationId]);
    await pool.end();
  });

  test('conversation history survives manager reinstantiation', async () => {
    const firstHistory = await conversationManager.getConversationHistory(conversationId);
    expect(firstHistory).toHaveLength(1);

    const newManager = new ConversationManager(pool);
    const restored = await newManager.getConversationHistory(conversationId);
    expect(restored).toHaveLength(1);
    const restoredText = (restored[0] as any).content ?? (restored[0] as any).text;
    expect(restoredText).toBeDefined();
    expect(restoredText).toContain('Hello persistence test');
  });

  test('task queue executes and logs to conversation', async () => {
    const taskId = await queue.enqueueTask(
      'agent_tool',
      { tool: 'retrieveDocs', args: ['test', 1] },
      conversationId
    );

    const ran = await worker.runOnce();
    expect(ran).toBe(true);

    const task = await queue.getTaskById(taskId);
    expect(task?.status).toBe('completed');

    const history = await conversationManager.getConversationHistory(conversationId, 10);
    const hasUpdate = history.some(msg => {
      const role = (msg as any).role;
      const isAssistant = role ? role !== 'user' : (msg as any).is_user === false;
      if (!isAssistant) {
        return false;
      }

      const text = (msg as any).content ?? (msg as any).text;
      return typeof text === 'string' && text.includes('Follow-up task');
    });
    expect(hasUpdate).toBe(true);
  });
});

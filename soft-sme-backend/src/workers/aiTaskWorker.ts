import { Pool } from 'pg';
import { pool } from '../db';
import { ConversationManager } from '../services/aiConversationManager';
import { AITaskQueueService, TaskRecord } from '../services/aiTaskQueueService';
import { AgentToolsV2 } from '../services/agentV2/tools';
import { ConversationSummarizer } from '../services/conversationSummarizer';

interface AgentToolPayload {
  tool: string;
  sessionId?: number;
  args?: Record<string, unknown>;
  [key: string]: unknown;
}

export class AITaskWorker {
  private readonly queue: AITaskQueueService;
  private readonly conversationManager: ConversationManager;
  private readonly tools: AgentToolsV2;
  private readonly summarizer: ConversationSummarizer;

  constructor(private readonly db: Pool = pool) {
    this.queue = new AITaskQueueService(db);
    this.conversationManager = new ConversationManager(db);
    this.tools = new AgentToolsV2(db);
    this.summarizer = new ConversationSummarizer(db);
  }

  async runOnce(): Promise<boolean> {
    const task = await this.queue.claimNextTask();

    if (!task) {
      return false;
    }

    try {
      const result = await this.executeTask(task);
      await this.queue.markTaskComplete(task.id, { success: true });
      await this.appendConversationUpdate(task, 'completed', result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.queue.markTaskComplete(task.id, { success: false, error: errorMessage });
      await this.appendConversationUpdate(task, 'failed', { error: errorMessage });
    }

    return true;
  }

  private async executeTask(task: TaskRecord): Promise<unknown> {
    if (task.taskType === 'agent_tool') {
      return this.executeAgentTool(task.payload as AgentToolPayload);
    }

    if (task.taskType === 'conversation_summary') {
      if (!task.conversationId) {
        throw new Error('Conversation summary task requires a conversation id');
      }

      const payload = task.payload ?? {};
      const force = (payload as { force?: unknown }).force === true;
      const rawMax = (payload as { maxMessages?: unknown }).maxMessages;
      const maxMessages =
        typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax > 0
          ? Math.min(Math.floor(rawMax), 500)
          : undefined;

      return this.summarizer.summarizeConversation(task.conversationId, {
        force,
        maxMessages
      });
    }

    throw new Error(`Unsupported task type: ${task.taskType}`);
  }

  private async executeAgentTool(payload: AgentToolPayload): Promise<unknown> {
    const toolName = payload.tool;
    if (!toolName) {
      throw new Error('Agent tool payload missing "tool" field');
    }

    const fn = (this.tools as unknown as Record<string, unknown>)[toolName];
    if (typeof fn !== 'function') {
      throw new Error(`Agent tool "${toolName}" is not supported`);
    }

    const params: unknown[] = [];

    if (typeof payload.sessionId === 'number') {
      params.push(payload.sessionId);
    }

    if (Array.isArray(payload.args)) {
      params.push(...payload.args);
    } else if (payload.args !== undefined) {
      params.push(payload.args);
    } else if (params.length === 0) {
      // Ensure at least one argument is provided for tools expecting an object payload
      params.push({});
    }

    return await (fn as (...args: any[]) => Promise<unknown>).apply(this.tools, params);
  }

  private async appendConversationUpdate(
    task: TaskRecord,
    status: 'completed' | 'failed',
    details: Record<string, unknown> | unknown
  ): Promise<void> {
    if (!task.conversationId || task.taskType === 'conversation_summary') {
      return;
    }

    const summary =
      status === 'completed'
        ? `✅ Follow-up task ${task.taskType} finished successfully.`
        : `❌ Follow-up task ${task.taskType} failed.`;

    const metadata = {
      taskId: task.id,
      status,
      details,
      attempts: task.attempts
    };

    await this.conversationManager.addMessage(task.conversationId, 'assistant', summary, metadata);
  }
}

export default AITaskWorker;

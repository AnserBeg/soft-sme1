import { Pool, PoolClient } from 'pg';
import { TaskInput, TaskService, TaskUpdate, TaskWithRelations, CreateTaskOptions } from '../TaskService';
import { TaskMessageService, TaskParticipant, Queryable, TaskMessage } from '../TaskMessageService';

interface AgentTaskPayload extends TaskInput {
  followUp?: string;
}

interface AgentTaskUpdate extends TaskUpdate {
  note?: string;
}

export interface AgentTaskEvent {
  type: 'task_created' | 'task_updated' | 'task_message';
  task: TaskWithRelations;
  summary: string;
  messageId?: number;
}

export class AgentTaskFacade {
  private taskService: TaskService;
  private messageService: TaskMessageService;

  constructor(private readonly pool: Pool) {
    this.taskService = new TaskService(pool);
    this.messageService = new TaskMessageService(pool);
  }

  async createTask(
    sessionId: number,
    companyId: number,
    userId: number,
    payload: AgentTaskPayload,
    client?: PoolClient
  ): Promise<AgentTaskEvent> {
    const options: CreateTaskOptions = {
      createdByAgent: true,
      agentSessionId: sessionId,
    };

    const db: Queryable = client ?? this.pool;
    const messageService = client ? new TaskMessageService(client) : this.messageService;

    const task = await this.taskService.createTask(companyId, userId, payload, options, client);

    await this.subscribe(db, sessionId, task.id, userId, task.status);
    const participant = await this.ensureParticipant(db, messageService, task.id, userId);

    const followUp = payload.followUp?.trim();
    if (followUp) {
      await this.createAgentMessage(messageService, task.id, participant, followUp, 'follow_up');
    } else {
      await this.createAgentMessage(
        messageService,
        task.id,
        participant,
        'Workspace Copilot created this task to track your request. I\'ll share updates here as things change.',
        'creation'
      );
    }

    return {
      type: 'task_created',
      task,
      summary: `Created task "${task.title}" with status ${task.status}.`,
    };
  }

  async updateTask(
    sessionId: number,
    companyId: number,
    userId: number,
    taskId: number,
    updates: AgentTaskUpdate,
    client?: PoolClient
  ): Promise<AgentTaskEvent> {
    const db: Queryable = client ?? this.pool;
    const messageService = client ? new TaskMessageService(client) : this.messageService;

    const task = await this.taskService.updateTask(companyId, taskId, updates, client);
    await this.subscribe(db, sessionId, taskId, userId, task.status);

    if (updates.note && updates.note.trim()) {
      const participant = await this.ensureParticipant(db, messageService, taskId, userId);
      await this.createAgentMessage(
        messageService,
        taskId,
        participant,
        updates.note.trim(),
        'status_update'
      );
    }

    return {
      type: 'task_updated',
      task,
      summary: `Updated task "${task.title}" to status ${task.status}.`,
    };
  }

  async postMessage(
    sessionId: number,
    companyId: number,
    userId: number,
    taskId: number,
    content: string,
    metadataType: string = 'comment',
    client?: PoolClient
  ): Promise<AgentTaskEvent> {
    const db: Queryable = client ?? this.pool;
    const messageService = client ? new TaskMessageService(client) : this.messageService;

    const task = await this.taskService.getTask(companyId, taskId, client);
    await this.subscribe(db, sessionId, taskId, userId, task.status);
    const participant = await this.ensureParticipant(db, messageService, taskId, userId);
    const trimmed = content.trim();
    let message: TaskMessage | null = null;
    if (trimmed) {
      message = await this.createAgentMessage(
        messageService,
        taskId,
        participant,
        trimmed,
        metadataType
      );
    }
    return {
      type: 'task_message',
      task,
      summary: trimmed || 'Shared an update in task chat.',
      messageId: message?.id,
    };
  }

  private async subscribe(
    db: Queryable,
    sessionId: number,
    taskId: number,
    userId: number,
    status: string
  ): Promise<void> {
    await db.query(
      `
        INSERT INTO agent_task_subscriptions (session_id, task_id, subscribed_by, last_notified_status)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (session_id, task_id)
        DO UPDATE SET
          active = TRUE,
          subscribed_at = CURRENT_TIMESTAMP,
          subscribed_by = EXCLUDED.subscribed_by,
          last_notified_status = EXCLUDED.last_notified_status
      `,
      [sessionId, taskId, userId, status]
    );
  }

  private async ensureParticipant(
    db: Queryable,
    messageService: TaskMessageService,
    taskId: number,
    userId: number
  ): Promise<TaskParticipant> {
    await db.query(
      `
        INSERT INTO task_participants (task_id, user_id, role, is_watcher)
        VALUES ($1, $2, 'requester', TRUE)
        ON CONFLICT (task_id, user_id) DO UPDATE SET is_watcher = TRUE
      `,
      [taskId, userId]
    );

    return messageService.ensureParticipant(taskId, userId);
  }

  private async createAgentMessage(
    messageService: TaskMessageService,
    taskId: number,
    participant: TaskParticipant,
    content: string,
    reason: string
  ): Promise<TaskMessage> {
    return messageService.createMessage(
      taskId,
      participant,
      content,
      { agent: true, reason },
      [],
      true
    );
  }

  async hydrateTaskEvent(
    type: AgentTaskEvent['type'],
    companyId: number,
    taskId: number,
    identifiers: { messageId?: number },
    client?: PoolClient
  ): Promise<AgentTaskEvent> {
    const db: Queryable = client ?? this.pool;
    const task = await this.taskService.getTask(companyId, taskId, client);

    let summary: string;
    let messageId: number | undefined;

    switch (type) {
      case 'task_created':
        summary = `Created task "${task.title}" with status ${task.status}.`;
        break;
      case 'task_updated':
        summary = `Updated task "${task.title}" to status ${task.status}.`;
        break;
      case 'task_message': {
        messageId = identifiers.messageId;
        let content: string | null = null;
        if (messageId != null) {
          content = await this.fetchMessageContent(db, taskId, messageId);
        }
        const trimmed = content?.trim() ?? '';
        summary = trimmed || 'Shared an update in task chat.';
        break;
      }
      default:
        summary = '';
    }

    const event: AgentTaskEvent = {
      type,
      task,
      summary,
    };

    if (messageId != null) {
      event.messageId = messageId;
    }

    return event;
  }

  private async fetchMessageContent(
    db: Queryable,
    taskId: number,
    messageId: number
  ): Promise<string | null> {
    const result = await db.query<{ content: string | null }>(
      'SELECT content FROM task_messages WHERE id = $1 AND task_id = $2',
      [messageId, taskId]
    );

    if (result.rowCount === 0) {
      return null;
    }

    return result.rows[0]?.content ?? null;
  }
}

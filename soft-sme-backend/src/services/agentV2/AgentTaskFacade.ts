import { Pool } from 'pg';
import { TaskInput, TaskService, TaskUpdate, TaskWithRelations, CreateTaskOptions } from '../TaskService';
import { TaskMessageService, TaskParticipant } from '../TaskMessageService';

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
    payload: AgentTaskPayload
  ): Promise<AgentTaskEvent> {
    const options: CreateTaskOptions = {
      createdByAgent: true,
      agentSessionId: sessionId,
    };

    const task = await this.taskService.createTask(companyId, userId, payload, options);

    await this.subscribe(sessionId, task.id, userId, task.status);
    await this.ensureParticipant(task.id, userId);

    const followUp = payload.followUp?.trim();
    if (followUp) {
      await this.createAgentMessage(task.id, userId, followUp, 'follow_up');
    } else {
      await this.createAgentMessage(
        task.id,
        userId,
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
    updates: AgentTaskUpdate
  ): Promise<AgentTaskEvent> {
    const task = await this.taskService.updateTask(companyId, taskId, updates);
    await this.subscribe(sessionId, taskId, userId, task.status);

    if (updates.note && updates.note.trim()) {
      await this.ensureParticipant(taskId, userId);
      await this.createAgentMessage(taskId, userId, updates.note.trim(), 'status_update');
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
    metadataType: string = 'comment'
  ): Promise<AgentTaskEvent> {
    const task = await this.taskService.getTask(companyId, taskId);
    await this.subscribe(sessionId, taskId, userId, task.status);
    await this.ensureParticipant(taskId, userId);
    const trimmed = content.trim();
    if (trimmed) {
      await this.createAgentMessage(taskId, userId, trimmed, metadataType);
    }
    return {
      type: 'task_message',
      task,
      summary: trimmed || 'Shared an update in task chat.',
    };
  }

  private async subscribe(
    sessionId: number,
    taskId: number,
    userId: number,
    status: string
  ): Promise<void> {
    await this.pool.query(
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

  private async ensureParticipant(taskId: number, userId: number): Promise<TaskParticipant> {
    await this.pool.query(
      `
        INSERT INTO task_participants (task_id, user_id, role, is_watcher)
        VALUES ($1, $2, 'requester', TRUE)
        ON CONFLICT (task_id, user_id) DO UPDATE SET is_watcher = TRUE
      `,
      [taskId, userId]
    );

    return this.messageService.ensureParticipant(taskId, userId);
  }

  private async createAgentMessage(
    taskId: number,
    userId: number,
    content: string,
    reason: string
  ): Promise<void> {
    const participant = await this.ensureParticipant(taskId, userId);
    await this.messageService.createMessage(
      taskId,
      participant,
      content,
      { agent: true, reason },
      [],
      true
    );
  }
}

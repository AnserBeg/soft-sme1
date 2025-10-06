import { Pool, QueryResult, QueryResultRow } from 'pg';

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(queryText: string, params?: any[]): Promise<QueryResult<T>>;
}

export interface TaskParticipant {
  id: number;
  taskId: number;
  userId: number;
  role: string | null;
  isWatcher: boolean;
  lastReadAt: string | null;
  lastReadMessageId: number | null;
  companyId: number | null;
  taskTitle?: string | null;
  taskStatus?: string | null;
}

export interface TaskMessageSender {
  participantId: number;
  userId: number | null;
  name: string | null;
  email: string | null;
}

export interface TaskMessage {
  id: number;
  taskId: number;
  participantId: number;
  content: string;
  isSystem: boolean;
  attachments: any[];
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  sender: TaskMessageSender;
}

export class TaskAccessError extends Error {
  constructor(message: string, public code: 'NOT_PARTICIPANT' | 'TASK_NOT_FOUND') {
    super(message);
    this.name = 'TaskAccessError';
  }
}

export class TaskMessageService {
  private db: Queryable;

  constructor(pool: Queryable | Pool) {
    this.db = pool;
  }

  async ensureParticipant(taskId: number, userId: number): Promise<TaskParticipant> {
    const result = await this.db.query(
      `SELECT
        tp.id AS participant_id,
        tp.task_id,
        tp.user_id,
        tp.role,
        tp.is_watcher,
        tp.last_read_at,
        tp.last_read_message_id,
        t.company_id,
        t.title AS task_title,
        t.status AS task_status
      FROM task_participants tp
      INNER JOIN tasks t ON t.id = tp.task_id
      WHERE tp.task_id = $1
        AND tp.user_id = $2
        AND COALESCE(t.is_archived, FALSE) = FALSE`,
      [taskId, userId]
    );

    if (result.rowCount === 0) {
      throw new TaskAccessError('User is not a participant on this task', 'NOT_PARTICIPANT');
    }

    const row = result.rows[0];

    return {
      id: Number(row.participant_id),
      taskId: Number(row.task_id),
      userId: Number(row.user_id),
      role: row.role ?? null,
      isWatcher: Boolean(row.is_watcher),
      lastReadAt: row.last_read_at ? new Date(row.last_read_at).toISOString() : null,
      lastReadMessageId: row.last_read_message_id != null ? Number(row.last_read_message_id) : null,
      companyId: row.company_id != null ? Number(row.company_id) : null,
      taskTitle: row.task_title ?? null,
      taskStatus: row.task_status ?? null,
    };
  }

  async listMessages(
    taskId: number,
    participant: TaskParticipant,
    afterMessageId?: number
  ): Promise<{ messages: TaskMessage[]; unreadCount: number }> {
    const params: any[] = [taskId];
    let filter = '';

    if (afterMessageId && Number.isFinite(afterMessageId)) {
      params.push(afterMessageId);
      filter = ' AND tm.id > $2';
    }

    const messageResult = await this.db.query(
      `SELECT
        tm.id,
        tm.task_id,
        tm.participant_id,
        tm.content,
        tm.is_system,
        tm.attachments,
        tm.metadata,
        tm.created_at,
        tm.updated_at,
        tp.user_id,
        u.name AS sender_name,
        u.email AS sender_email
      FROM task_messages tm
      INNER JOIN task_participants tp ON tp.id = tm.participant_id
      LEFT JOIN users u ON u.id = tp.user_id
      WHERE tm.task_id = $1${filter}
      ORDER BY tm.created_at ASC, tm.id ASC`,
      params
    );

    const messages = messageResult.rows.map((row) => this.mapMessageRow(row));

    const unreadResult = await this.db.query(
      `SELECT COUNT(*)::int AS unread
       FROM task_messages tm
       WHERE tm.task_id = $1
         AND tm.participant_id <> $2
         AND tm.id > COALESCE($3, 0)`,
      [taskId, participant.id, participant.lastReadMessageId]
    );

    const unreadCount = unreadResult.rows[0]?.unread ?? 0;

    return { messages, unreadCount };
  }

  async createMessage(
    taskId: number,
    participant: TaskParticipant,
    content: string,
    metadata: Record<string, any> = {},
    attachments: any[] = []
  ): Promise<TaskMessage> {
    const insertResult = await this.db.query(
      `WITH inserted AS (
        INSERT INTO task_messages (task_id, participant_id, content, metadata, attachments)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      )
      SELECT
        i.id,
        i.task_id,
        i.participant_id,
        i.content,
        i.is_system,
        i.attachments,
        i.metadata,
        i.created_at,
        i.updated_at,
        tp.user_id,
        u.name AS sender_name,
        u.email AS sender_email
      FROM inserted i
      INNER JOIN task_participants tp ON tp.id = i.participant_id
      LEFT JOIN users u ON u.id = tp.user_id`,
      [taskId, participant.id, content, metadata, attachments]
    );

    const row = insertResult.rows[0];
    const message = this.mapMessageRow(row);

    await this.touchTask(taskId);
    await this.markRead(participant, message.id);

    return message;
  }

  async markRead(
    participant: TaskParticipant,
    lastMessageId?: number
  ): Promise<{ lastReadAt: string | null; lastReadMessageId: number | null }> {
    let targetMessageId: number | null = lastMessageId ?? null;

    if (targetMessageId == null) {
      const latestResult = await this.db.query(
        'SELECT MAX(id) AS max_id FROM task_messages WHERE task_id = $1',
        [participant.taskId]
      );
      const maxId = latestResult.rows[0]?.max_id;
      targetMessageId = maxId != null ? Number(maxId) : null;
    }

    const updateResult = await this.db.query(
      `UPDATE task_participants
       SET last_read_at = CURRENT_TIMESTAMP,
           last_read_message_id = CASE
             WHEN $1 IS NULL THEN last_read_message_id
             WHEN last_read_message_id IS NULL THEN $1
             ELSE GREATEST(last_read_message_id, $1)
           END
       WHERE id = $2
       RETURNING last_read_at, last_read_message_id`,
      [targetMessageId, participant.id]
    );

    const updateRow = updateResult.rows[0];

    return {
      lastReadAt: updateRow?.last_read_at ? new Date(updateRow.last_read_at).toISOString() : null,
      lastReadMessageId:
        updateRow?.last_read_message_id != null ? Number(updateRow.last_read_message_id) : null,
    };
  }

  async getUnreadCount(taskId: number, participantId: number, lastReadMessageId: number | null): Promise<number> {
    const unreadResult = await this.db.query(
      `SELECT COUNT(*)::int AS unread
       FROM task_messages
       WHERE task_id = $1
         AND participant_id <> $2
         AND id > COALESCE($3, 0)`,
      [taskId, participantId, lastReadMessageId]
    );

    return unreadResult.rows[0]?.unread ?? 0;
  }

  async touchTask(taskId: number): Promise<void> {
    await this.db.query('UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [taskId]);
  }

  private parseJsonArray(value: unknown): any[] {
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        console.warn('Failed to parse JSON array value from task message record', error);
        return [];
      }
    }
    return [];
  }

  private parseJsonObject(value: unknown): Record<string, any> {
    if (value && typeof value === 'object') {
      return value as Record<string, any>;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : {};
      } catch (error) {
        console.warn('Failed to parse JSON object value from task message record', error);
        return {};
      }
    }
    return {};
  }

  private mapMessageRow(row: any): TaskMessage {
    return {
      id: Number(row.id),
      taskId: Number(row.task_id),
      participantId: Number(row.participant_id),
      content: row.content,
      isSystem: Boolean(row.is_system),
      attachments: this.parseJsonArray(row.attachments),
      metadata: this.parseJsonObject(row.metadata),
      createdAt: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
      updatedAt: row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString(),
      sender: {
        participantId: Number(row.participant_id),
        userId: row.user_id != null ? Number(row.user_id) : null,
        name: row.sender_name ?? null,
        email: row.sender_email ?? null,
      },
    };
  }
}

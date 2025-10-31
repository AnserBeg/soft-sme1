import { Pool, PoolClient, QueryResult } from 'pg';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'archived';

export interface TaskFilters {
  status?: TaskStatus | TaskStatus[];
  assignedTo?: number;
  dueFrom?: string;
  dueTo?: string;
  search?: string;
  includeCompleted?: boolean;
  includeArchived?: boolean;
}

export interface TaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  dueDate?: string | null;
  assigneeIds?: number[];
  initialNote?: string;
}

export interface TaskUpdate {
  title?: string;
  description?: string;
  status?: TaskStatus;
  dueDate?: string | null;
}

export interface TaskAssignee {
  id: number;
  username: string;
  email: string;
}

export interface TaskNote {
  id: number;
  note: string;
  createdAt: string;
  authorId: number | null;
  authorName: string | null;
}

export interface TaskSummary {
  total: number;
  open: number;
  completed: number;
  overdue: number;
  dueToday: number;
  dueSoon: number;
  myOpen: number;
  myDueToday: number;
  myOverdue: number;
  assignedByMeOverdue: number;
  allOverdue: number;
}

export interface TaskWithRelations {
  id: number;
  companyId: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueDate: string | null;
  completedAt: string | null;
  createdBy: number;
  createdByAgent: boolean;
  agentSessionId: number | null;
  createdAt: string;
  updatedAt: string;
  assignees: TaskAssignee[];
  noteCount: number;
  lastNoteAt: string | null;
  notes?: TaskNote[];
}

export interface CreateTaskOptions {
  createdByAgent?: boolean;
  agentSessionId?: number | null;
}

export class ServiceError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'ServiceError';
    this.statusCode = statusCode;
  }
}

type DbExecutor = Pool | PoolClient;

const ALLOWED_STATUSES: TaskStatus[] = ['pending', 'in_progress', 'completed', 'archived'];

export class TaskService {
  constructor(private readonly pool: Pool) {}

  async listTasks(companyId: number, filters: TaskFilters = {}): Promise<TaskWithRelations[]> {
    const conditions: string[] = ['t.company_id = $1'];
    const values: any[] = [companyId];

    const addCondition = (clause: string, value?: any) => {
      if (typeof value === 'undefined' || value === null || value === '') {
        return;
      }
      const placeholder = `$${values.length + 1}`;
      conditions.push(clause.replace('?', placeholder));
      values.push(value);
    };

    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      statuses.forEach((status) => this.ensureValidStatus(status));
      addCondition('t.status = ANY(?::text[])', statuses);
    } else {
      if (!filters.includeCompleted) {
        conditions.push("t.status != 'completed'");
      }
      if (!filters.includeArchived) {
        conditions.push("t.status != 'archived'");
      }
    }

    if (filters.assignedTo) {
      addCondition('EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = t.id AND ta.user_id = ?)', filters.assignedTo);
    }

    if (filters.dueFrom) {
      const iso = this.normalizeDate(filters.dueFrom, 'dueFrom');
      addCondition('t.due_date >= ?', iso);
    }

    if (filters.dueTo) {
      const iso = this.normalizeDate(filters.dueTo, 'dueTo');
      addCondition('t.due_date <= ?', iso);
    }

    if (filters.search) {
      const like = `%${filters.search.trim()}%`;
      const placeholderTitle = `$${values.length + 1}`;
      const placeholderDescription = `$${values.length + 2}`;
      conditions.push(`(t.title ILIKE ${placeholderTitle} OR t.description ILIKE ${placeholderDescription})`);
      values.push(like, like);
    }

    const whereClause = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';

    const query = `
      SELECT
        t.id,
        t.company_id,
        t.title,
        t.description,
        t.status,
        t.due_date,
        t.completed_at,
        t.created_by,
        t.created_by_agent,
        t.agent_session_id,
        t.created_at,
        t.updated_at,
        COALESCE(
          jsonb_agg(DISTINCT jsonb_build_object('id', u.id, 'username', u.username, 'email', u.email))
            FILTER (WHERE u.id IS NOT NULL),
          '[]'::jsonb
        ) AS assignees,
        COUNT(DISTINCT tn.id) AS note_count,
        MAX(tn.created_at) AS last_note_at
      FROM tasks t
      LEFT JOIN task_assignments ta ON ta.task_id = t.id
      LEFT JOIN users u ON u.id = ta.user_id
      LEFT JOIN task_notes tn ON tn.task_id = t.id
      WHERE ${whereClause}
      GROUP BY t.id
      ORDER BY
        CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END,
        t.due_date NULLS LAST,
        t.created_at DESC;
    `;

    const result = await this.pool.query(query, values);
    return result.rows.map((row) => this.mapTaskRow(row));
  }

  async getTask(companyId: number, taskId: number, db?: DbExecutor): Promise<TaskWithRelations> {
    const executor = db ?? this.pool;
    const result = await executor.query(
      `
        SELECT
          t.id,
          t.company_id,
          t.title,
          t.description,
          t.status,
          t.due_date,
          t.completed_at,
          t.created_by,
          t.created_by_agent,
          t.agent_session_id,
          t.created_at,
          t.updated_at,
          COALESCE(
            jsonb_agg(DISTINCT jsonb_build_object('id', u.id, 'username', u.username, 'email', u.email))
              FILTER (WHERE u.id IS NOT NULL),
            '[]'::jsonb
          ) AS assignees,
          COUNT(DISTINCT tn.id) AS note_count,
          MAX(tn.created_at) AS last_note_at
        FROM tasks t
        LEFT JOIN task_assignments ta ON ta.task_id = t.id
        LEFT JOIN users u ON u.id = ta.user_id
        LEFT JOIN task_notes tn ON tn.task_id = t.id
        WHERE t.company_id = $1 AND t.id = $2
        GROUP BY t.id
      `,
      [companyId, taskId]
    );

    if (result.rows.length === 0) {
      throw new ServiceError('Task not found', 404);
    }

    const task = this.mapTaskRow(result.rows[0]);

    const notesResult = await executor.query(
      `
        SELECT
          tn.id,
          tn.note,
          tn.created_at,
          tn.author_id,
          u.username
        FROM task_notes tn
        LEFT JOIN users u ON u.id = tn.author_id
        WHERE tn.task_id = $1
        ORDER BY tn.created_at DESC
      `,
      [taskId]
    );

    task.notes = notesResult.rows.map((row) => ({
      id: row.id,
      note: row.note,
      createdAt: new Date(row.created_at).toISOString(),
      authorId: row.author_id ?? null,
      authorName: row.username ?? null,
    }));

    return task;
  }

  async createTask(
    companyId: number,
    creatorId: number,
    input: TaskInput,
    options: CreateTaskOptions = {},
    clientArg?: PoolClient
  ): Promise<TaskWithRelations> {
    if (!input.title || !input.title.trim()) {
      throw new ServiceError('Task title is required');
    }

    const status = input.status ? this.ensureValidStatus(input.status) : 'pending';
    const dueDate = input.dueDate ? this.normalizeDate(input.dueDate, 'dueDate') : null;
    const createdByAgent = Boolean(options.createdByAgent);
    const agentSessionId = options.agentSessionId ?? null;
    const client = clientArg ?? (await this.pool.connect());
    const manageTransaction = !clientArg;

    try {
      if (manageTransaction) {
        await client.query('BEGIN');
      }
      const completedAt = status === 'completed' ? new Date().toISOString() : null;
      const insertResult = await client.query(
        `
          INSERT INTO tasks (
            company_id,
            title,
            description,
            status,
            due_date,
            created_by,
            completed_at,
            created_by_agent,
            agent_session_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id
        `,
        [
          companyId,
          input.title.trim(),
          input.description?.trim() || null,
          status,
          dueDate,
          creatorId,
          completedAt,
          createdByAgent,
          agentSessionId,
        ]
      );

      const taskId = insertResult.rows[0].id as number;

      const assigneeIds = this.normalizeAssignees(input.assigneeIds);
      if (assigneeIds.length > 0) {
        await this.validateAssignees(client, companyId, assigneeIds);
        await client.query(
          `
            INSERT INTO task_assignments (task_id, user_id, assigned_by)
            SELECT $1, u.id, $2
            FROM users u
            WHERE u.company_id = $3 AND u.id = ANY($4::int[])
            ON CONFLICT DO NOTHING
          `,
          [taskId, creatorId, companyId, assigneeIds]
        );
      }

      if (input.initialNote && input.initialNote.trim()) {
        await client.query(
          `INSERT INTO task_notes (task_id, author_id, note) VALUES ($1, $2, $3)`
          ,
          [taskId, creatorId, input.initialNote.trim()]
        );
      }

      const task = await this.getTask(companyId, taskId, client);
      if (manageTransaction) {
        await client.query('COMMIT');
      }
      return task;
    } catch (error) {
      if (manageTransaction) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      if (!clientArg) {
        client.release();
      }
    }
  }

  async updateTask(
    companyId: number,
    taskId: number,
    updates: TaskUpdate,
    clientArg?: PoolClient
  ): Promise<TaskWithRelations> {
    const fields: string[] = [];
    const values: any[] = [];

    const executor: DbExecutor = clientArg ?? this.pool;

    const existingResult = await executor.query(
      'SELECT status FROM tasks WHERE company_id = $1 AND id = $2',
      [companyId, taskId]
    );

    if (existingResult.rowCount === 0) {
      throw new ServiceError('Task not found', 404);
    }

    const previousStatus = existingResult.rows[0]?.status as TaskStatus | null;

    if (updates.title !== undefined) {
      const title = updates.title.trim();
      if (!title) {
        throw new ServiceError('Task title cannot be empty');
      }
      fields.push(`title = $${values.length + 1}`);
      values.push(title);
    }

    if (updates.description !== undefined) {
      fields.push(`description = $${values.length + 1}`);
      values.push(updates.description?.trim() || null);
    }

    if (updates.status !== undefined) {
      const status = this.ensureValidStatus(updates.status);
      fields.push(`status = $${values.length + 1}`);
      values.push(status);
      if (status === 'completed') {
        fields.push('completed_at = CURRENT_TIMESTAMP');
      } else {
        fields.push('completed_at = NULL');
      }
    }

    if (updates.dueDate !== undefined) {
      const dueDate = updates.dueDate ? this.normalizeDate(updates.dueDate, 'dueDate') : null;
      fields.push(`due_date = $${values.length + 1}`);
      values.push(dueDate);
    }

    if (fields.length === 0) {
      throw new ServiceError('No updates provided');
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);

    const query = `
      UPDATE tasks
      SET ${fields.join(', ')}
      WHERE company_id = $${values.length + 1} AND id = $${values.length + 2}
      RETURNING id
    `;

    values.push(companyId, taskId);

    const result = await executor.query(query, values);
    if (result.rowCount === 0) {
      throw new ServiceError('Task not found', 404);
    }

    const task = await this.getTask(companyId, taskId, executor);
    await this.emitAgentStatusUpdate(executor, task, previousStatus);
    return task;
  }

  async updateAssignments(companyId: number, taskId: number, assigneeIds: number[], actingUserId: number): Promise<TaskWithRelations> {
    const client = await this.pool.connect();
    const normalized = this.normalizeAssignees(assigneeIds);

    try {
      await client.query('BEGIN');

      await this.assertTaskBelongsToCompany(client, companyId, taskId);
      if (normalized.length > 0) {
        await this.validateAssignees(client, companyId, normalized);
      }

      await client.query('DELETE FROM task_assignments WHERE task_id = $1', [taskId]);

      if (normalized.length > 0) {
        await client.query(
          `
            INSERT INTO task_assignments (task_id, user_id, assigned_by)
            SELECT $1, u.id, $2
            FROM users u
            WHERE u.company_id = $3 AND u.id = ANY($4::int[])
          `,
          [taskId, actingUserId, companyId, normalized]
        );
      }

      await client.query('UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [taskId]);
      const task = await this.getTask(companyId, taskId, client);
      await client.query('COMMIT');

      return task;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateDueDate(companyId: number, taskId: number, dueDate: string | null): Promise<TaskWithRelations> {
    const normalized = dueDate ? this.normalizeDate(dueDate, 'dueDate') : null;
    const result = await this.pool.query(
      `
        UPDATE tasks
        SET due_date = $1, updated_at = CURRENT_TIMESTAMP
        WHERE company_id = $2 AND id = $3
        RETURNING id
      `,
      [normalized, companyId, taskId]
    );

    if (result.rowCount === 0) {
      throw new ServiceError('Task not found', 404);
    }

    return this.getTask(companyId, taskId);
  }

  async toggleCompletion(companyId: number, taskId: number, completed: boolean): Promise<TaskWithRelations> {
    const result = await this.pool.query(
      'SELECT status FROM tasks WHERE company_id = $1 AND id = $2',
      [companyId, taskId]
    );

    if (result.rows.length === 0) {
      throw new ServiceError('Task not found', 404);
    }

    const currentStatus = result.rows[0].status as TaskStatus;
    const nextStatus: TaskStatus = completed
      ? 'completed'
      : currentStatus === 'archived'
        ? 'archived'
        : 'in_progress';

    await this.pool.query(
      `
        UPDATE tasks
        SET status = $1,
            completed_at = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE company_id = $3 AND id = $4
      `,
      [nextStatus, completed ? new Date().toISOString() : null, companyId, taskId]
    );

    const task = await this.getTask(companyId, taskId);
    await this.emitAgentStatusUpdate(this.pool, task, currentStatus);
    return task;
  }

  async deleteTask(companyId: number, taskId: number): Promise<void> {
    const result = await this.pool.query('DELETE FROM tasks WHERE company_id = $1 AND id = $2', [companyId, taskId]);
    if (result.rowCount === 0) {
      throw new ServiceError('Task not found', 404);
    }
  }

  async addNote(companyId: number, taskId: number, authorId: number, note: string): Promise<TaskNote> {
    if (!note || !note.trim()) {
      throw new ServiceError('Note cannot be empty');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertTaskBelongsToCompany(client, companyId, taskId);
      const insertResult = await client.query(
        `
          INSERT INTO task_notes (task_id, author_id, note)
          VALUES ($1, $2, $3)
          RETURNING id, created_at
        `,
        [taskId, authorId, note.trim()]
      );
      const { id } = insertResult.rows[0];
      const noteResult = await client.query(
        `
          SELECT tn.id, tn.note, tn.created_at, tn.author_id, u.username
          FROM task_notes tn
          LEFT JOIN users u ON u.id = tn.author_id
          WHERE tn.id = $1
        `,
        [id]
      );

      await client.query('COMMIT');

      if (noteResult.rows.length === 0) {
        throw new ServiceError('Failed to load created note', 500);
      }

      const row = noteResult.rows[0];
      return {
        id: row.id,
        note: row.note,
        createdAt: new Date(row.created_at).toISOString(),
        authorId: row.author_id ?? null,
        authorName: row.username ?? null,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getAssignableUsers(companyId: number): Promise<TaskAssignee[]> {
    const result = await this.pool.query(
      `
        SELECT id, username, email
        FROM users
        WHERE company_id = $1
        ORDER BY username
      `,
      [companyId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
    }));
  }

  async getSummary(companyId: number, userId: number | null): Promise<TaskSummary> {
    const result = await this.pool.query(
      `
        WITH tasks_with_assignments AS (
          SELECT
            t.id,
            t.status,
            t.due_date,
            ta.user_id AS assignee_id,
            ta.assigned_by
          FROM tasks t
          LEFT JOIN task_assignments ta ON ta.task_id = t.id
          WHERE t.company_id = $1
        )
        SELECT
          COUNT(DISTINCT CASE WHEN status != 'archived' THEN id END) AS total,
          COUNT(DISTINCT CASE WHEN status IN ('pending', 'in_progress') THEN id END) AS open,
          COUNT(DISTINCT CASE WHEN status = 'completed' THEN id END) AS completed,
          COUNT(DISTINCT CASE WHEN status NOT IN ('archived', 'completed') AND due_date < NOW() THEN id END) AS overdue,
          COUNT(DISTINCT CASE WHEN status != 'archived' AND due_date::date = CURRENT_DATE THEN id END) AS due_today,
          COUNT(
            DISTINCT CASE
              WHEN status NOT IN ('archived', 'completed')
                AND due_date >= CURRENT_DATE
                AND due_date < CURRENT_DATE + INTERVAL '7 days'
              THEN id
            END
          ) AS due_soon,
          COUNT(
            DISTINCT CASE
              WHEN $2::int IS NOT NULL
                AND status IN ('pending', 'in_progress')
                AND assignee_id = $2::int
              THEN id
            END
          ) AS my_open,
          COUNT(
            DISTINCT CASE
              WHEN $2::int IS NOT NULL
                AND status NOT IN ('archived', 'completed')
                AND due_date::date = CURRENT_DATE
                AND assignee_id = $2::int
              THEN id
            END
          ) AS my_due_today,
          COUNT(
            DISTINCT CASE
              WHEN $2::int IS NOT NULL
                AND status NOT IN ('archived', 'completed')
                AND due_date < NOW()
                AND assignee_id = $2::int
              THEN id
            END
          ) AS my_overdue,
          COUNT(
            DISTINCT CASE
              WHEN $2::int IS NOT NULL
                AND status NOT IN ('archived', 'completed')
                AND due_date < NOW()
                AND assigned_by = $2::int
              THEN id
            END
          ) AS assigned_by_me_overdue,
          COUNT(
            DISTINCT CASE
              WHEN status NOT IN ('archived', 'completed')
                AND due_date < NOW()
              THEN id
            END
          ) AS all_overdue
        FROM tasks_with_assignments
      `,
      [companyId, userId]
    );

    const row = result.rows[0] || {};
    const allOverdue = Number(row.all_overdue || row.overdue || 0);
    return {
      total: Number(row.total || 0),
      open: Number(row.open || 0),
      completed: Number(row.completed || 0),
      overdue: Number(row.overdue || allOverdue || 0),
      dueToday: Number(row.due_today || 0),
      dueSoon: Number(row.due_soon || 0),
      myOpen: Number(row.my_open || 0),
      myDueToday: Number(row.my_due_today || 0),
      myOverdue: Number(row.my_overdue || 0),
      assignedByMeOverdue: Number(row.assigned_by_me_overdue || 0),
      allOverdue,
    };
  }

  private mapTaskRow(row: any): TaskWithRelations {
    let rawAssignees: any[] = [];
    if (Array.isArray(row.assignees)) {
      rawAssignees = row.assignees;
    } else if (row.assignees) {
      try {
        rawAssignees = JSON.parse(row.assignees);
      } catch {
        rawAssignees = [];
      }
    }

    const assignees = rawAssignees
      .filter((assignee) => assignee && typeof assignee === 'object')
      .map((assignee: any) => ({
        id: assignee.id,
        username: assignee.username,
        email: assignee.email,
      }));

    return {
      id: row.id,
      companyId: row.company_id,
      title: row.title,
      description: row.description ?? null,
      status: row.status,
      dueDate: row.due_date ? new Date(row.due_date).toISOString() : null,
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      createdBy: row.created_by,
      createdByAgent: Boolean(row.created_by_agent),
      agentSessionId: row.agent_session_id != null ? Number(row.agent_session_id) : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      assignees,
      noteCount: Number(row.note_count || 0),
      lastNoteAt: row.last_note_at ? new Date(row.last_note_at).toISOString() : null,
    };
  }

  private async emitAgentStatusUpdate(
    db: DbExecutor,
    task: TaskWithRelations,
    previousStatus?: TaskStatus | null
  ): Promise<void> {
    if (previousStatus && previousStatus === task.status) {
      return;
    }

    const subscriptionResult = await db.query(
      `SELECT id, session_id, last_notified_status FROM agent_task_subscriptions WHERE task_id = $1 AND active = TRUE`,
      [task.id]
    );

    if (subscriptionResult.rowCount === 0) {
      return;
    }

    const statusLabel = this.formatStatusLabel(task.status);
    const summary = `Task "${task.title}" is now ${statusLabel}.`;

    for (const row of subscriptionResult.rows) {
      if (row.last_notified_status === task.status) {
        continue;
      }

      const payload = {
        type: 'task_update',
        taskId: task.id,
        title: task.title,
        status: task.status,
        statusLabel,
        summary,
        link: `/tasks/${task.id}`,
      };

      const insertResult = await db.query(
        `INSERT INTO agent_messages (session_id, role, content) VALUES ($1, 'assistant', $2) RETURNING id`,
        [row.session_id, JSON.stringify(payload)]
      );

      const messageId = insertResult.rows[0]?.id ?? null;

      await db.query(
        `
          UPDATE agent_task_subscriptions
          SET last_notified_status = $1,
              last_notified_at = CURRENT_TIMESTAMP,
              last_notified_message_id = $2
          WHERE id = $3
        `,
        [task.status, messageId, row.id]
      );
    }
  }

  private formatStatusLabel(status: TaskStatus): string {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'in_progress':
        return 'In progress';
      case 'completed':
        return 'Completed';
      case 'archived':
        return 'Archived';
      default:
        return status;
    }
  }

  private ensureValidStatus(status: string): TaskStatus {
    if (!ALLOWED_STATUSES.includes(status as TaskStatus)) {
      throw new ServiceError('Invalid task status');
    }
    return status as TaskStatus;
  }

  private normalizeDate(value: string, field: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new ServiceError(`Invalid ${field}`);
    }
    return date.toISOString();
  }

  private normalizeAssignees(assigneeIds?: number[] | null): number[] {
    if (!assigneeIds || assigneeIds.length === 0) {
      return [];
    }
    const unique = Array.from(new Set(assigneeIds.map((id) => Number(id)).filter((id) => !Number.isNaN(id))));
    return unique;
  }

  private async validateAssignees(db: DbExecutor, companyId: number, assigneeIds: number[]): Promise<void> {
    if (assigneeIds.length === 0) {
      return;
    }
    const result: QueryResult = await db.query(
      'SELECT id FROM users WHERE company_id = $1 AND id = ANY($2::int[])',
      [companyId, assigneeIds]
    );
    const validIds = result.rows.map((row) => row.id);
    const missing = assigneeIds.filter((id) => !validIds.includes(id));
    if (missing.length > 0) {
      throw new ServiceError(`Invalid assignee(s): ${missing.join(', ')}`);
    }
  }

  private async assertTaskBelongsToCompany(db: DbExecutor, companyId: number, taskId: number): Promise<void> {
    const result = await db.query('SELECT 1 FROM tasks WHERE id = $1 AND company_id = $2', [taskId, companyId]);
    if (result.rows.length === 0) {
      throw new ServiceError('Task not found', 404);
    }
  }
}

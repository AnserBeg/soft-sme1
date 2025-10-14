import { Pool, PoolClient } from 'pg';
import { pool as defaultPool } from '../db';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface TaskRecord {
  id: string;
  conversationId: string | null;
  taskType: string;
  payload: Record<string, unknown>;
  status: TaskStatus;
  scheduledFor: Date;
  attempts: number;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export class AITaskQueueService {
  constructor(private readonly pool: Pool = defaultPool) {}

  async enqueueTask(
    taskType: string,
    payload: Record<string, unknown>,
    conversationId?: string | null,
    scheduledFor?: Date
  ): Promise<string> {
    const result = await this.pool.query(
      `INSERT INTO ai_task_queue (task_type, payload, conversation_id, scheduled_for)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [taskType, JSON.stringify(payload ?? {}), conversationId ?? null, scheduledFor ?? new Date()]
    );

    return result.rows[0].id;
  }

  async claimNextTask(client?: PoolClient): Promise<TaskRecord | null> {
    const db = client ?? (await this.pool.connect());
    let releaseNeeded = !client;

    try {
      await db.query('BEGIN');
      const result = await db.query(
        `SELECT *
           FROM ai_task_queue
          WHERE status = 'pending'
            AND scheduled_for <= NOW()
          ORDER BY scheduled_for ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`
      );

      if (result.rowCount === 0) {
        await db.query('COMMIT');
        return null;
      }

      const task = result.rows[0];
      await db.query(
        `UPDATE ai_task_queue
            SET status = 'running',
                attempts = attempts + 1,
                started_at = NOW(),
                updated_at = NOW()
          WHERE id = $1`,
        [task.id]
      );
      await db.query('COMMIT');

      return this.mapRow(task);
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      if (releaseNeeded) {
        db.release();
      }
    }
  }

  async markTaskComplete(taskId: string, metadata: { success: boolean; error?: string } = { success: true }): Promise<void> {
    if (metadata.success) {
      await this.pool.query(
        `UPDATE ai_task_queue
            SET status = 'completed',
                completed_at = NOW(),
                last_error = NULL
          WHERE id = $1`,
        [taskId]
      );
    } else {
      await this.pool.query(
        `UPDATE ai_task_queue
            SET status = 'failed',
                last_error = $2,
                completed_at = NOW()
          WHERE id = $1`,
        [taskId, metadata.error ?? null]
      );
    }
  }

  async getTaskById(taskId: string): Promise<TaskRecord | null> {
    const result = await this.pool.query('SELECT * FROM ai_task_queue WHERE id = $1', [taskId]);
    if (result.rowCount === 0) {
      return null;
    }
    return this.mapRow(result.rows[0]);
  }

  private mapRow(row: any): TaskRecord {
    let payload: Record<string, unknown> = {};
    if (row.payload) {
      if (typeof row.payload === 'string') {
        try {
          payload = JSON.parse(row.payload);
        } catch (error) {
          console.warn('[AI Task Queue] Failed to parse payload JSON:', error);
          payload = {};
        }
      } else {
        payload = row.payload;
      }
    }

    return {
      id: row.id,
      conversationId: row.conversation_id ?? null,
      taskType: row.task_type,
      payload,
      status: row.status,
      scheduledFor: new Date(row.scheduled_for),
      attempts: row.attempts,
      lastError: row.last_error ?? null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      startedAt: row.started_at ? new Date(row.started_at) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null
    };
  }
}

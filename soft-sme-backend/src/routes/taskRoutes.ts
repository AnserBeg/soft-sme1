import express, { Request, Response } from 'express';
import { pool } from '../db';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  TaskMessageService,
  TaskAccessError,
  TaskParticipant,
} from '../services/TaskMessageService';

const router = express.Router();
const messageService = new TaskMessageService(pool);

function parseId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

router.use(authMiddleware);

function ensureCompanyAccess(participant: TaskParticipant, companyId: number | null): boolean {
  if (companyId == null) {
    return false;
  }
  return participant.companyId == null || participant.companyId === companyId;
}

router.get('/:taskId/messages', async (req: Request, res: Response) => {
  try {
    const taskId = parseId(req.params.taskId);
    const userId = parseId(req.user?.id);
    const companyId = parseId(req.user?.company_id);
    if (!taskId) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    if (!userId) {
      return res.status(400).json({ message: 'Invalid user context' });
    }
    if (!companyId) {
      return res.status(400).json({ message: 'Invalid company context' });
    }

    const participant = await messageService.ensureParticipant(taskId, userId);
    if (!ensureCompanyAccess(participant, companyId)) {
      return res.status(403).json({ message: 'Task belongs to another company' });
    }
    const after = req.query.after ? parseId(req.query.after as string) ?? undefined : undefined;
    const { messages, unreadCount } = await messageService.listMessages(taskId, participant, after);

    res.json({
      participant,
      messages,
      unreadCount,
      lastSyncedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof TaskAccessError && error.code === 'NOT_PARTICIPANT') {
      return res.status(403).json({ message: 'You are not assigned to this task' });
    }
    console.error('Error fetching task messages:', error);
    res.status(500).json({ message: 'Failed to load task messages' });
  }
});

router.post('/:taskId/messages', async (req: Request, res: Response) => {
  try {
    const taskId = parseId(req.params.taskId);
    const userId = parseId(req.user?.id);
    const companyId = parseId(req.user?.company_id);
    if (!taskId) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    if (!userId) {
      return res.status(400).json({ message: 'Invalid user context' });
    }
    if (!companyId) {
      return res.status(400).json({ message: 'Invalid company context' });
    }

    const { content, metadata, attachments } = req.body;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ message: 'Message content is required' });
    }

    const participant = await messageService.ensureParticipant(taskId, userId);
    if (!ensureCompanyAccess(participant, companyId)) {
      return res.status(403).json({ message: 'Task belongs to another company' });
    }

    const sanitizedMetadata = metadata && typeof metadata === 'object' ? metadata : {};
    const sanitizedAttachments = Array.isArray(attachments) ? attachments : [];

    const message = await messageService.createMessage(
      taskId,
      participant,
      content.trim(),
      sanitizedMetadata,
      sanitizedAttachments
    );

    const unreadCount = await messageService.getUnreadCount(taskId, participant.id, message.id);

    res.status(201).json({
      message,
      participant: {
        ...participant,
        lastReadAt: message.createdAt,
        lastReadMessageId: message.id,
      },
      unreadCount,
    });
  } catch (error) {
    if (error instanceof TaskAccessError && error.code === 'NOT_PARTICIPANT') {
      return res.status(403).json({ message: 'You are not assigned to this task' });
    }
    console.error('Error posting task message:', error);
    res.status(500).json({ message: 'Failed to post message' });
  }
});

router.post('/:taskId/messages/mark-read', async (req: Request, res: Response) => {
  try {
    const taskId = parseId(req.params.taskId);
    const userId = parseId(req.user?.id);
    const companyId = parseId(req.user?.company_id);
    if (!taskId) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    if (!userId) {
      return res.status(400).json({ message: 'Invalid user context' });
    }
    if (!companyId) {
      return res.status(400).json({ message: 'Invalid company context' });
    }

    const { lastMessageId } = req.body ?? {};
    const lastId = parseId(lastMessageId);

    const participant = await messageService.ensureParticipant(taskId, userId);
    if (!ensureCompanyAccess(participant, companyId)) {
      return res.status(403).json({ message: 'Task belongs to another company' });
    }
    const markResult = await messageService.markRead(participant, lastId ?? undefined);
    const unreadCount = await messageService.getUnreadCount(
      taskId,
      participant.id,
      markResult.lastReadMessageId
    );

    res.json({
      participant: {
        ...participant,
        lastReadAt: markResult.lastReadAt,
        lastReadMessageId: markResult.lastReadMessageId,
      },
      unreadCount,
    });
  } catch (error) {
    if (error instanceof TaskAccessError && error.code === 'NOT_PARTICIPANT') {
      return res.status(403).json({ message: 'You are not assigned to this task' });
    }
    console.error('Error marking messages as read:', error);
    res.status(500).json({ message: 'Failed to update read status' });
  }
});

router.get('/:taskId', async (req: Request, res: Response) => {
  try {
    const taskId = parseId(req.params.taskId);
    const userId = parseId(req.user?.id);
    const companyId = parseId(req.user?.company_id);
    if (!taskId) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    if (!userId) {
      return res.status(400).json({ message: 'Invalid user context' });
    }
    if (!companyId) {
      return res.status(400).json({ message: 'Invalid company context' });
    }

    const participant = await messageService.ensureParticipant(taskId, userId);
    if (!ensureCompanyAccess(participant, companyId)) {
      return res.status(403).json({ message: 'Task belongs to another company' });
    }

    const taskResult = await pool.query(
      `SELECT id, title, description, status, priority, due_date, created_at, updated_at, created_by
       FROM tasks
       WHERE id = $1
         AND company_id = $2`,
      [taskId, companyId]
    );

    if (taskResult.rowCount === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const participantsResult = await pool.query(
      `SELECT
         tp.id,
         tp.user_id,
         tp.role,
         tp.is_watcher,
         tp.joined_at,
         tp.last_read_at,
         tp.last_read_message_id,
         u.name,
         u.email
       FROM task_participants tp
       LEFT JOIN users u ON u.id = tp.user_id
       WHERE tp.task_id = $1
       ORDER BY tp.joined_at ASC`,
      [taskId]
    );

    const taskRow = taskResult.rows[0];

    res.json({
      task: {
        id: Number(taskRow.id),
        title: taskRow.title,
        description: taskRow.description,
        status: taskRow.status,
        priority: taskRow.priority,
        dueDate: taskRow.due_date ? new Date(taskRow.due_date).toISOString() : null,
        createdAt: taskRow.created_at ? new Date(taskRow.created_at).toISOString() : null,
        updatedAt: taskRow.updated_at ? new Date(taskRow.updated_at).toISOString() : null,
        createdBy: taskRow.created_by != null ? Number(taskRow.created_by) : null,
      },
      participant,
      participants: participantsResult.rows.map((row) => ({
        id: Number(row.id),
        userId: row.user_id != null ? Number(row.user_id) : null,
        role: row.role,
        isWatcher: Boolean(row.is_watcher),
        name: row.name ?? null,
        email: row.email ?? null,
        joinedAt: row.joined_at ? new Date(row.joined_at).toISOString() : null,
        lastReadAt: row.last_read_at ? new Date(row.last_read_at).toISOString() : null,
        lastReadMessageId: row.last_read_message_id != null ? Number(row.last_read_message_id) : null,
      })),
    });
  } catch (error) {
    if (error instanceof TaskAccessError && error.code === 'NOT_PARTICIPANT') {
      return res.status(403).json({ message: 'You are not assigned to this task' });
    }
    console.error('Error fetching task details:', error);
    res.status(500).json({ message: 'Failed to load task details' });
  }
});

export default router;

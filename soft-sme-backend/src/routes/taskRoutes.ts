import express, { Request, Response } from 'express';
import { pool } from '../db';
import { authMiddleware } from '../middleware/authMiddleware';
import {
  TaskMessageService,
  TaskAccessError,
  TaskParticipant,
} from '../services/TaskMessageService';
import { ServiceError, TaskService, TaskStatus } from '../services/TaskService';

const router = express.Router();
const messageService = new TaskMessageService(pool);
const taskService = new TaskService(pool);

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

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') {
      return true;
    }
    if (value.toLowerCase() === 'false') {
      return false;
    }
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

function getCompanyId(req: Request): number | null {
  return parseId(req.user?.company_id);
}

function getUserId(req: Request): number | null {
  return parseId(req.user?.id);
}

function handleTaskError(res: Response, error: unknown, fallbackMessage: string) {
  if (error instanceof ServiceError) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ message: fallbackMessage });
}

function parseStatusList(value: unknown): TaskStatus[] | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const statuses = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0) as TaskStatus[];
  return statuses.length > 0 ? statuses : undefined;
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ message: 'Invalid company context' });
    }

    const filters: Record<string, unknown> = {};

    const statuses = parseStatusList(req.query.status);
    if (statuses) {
      filters.status = statuses;
    }

    const assignedTo = parseId(req.query.assignedTo as string | undefined);
    if (assignedTo) {
      filters.assignedTo = assignedTo;
    }

    if (typeof req.query.dueFrom === 'string' && req.query.dueFrom.trim().length > 0) {
      filters.dueFrom = req.query.dueFrom;
    }

    if (typeof req.query.dueTo === 'string' && req.query.dueTo.trim().length > 0) {
      filters.dueTo = req.query.dueTo;
    }

    if (typeof req.query.search === 'string' && req.query.search.trim().length > 0) {
      filters.search = req.query.search;
    }

    const includeCompleted = parseBoolean(req.query.includeCompleted);
    if (typeof includeCompleted === 'boolean') {
      filters.includeCompleted = includeCompleted;
    }

    const includeArchived = parseBoolean(req.query.includeArchived);
    if (typeof includeArchived === 'boolean') {
      filters.includeArchived = includeArchived;
    }

    const tasks = await taskService.listTasks(companyId, filters);
    res.json({ tasks });
  } catch (error) {
    handleTaskError(res, error, 'Failed to load tasks');
  }
});

router.get('/summary', async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ message: 'Invalid company context' });
    }

    const summary = await taskService.getSummary(companyId);
    res.json(summary);
  } catch (error) {
    handleTaskError(res, error, 'Failed to load task summary');
  }
});

router.get('/assignees', async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ message: 'Invalid company context' });
    }

    const assignees = await taskService.getAssignableUsers(companyId);
    res.json({ assignees });
  } catch (error) {
    handleTaskError(res, error, 'Failed to load assignable users');
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    if (!companyId) {
      return res.status(400).json({ message: 'Invalid company context' });
    }
    if (!userId) {
      return res.status(400).json({ message: 'Invalid user context' });
    }

    const payload = req.body ?? {};

    const assigneeIds = Array.isArray(payload.assigneeIds)
      ? payload.assigneeIds
          .map((id: unknown) => parseId(id))
          .filter((id: number | null): id is number => typeof id === 'number')
      : [];

    const task = await taskService.createTask(companyId, userId, {
      title: typeof payload.title === 'string' ? payload.title : '',
      description: typeof payload.description === 'string' ? payload.description : undefined,
      status: typeof payload.status === 'string' ? (payload.status as TaskStatus) : undefined,
      dueDate:
        payload.dueDate === null
          ? null
          : typeof payload.dueDate === 'string'
            ? payload.dueDate
            : undefined,
      assigneeIds,
      initialNote: typeof payload.initialNote === 'string' ? payload.initialNote : undefined,
    });

    res.status(201).json(task);
  } catch (error) {
    handleTaskError(res, error, 'Failed to create task');
  }
});

router.get('/:taskId/overview', async (req: Request, res: Response) => {
  try {
    const taskId = parseId(req.params.taskId);
    const companyId = getCompanyId(req);
    if (!taskId) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    if (!companyId) {
      return res.status(400).json({ message: 'Invalid company context' });
    }

    const task = await taskService.getTask(companyId, taskId);
    res.json(task);
  } catch (error) {
    handleTaskError(res, error, 'Failed to load task');
  }
});

router.put('/:taskId', async (req: Request, res: Response) => {
  try {
    const taskId = parseId(req.params.taskId);
    const companyId = getCompanyId(req);
    if (!taskId) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    if (!companyId) {
      return res.status(400).json({ message: 'Invalid company context' });
    }

    const updates = req.body ?? {};

    const task = await taskService.updateTask(companyId, taskId, {
      title: typeof updates.title === 'string' ? updates.title : undefined,
      description:
        updates.description === undefined
          ? undefined
          : typeof updates.description === 'string'
            ? updates.description
            : updates.description === null
              ? ''
              : undefined,
      status: typeof updates.status === 'string' ? (updates.status as TaskStatus) : undefined,
      dueDate:
        updates.dueDate === undefined
          ? undefined
          : updates.dueDate === null
            ? null
            : typeof updates.dueDate === 'string'
              ? updates.dueDate
              : undefined,
    });

    res.json(task);
  } catch (error) {
    handleTaskError(res, error, 'Failed to update task');
  }
});

router.patch('/:taskId/assignments', async (req: Request, res: Response) => {
  try {
    const taskId = parseId(req.params.taskId);
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    if (!taskId) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    if (!companyId) {
      return res.status(400).json({ message: 'Invalid company context' });
    }
    if (!userId) {
      return res.status(400).json({ message: 'Invalid user context' });
    }

    const { assigneeIds } = req.body ?? {};
    if (!Array.isArray(assigneeIds)) {
      return res.status(400).json({ message: 'assigneeIds must be an array' });
    }

    const normalized = assigneeIds
      .map((id: unknown) => parseId(id))
      .filter((id: number | null): id is number => typeof id === 'number');

    const task = await taskService.updateAssignments(companyId, taskId, normalized, userId);
    res.json(task);
  } catch (error) {
    handleTaskError(res, error, 'Failed to update task assignments');
  }
});

router.patch('/:taskId/due-date', async (req: Request, res: Response) => {
  try {
    const taskId = parseId(req.params.taskId);
    const companyId = getCompanyId(req);
    if (!taskId) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    if (!companyId) {
      return res.status(400).json({ message: 'Invalid company context' });
    }

    const { dueDate } = req.body ?? {};
    if (dueDate !== null && typeof dueDate !== 'string') {
      return res.status(400).json({ message: 'dueDate must be a string or null' });
    }

    const task = await taskService.updateDueDate(companyId, taskId, dueDate ?? null);
    res.json(task);
  } catch (error) {
    handleTaskError(res, error, 'Failed to update task due date');
  }
});

router.patch('/:taskId/complete', async (req: Request, res: Response) => {
  try {
    const taskId = parseId(req.params.taskId);
    const companyId = getCompanyId(req);
    if (!taskId) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    if (!companyId) {
      return res.status(400).json({ message: 'Invalid company context' });
    }

    const { completed } = req.body ?? {};
    if (typeof completed !== 'boolean') {
      return res.status(400).json({ message: 'completed must be a boolean' });
    }

    const task = await taskService.toggleCompletion(companyId, taskId, completed);
    res.json(task);
  } catch (error) {
    handleTaskError(res, error, 'Failed to update task completion');
  }
});

router.post('/:taskId/notes', async (req: Request, res: Response) => {
  try {
    const taskId = parseId(req.params.taskId);
    const companyId = getCompanyId(req);
    const userId = getUserId(req);
    if (!taskId) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    if (!companyId) {
      return res.status(400).json({ message: 'Invalid company context' });
    }
    if (!userId) {
      return res.status(400).json({ message: 'Invalid user context' });
    }

    const { note } = req.body ?? {};
    if (typeof note !== 'string' || note.trim().length === 0) {
      return res.status(400).json({ message: 'Note is required' });
    }

    const createdNote = await taskService.addNote(companyId, taskId, userId, note);
    res.status(201).json(createdNote);
  } catch (error) {
    handleTaskError(res, error, 'Failed to add note');
  }
});

router.get('/:taskId/notes', async (req: Request, res: Response) => {
  try {
    const taskId = parseId(req.params.taskId);
    const companyId = getCompanyId(req);
    if (!taskId) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    if (!companyId) {
      return res.status(400).json({ message: 'Invalid company context' });
    }

    const task = await taskService.getTask(companyId, taskId);
    res.json({ notes: task.notes ?? [] });
  } catch (error) {
    handleTaskError(res, error, 'Failed to load task notes');
  }
});

router.delete('/:taskId', async (req: Request, res: Response) => {
  try {
    const taskId = parseId(req.params.taskId);
    const companyId = getCompanyId(req);
    if (!taskId) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    if (!companyId) {
      return res.status(400).json({ message: 'Invalid company context' });
    }

    await taskService.deleteTask(companyId, taskId);
    res.status(204).send();
  } catch (error) {
    handleTaskError(res, error, 'Failed to delete task');
  }
});

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
      `SELECT id, title, description, status, priority, due_date, created_at, updated_at, created_by, created_by_agent, agent_session_id
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
        createdByAgent: Boolean(taskRow.created_by_agent),
        agentSessionId: taskRow.agent_session_id != null ? Number(taskRow.agent_session_id) : null,
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

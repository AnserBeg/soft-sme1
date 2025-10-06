import express, { Request, Response } from 'express';
import { pool } from '../db';
import {
  ServiceError,
  TaskFilters,
  TaskInput,
  TaskService,
  TaskStatus,
  TaskUpdate,
} from '../services/TaskService';

const router = express.Router();
const taskService = new TaskService(pool);
const STATUS_VALUES: TaskStatus[] = ['pending', 'in_progress', 'completed', 'archived'];

type AuthedRequest = Request & { user?: { id: string; company_id: string } };

const parseBoolean = (value: string | string[] | undefined): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const normalized = Array.isArray(value) ? value[0] : value;
  if (normalized === undefined) {
    return undefined;
  }
  const lower = normalized.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(lower)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(lower)) {
    return false;
  }
  return undefined;
};

const parseStatusFilter = (value: string | string[] | undefined): TaskStatus[] | undefined => {
  if (!value) {
    return undefined;
  }
  const segments = Array.isArray(value) ? value : value.split(',');
  const statuses: TaskStatus[] = [];
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }
    if (!STATUS_VALUES.includes(trimmed as TaskStatus)) {
      throw new ServiceError(`Invalid status filter: ${segment}`);
    }
    statuses.push(trimmed as TaskStatus);
  }
  return statuses.length > 0 ? statuses : undefined;
};

const ensureAuthContext = (req: AuthedRequest): { companyId: number; userId: number } => {
  if (!req.user) {
    throw new ServiceError('Not authenticated', 401);
  }
  const companyId = Number(req.user.company_id);
  const userId = Number(req.user.id);
  if (Number.isNaN(companyId) || Number.isNaN(userId)) {
    throw new ServiceError('Invalid authentication context', 400);
  }
  return { companyId, userId };
};

const handleError = (error: unknown, res: Response) => {
  if (error instanceof ServiceError) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  console.error('taskRoutes error:', error);
  return res.status(500).json({ message: 'Internal server error' });
};

router.get('/', async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = ensureAuthContext(req);
    const filters: TaskFilters = {};

    try {
      filters.status = parseStatusFilter(req.query.status as string | string[] | undefined);
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      throw error;
    }

    const assignedTo = req.query.assignedTo as string | undefined;
    if (assignedTo) {
      const parsed = Number(assignedTo);
      if (Number.isNaN(parsed)) {
        return res.status(400).json({ message: 'Invalid assignedTo filter' });
      }
      filters.assignedTo = parsed;
    }

    const includeCompleted = parseBoolean(req.query.includeCompleted as string | undefined);
    if (includeCompleted !== undefined) {
      filters.includeCompleted = includeCompleted;
    }

    const includeArchived = parseBoolean(req.query.includeArchived as string | undefined);
    if (includeArchived !== undefined) {
      filters.includeArchived = includeArchived;
    }

    if (req.query.dueFrom) {
      filters.dueFrom = String(req.query.dueFrom);
    }

    if (req.query.dueTo) {
      filters.dueTo = String(req.query.dueTo);
    }

    if (req.query.search) {
      filters.search = String(req.query.search);
    }

    const tasks = await taskService.listTasks(companyId, filters);
    return res.json({ tasks });
  } catch (error) {
    return handleError(error, res);
  }
});

router.get('/summary', async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = ensureAuthContext(req);
    const summary = await taskService.getSummary(companyId);
    return res.json(summary);
  } catch (error) {
    return handleError(error, res);
  }
});

router.get('/assignees', async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = ensureAuthContext(req);
    const assignees = await taskService.getAssignableUsers(companyId);
    return res.json({ assignees });
  } catch (error) {
    return handleError(error, res);
  }
});

router.get('/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = ensureAuthContext(req);
    const taskId = Number(req.params.id);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    const task = await taskService.getTask(companyId, taskId);
    return res.json(task);
  } catch (error) {
    return handleError(error, res);
  }
});

router.post('/', async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId, userId } = ensureAuthContext(req);
    const payload = req.body as TaskInput;
    const task = await taskService.createTask(companyId, userId, payload);
    return res.status(201).json(task);
  } catch (error) {
    return handleError(error, res);
  }
});

router.put('/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = ensureAuthContext(req);
    const taskId = Number(req.params.id);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    const updates = req.body as TaskUpdate;
    const task = await taskService.updateTask(companyId, taskId, updates);
    return res.json(task);
  } catch (error) {
    return handleError(error, res);
  }
});

router.patch('/:id/assignments', async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId, userId } = ensureAuthContext(req);
    const taskId = Number(req.params.id);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({ message: 'Invalid task id' });
    }

    let assigneeIds: number[] = [];
    if (Array.isArray(req.body?.assigneeIds)) {
      assigneeIds = req.body.assigneeIds.map((id: unknown) => Number(id)).filter((id: number) => !Number.isNaN(id));
    } else if (req.body?.assigneeIds !== undefined && req.body?.assigneeIds !== null) {
      const parsed = Number(req.body.assigneeIds);
      if (Number.isNaN(parsed)) {
        return res.status(400).json({ message: 'Invalid assignee id' });
      }
      assigneeIds = [parsed];
    }

    const task = await taskService.updateAssignments(companyId, taskId, assigneeIds, userId);
    return res.json(task);
  } catch (error) {
    return handleError(error, res);
  }
});

router.patch('/:id/due-date', async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = ensureAuthContext(req);
    const taskId = Number(req.params.id);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    const dueDate = req.body?.dueDate ?? null;
    const task = await taskService.updateDueDate(companyId, taskId, dueDate);
    return res.json(task);
  } catch (error) {
    return handleError(error, res);
  }
});

router.patch('/:id/complete', async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = ensureAuthContext(req);
    const taskId = Number(req.params.id);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    const completed = Boolean(req.body?.completed);
    const task = await taskService.toggleCompletion(companyId, taskId, completed);
    return res.json(task);
  } catch (error) {
    return handleError(error, res);
  }
});

router.post('/:id/notes', async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId, userId } = ensureAuthContext(req);
    const taskId = Number(req.params.id);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    const note = req.body?.note;
    const createdNote = await taskService.addNote(companyId, taskId, userId, note);
    return res.status(201).json(createdNote);
  } catch (error) {
    return handleError(error, res);
  }
});

router.get('/:id/notes', async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = ensureAuthContext(req);
    const taskId = Number(req.params.id);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    const task = await taskService.getTask(companyId, taskId);
    return res.json({ notes: task.notes ?? [] });
  } catch (error) {
    return handleError(error, res);
  }
});

router.delete('/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = ensureAuthContext(req);
    const taskId = Number(req.params.id);
    if (Number.isNaN(taskId)) {
      return res.status(400).json({ message: 'Invalid task id' });
    }
    await taskService.deleteTask(companyId, taskId);
    return res.status(204).send();
  } catch (error) {
    return handleError(error, res);
  }
});

export default router;

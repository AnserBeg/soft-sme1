import api from '../api/axios';
import {
  Task,
  TaskAssignee,
  TaskFilters,
  TaskNote,
  TaskPayload,
  TaskSummary,
  TaskUpdatePayload,
} from '../types/task';

export const buildTaskQueryParams = (filters?: TaskFilters): Record<string, string> => {
  if (!filters) {
    return {};
  }
  const params: Record<string, string> = {};

  if (filters.status && filters.status.length > 0) {
    params.status = filters.status.join(',');
  }
  if (typeof filters.assignedTo === 'number') {
    params.assignedTo = String(filters.assignedTo);
  }
  if (filters.dueFrom) {
    params.dueFrom = filters.dueFrom;
  }
  if (filters.dueTo) {
    params.dueTo = filters.dueTo;
  }
  if (filters.search) {
    params.search = filters.search.trim();
  }
  if (typeof filters.includeCompleted === 'boolean') {
    params.includeCompleted = String(filters.includeCompleted);
  }
  if (typeof filters.includeArchived === 'boolean') {
    params.includeArchived = String(filters.includeArchived);
  }

  return params;
};

export const getTasks = async (filters?: TaskFilters): Promise<Task[]> => {
  const response = await api.get('/api/tasks', { params: buildTaskQueryParams(filters) });
  return response.data.tasks as Task[];
};

export const getTaskById = async (taskId: number): Promise<Task> => {
  const response = await api.get(`/api/tasks/${taskId}`);
  return response.data as Task;
};

export const createTask = async (payload: TaskPayload): Promise<Task> => {
  const response = await api.post('/api/tasks', payload);
  return response.data as Task;
};

export const updateTask = async (taskId: number, updates: TaskUpdatePayload): Promise<Task> => {
  const response = await api.put(`/api/tasks/${taskId}`, updates);
  return response.data as Task;
};

export const updateTaskAssignments = async (taskId: number, assigneeIds: number[]): Promise<Task> => {
  const response = await api.patch(`/api/tasks/${taskId}/assignments`, { assigneeIds });
  return response.data as Task;
};

export const updateTaskDueDate = async (taskId: number, dueDate: string | null): Promise<Task> => {
  const response = await api.patch(`/api/tasks/${taskId}/due-date`, { dueDate });
  return response.data as Task;
};

export const toggleTaskCompletion = async (taskId: number, completed: boolean): Promise<Task> => {
  const response = await api.patch(`/api/tasks/${taskId}/complete`, { completed });
  return response.data as Task;
};

export const addTaskNote = async (taskId: number, note: string): Promise<TaskNote> => {
  const response = await api.post(`/api/tasks/${taskId}/notes`, { note });
  return response.data as TaskNote;
};

export const getTaskNotes = async (taskId: number): Promise<TaskNote[]> => {
  const response = await api.get(`/api/tasks/${taskId}/notes`);
  return response.data.notes as TaskNote[];
};

export const deleteTask = async (taskId: number): Promise<void> => {
  await api.delete(`/api/tasks/${taskId}`);
};

export const getTaskSummary = async (): Promise<TaskSummary> => {
  const response = await api.get('/api/tasks/summary');
  return response.data as TaskSummary;
};

export const getAssignableUsers = async (): Promise<TaskAssignee[]> => {
  const response = await api.get('/api/tasks/assignees');
  return response.data.assignees as TaskAssignee[];
};

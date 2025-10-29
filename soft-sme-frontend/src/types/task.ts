export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'archived';

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

export interface Task {
  id: number;
  companyId: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueDate: string | null;
  completedAt: string | null;
  createdBy: number;
  createdByAgent: boolean;
  createdAt: string;
  updatedAt: string;
  assignees: TaskAssignee[];
  noteCount: number;
  lastNoteAt: string | null;
  notes?: TaskNote[];
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

export interface TaskFilters {
  status?: TaskStatus[];
  assignedTo?: number;
  dueFrom?: string;
  dueTo?: string;
  search?: string;
  includeCompleted?: boolean;
  includeArchived?: boolean;
}

export interface TaskPayload {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  status?: TaskStatus;
  assigneeIds?: number[];
  initialNote?: string;
}

export interface TaskUpdatePayload {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  dueDate?: string | null;
}

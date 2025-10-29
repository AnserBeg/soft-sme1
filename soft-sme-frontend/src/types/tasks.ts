export interface TaskSummary {
  id: number;
  title: string;
  status: string;
  priority: string;
  description?: string | null;
  dueDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  createdBy?: number | null;
  createdByAgent?: boolean;
}

export interface TaskParticipantSummary {
  id: number;
  userId: number | null;
  role: string | null;
  isWatcher: boolean;
  name: string | null;
  email: string | null;
  joinedAt: string | null;
  lastReadAt: string | null;
  lastReadMessageId: number | null;
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
  attachments: unknown[];
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  sender: TaskMessageSender;
}

export interface TaskMessagesResponse {
  participant: TaskParticipantSummary;
  messages: TaskMessage[];
  unreadCount: number;
  lastSyncedAt: string;
}

export interface CreateTaskMessagePayload {
  content: string;
  metadata?: Record<string, any>;
  attachments?: unknown[];
}

export interface TaskDetailResponse {
  task: TaskSummary;
  participant: TaskParticipantSummary;
  participants: TaskParticipantSummary[];
}

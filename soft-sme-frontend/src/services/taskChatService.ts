import api from '../api/axios';
import {
  TaskMessagesResponse,
  CreateTaskMessagePayload,
  TaskDetailResponse,
} from '../types/tasks';

interface CreateMessageResponse {
  message: TaskMessagesResponse['messages'][number];
  participant: TaskMessagesResponse['participant'];
  unreadCount: number;
}

interface MarkReadResponse {
  participant: TaskMessagesResponse['participant'];
  unreadCount: number;
}

export const taskChatService = {
  async fetchMessages(taskId: number, after?: number): Promise<TaskMessagesResponse> {
    const response = await api.get(`/api/tasks/${taskId}/messages`, {
      params: after ? { after } : undefined,
    });
    return response.data as TaskMessagesResponse;
  },

  async postMessage(taskId: number, payload: CreateTaskMessagePayload): Promise<CreateMessageResponse> {
    const response = await api.post(`/api/tasks/${taskId}/messages`, payload);
    return response.data as CreateMessageResponse;
  },

  async markMessagesRead(taskId: number, lastMessageId?: number): Promise<MarkReadResponse> {
    const response = await api.post(`/api/tasks/${taskId}/messages/mark-read`, {
      lastMessageId,
    });
    return response.data as MarkReadResponse;
  },

  async getTaskDetail(taskId: number): Promise<TaskDetailResponse> {
    const response = await api.get(`/api/tasks/${taskId}`);
    return response.data as TaskDetailResponse;
  },
};

import api from '../api/axios';
import { Task } from '../types/task';

export type AgentEventType = 'text' | 'docs' | 'task_created' | 'task_updated' | 'task_message';

export interface AgentChatEvent {
  type: AgentEventType;
  content?: string;
  info?: string;
  chunks?: any[];
  summary?: string;
  task?: Task;
  link?: string;
  timestamp?: string;
}

export interface AgentChatMessage {
  id: number;
  role: 'user' | 'assistant';
  type: string;
  content?: string;
  summary?: string;
  task?: Task;
  link?: string;
  info?: string;
  chunks?: any[];
  timestamp?: string;
  createdAt?: string;
}

export const chatService = {
  async createSession(): Promise<number> {
    const response = await api.post('/api/agent/v2/session');
    return response.data.sessionId as number;
  },

  async fetchMessages(sessionId: number): Promise<AgentChatMessage[]> {
    const response = await api.get(`/api/agent/v2/session/${sessionId}/messages`);
    return (response.data?.messages ?? []) as AgentChatMessage[];
  },

  async sendMessage(sessionId: number, message: string): Promise<AgentChatEvent[]> {
    const response = await api.post('/api/agent/v2/chat', { sessionId, message });
    const events: AgentChatEvent[] = Array.isArray(response.data?.events) ? response.data.events : [];
    return events;
  },
};

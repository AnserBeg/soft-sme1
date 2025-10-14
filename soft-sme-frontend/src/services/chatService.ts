import api from '../api/axios';
import { Task } from '../types/task';
import { VoiceCallArtifact } from '../types/voice';

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
  callArtifacts?: VoiceCallArtifact[];
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
  callArtifacts?: VoiceCallArtifact[];
}

const isVoiceArtifactArray = (value: unknown): VoiceCallArtifact[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item) => typeof item === 'object' && item !== null) as VoiceCallArtifact[];
};

export const chatService = {
  async createSession(): Promise<number> {
    const response = await api.post('/api/agent/v2/session');
    return response.data.sessionId as number;
  },

  async fetchMessages(sessionId: number): Promise<AgentChatMessage[]> {
    const response = await api.get(`/api/agent/v2/session/${sessionId}/messages`);
    const messages: AgentChatMessage[] = Array.isArray(response.data?.messages) ? response.data.messages : [];
    return messages.map((message) => ({
      ...message,
      callArtifacts: isVoiceArtifactArray((message as any).callArtifacts),
    }));
  },

  async sendMessage(sessionId: number, message: string): Promise<AgentChatEvent[]> {
    const response = await api.post('/api/agent/v2/chat', { sessionId, message });
    const events: AgentChatEvent[] = Array.isArray(response.data?.events) ? response.data.events : [];
    return events.map((event) => ({
      ...event,
      callArtifacts: isVoiceArtifactArray((event as any).callArtifacts),
    }));
  },
};

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
import { VoiceCallArtifact } from '../types/voice';
import { ActionTrace } from '../types/chat';

export interface ChatResponse {
  response: string;
  sources: string[];
  confidence: number;
  toolUsed: string;
  timestamp: string;
  callArtifacts?: VoiceCallArtifact[];
  actions: ActionTrace[];
  actionMessage: string | null;
  actionCatalog: any[];
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
  // Test function to verify backend connection
  async testConnection(): Promise<boolean> {
    try {
      const response = await api.get('/api/ai-assistant/health');
      console.log('AI Assistant Health Check:', response.data);
      return response.data.success && response.data.data.status === 'healthy';
    } catch (error) {
      console.error('AI Assistant Health Check Error:', error);
      return false;
    }
  },

  async sendMessage(message: string, conversationId?: string): Promise<ChatResponse> {
    try {
      console.log('Sending message to AI assistant:', message);
      
      const request: ChatRequest = { message };
      if (conversationId) {
        request.conversationId = conversationId;
      }
      
      const response = await api.post('/api/ai-assistant/chat', request);
      
      console.log('AI Assistant Response:', response.data);
      
      if (response.data.success) {
        const data = response.data.data;
        return {
          response: data.response,
          sources: data.sources || [],
          confidence: data.confidence ?? 0,
          toolUsed: data.toolUsed ?? data.tool_used,
          timestamp: data.timestamp || new Date().toISOString(),
          callArtifacts: data.callArtifacts || data.call_artifacts || [],
        } as ChatResponse;
        const data = response.data.data || {};
        return {
          response: data.response,
          sources: Array.isArray(data.sources) ? data.sources : [],
          confidence: typeof data.confidence === 'number' ? data.confidence : 0,
          toolUsed: data.toolUsed ?? 'unknown',
          timestamp: data.timestamp ?? new Date().toISOString(),
          actions: Array.isArray(data.actions) ? data.actions : [],
          actionMessage: data.actionMessage ?? null,
          actionCatalog: Array.isArray(data.actionCatalog) ? data.actionCatalog : [],
        };
      } else {
        throw new Error(response.data.message || 'Failed to get response from AI assistant');
      }
    } catch (error) {
      console.error('Error calling AI assistant API:', error);
      
      // Fallback to contextual responses if API fails
      return {
        response: this.getFallbackResponse(message),
        sources: ['fallback'],
        confidence: 0.5,
        toolUsed: 'fallback',
        timestamp: new Date().toISOString(),
        callArtifacts: [],
        actions: [],
        actionMessage: null,
        actionCatalog: [],
      };
    }
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

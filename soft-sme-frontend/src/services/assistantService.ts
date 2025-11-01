import api from '../api/axios';

export type AssistantMode = 'DOC' | 'SQL';

export interface AssistantReply {
  source: AssistantMode | string;
  text: string;
  rows?: any[] | null;
}

export async function askAssistant(prompt: string, mode?: AssistantMode): Promise<AssistantReply> {
  const res = await api.post('/api/assistant', { prompt, mode });
  return res.data as AssistantReply;
}


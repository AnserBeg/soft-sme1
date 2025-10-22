import api from '../api/axios';
import { Task } from '../types/task';
import { VoiceCallArtifact } from '../types/voice';

export type AgentEventType = 'text' | 'docs' | 'task_created' | 'task_updated' | 'task_message';

export interface AgentCitation {
  title?: string;
  path?: string;
  score?: number;
}

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
  citations?: AgentCitation[];
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
  citations?: AgentCitation[];
  timestamp?: string;
  createdAt?: string;
  callArtifacts?: VoiceCallArtifact[];
}

export interface PlannerStreamHandshake {
  sessionId: string;
  planStepId: string;
  cursor?: string | null;
  expectedSubagents?: Array<{ key: string; resultKey?: string | null }>;
  plannerContext?: Record<string, any> | null;
}

export interface AgentChatSessionPreview {
  id: number;
  title: string;
  preview: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  lastActivityAt?: string | null;
}

const isVoiceArtifactArray = (value: unknown): VoiceCallArtifact[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item) => typeof item === 'object' && item !== null) as VoiceCallArtifact[];
};

const normalizeCitations = (value: unknown): AgentCitation[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const candidate = entry as AgentCitation;
      const path = typeof candidate.path === 'string' ? candidate.path : undefined;
      const title = typeof candidate.title === 'string' ? candidate.title : undefined;
      const score =
        typeof candidate.score === 'number' && Number.isFinite(candidate.score)
          ? candidate.score
          : undefined;
      if (!path && !title) {
        return null;
      }
      return { path, title, score } as AgentCitation;
    })
    .filter(Boolean) as AgentCitation[];

  return normalized.length > 0 ? normalized : undefined;
};

const normalizeExpectedSubagents = (value: unknown): Array<{ key: string; resultKey?: string | null }> | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const key = (entry as any).key ?? (entry as any).stage ?? (entry as any).subagent;
      if (!key || typeof key !== 'string') {
        return null;
      }
      return {
        key,
        resultKey: (entry as any).resultKey ?? (entry as any).result_key ?? null,
      };
    })
    .filter(Boolean) as Array<{ key: string; resultKey?: string | null }>;
  return normalized.length > 0 ? normalized : undefined;
};

const normalizePlannerHandshake = (
  sessionId: number,
  raw: any
): PlannerStreamHandshake | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const rawPlanStepId = raw.planStepId ?? raw.plan_step_id ?? raw.stepId;
  if (!rawPlanStepId || typeof rawPlanStepId !== 'string') {
    return null;
  }
  const resolvedSessionId = raw.sessionId ?? raw.session_id ?? sessionId;
  const cursorCandidate = raw.cursor ?? raw.lastEventId ?? raw.last_event_id ?? null;
  const plannerContext =
    raw.plannerContext && typeof raw.plannerContext === 'object'
      ? raw.plannerContext
      : raw.planner_context && typeof raw.planner_context === 'object'
        ? raw.planner_context
        : undefined;

  return {
    sessionId: String(resolvedSessionId ?? sessionId),
    planStepId: rawPlanStepId,
    cursor: cursorCandidate != null ? String(cursorCandidate) : null,
    expectedSubagents: normalizeExpectedSubagents(raw.expectedSubagents ?? raw.expected_subagents),
    plannerContext: plannerContext ?? null,
  };
};

export const chatService = {
  async createSession(): Promise<number> {
    const response = await api.post('/api/agent/v2/session');
    return response.data.sessionId as number;
  },

  async listSessions(limit = 4, includeSessionId?: number): Promise<AgentChatSessionPreview[]> {
    const params: Record<string, any> = { limit };
    if (includeSessionId != null) {
      params.include = includeSessionId;
    }
    const response = await api.get('/api/agent/v2/sessions', { params });
    const sessions = Array.isArray(response.data?.sessions) ? response.data.sessions : [];
    return sessions.map((session: any) => ({
      id: Number(session.id),
      title: String(session.title ?? `Chat ${session.id}`),
      preview: typeof session.preview === 'string' ? session.preview : null,
      lastMessageAt: session.lastMessageAt ?? session.last_message_at ?? null,
      createdAt: session.createdAt ?? session.created_at ?? new Date().toISOString(),
      lastActivityAt: session.lastActivityAt ?? session.last_activity_at ?? null,
    }));
  },

  async fetchMessages(sessionId: number): Promise<AgentChatMessage[]> {
    const response = await api.get(`/api/agent/v2/session/${sessionId}/messages`);
    const messages: AgentChatMessage[] = Array.isArray(response.data?.messages) ? response.data.messages : [];
    return messages.map((message) => ({
      ...message,
      callArtifacts: isVoiceArtifactArray((message as any).callArtifacts),
      citations: normalizeCitations((message as any).citations),
    }));
  },

  async sendMessage(
    sessionId: number,
    message: string
  ): Promise<{ events: AgentChatEvent[]; plan?: PlannerStreamHandshake | null }> {
    const response = await api.post('/api/agent/v2/chat', { sessionId, message });
    const events: AgentChatEvent[] = Array.isArray(response.data?.events) ? response.data.events : [];
    const normalizedEvents = events.map((event) => ({
      ...event,
      callArtifacts: isVoiceArtifactArray((event as any).callArtifacts),
      citations: normalizeCitations((event as any).citations),
    }));
    const plan = normalizePlannerHandshake(sessionId, response.data?.plan ?? response.data?.plannerStream);
    return { events: normalizedEvents, plan };
  },
};

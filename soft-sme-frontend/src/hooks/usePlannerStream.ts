import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import api from '../api/axios';

export type PlannerStreamConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'error';

export interface PlannerExpectedSubagent {
  key: string;
  resultKey?: string | null;
}

export interface PlannerStreamEvent {
  sessionId: string;
  planStepId: string;
  sequence: number;
  type: string;
  timestamp: string;
  content: Record<string, any>;
  telemetry: Record<string, any>;
}

export interface PlannerSubagentState {
  key: string;
  status: string;
  resultKey?: string | null;
  payload?: Record<string, any> | null;
  revision?: number;
  lastUpdated: string;
  telemetry?: Record<string, any>;
}

export interface PlannerStreamSummary {
  events: PlannerStreamEvent[];
  subagentsByKey: Record<string, PlannerSubagentState>;
  subagentOrder: string[];
  plannerContext?: Record<string, any> | null;
  stepStatus?: string;
  completedPayload?: Record<string, any> | null;
  lastSequence?: number;
}

export const initialPlannerStreamSummary: PlannerStreamSummary = {
  events: [],
  subagentsByKey: {},
  subagentOrder: [],
  plannerContext: undefined,
  stepStatus: undefined,
  completedPayload: undefined,
  lastSequence: undefined,
};

export type PlannerStreamAction =
  | { type: 'reset'; expected?: PlannerExpectedSubagent[]; plannerContext?: Record<string, any> | null }
  | { type: 'hydrateExpected'; expected?: PlannerExpectedSubagent[]; plannerContext?: Record<string, any> | null }
  | { type: 'append'; events: PlannerStreamEvent[] };

const nowIso = (): string => new Date().toISOString();

const normalizeExpectedSubagent = (value: any): PlannerExpectedSubagent | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const rawKey = (value.key ?? value.subagent ?? value.stage) as string | undefined;
  if (!rawKey || typeof rawKey !== 'string') {
    return null;
  }
  const normalized: PlannerExpectedSubagent = {
    key: rawKey,
    resultKey: value.resultKey ?? value.result_key ?? null,
  };
  return normalized;
};

const ensurePlannerContext = (value: any): Record<string, any> | null | undefined => {
  if (value == null) {
    return value === null ? null : undefined;
  }
  if (typeof value === 'object') {
    return value as Record<string, any>;
  }
  return undefined;
};

const mergeExpectedSubagents = (
  summary: PlannerStreamSummary,
  expected: PlannerExpectedSubagent[] | undefined,
  timestamp: string
): PlannerStreamSummary => {
  if (!expected || expected.length === 0) {
    return summary;
  }

  const nextByKey: Record<string, PlannerSubagentState> = {};
  const nextOrder: string[] = [];
  const existing = summary.subagentsByKey;

  for (const item of expected) {
    if (!item?.key) {
      continue;
    }
    const key = String(item.key);
    nextOrder.push(key);
    const prior = existing[key];
    nextByKey[key] = {
      key,
      status: prior?.status ?? 'pending',
      resultKey: item.resultKey ?? prior?.resultKey ?? null,
      payload: prior?.payload ?? null,
      revision: prior?.revision,
      lastUpdated: prior?.lastUpdated ?? timestamp,
      telemetry: prior?.telemetry,
    };
  }

  for (const key of Object.keys(existing)) {
    if (nextByKey[key]) {
      continue;
    }
    nextByKey[key] = existing[key];
    nextOrder.push(key);
  }

  return {
    ...summary,
    subagentsByKey: nextByKey,
    subagentOrder: nextOrder,
  };
};

export const applyPlannerEvents = (
  summary: PlannerStreamSummary,
  events: PlannerStreamEvent[]
): PlannerStreamSummary => {
  if (!events || events.length === 0) {
    return summary;
  }

  let next = { ...summary };
  let eventsList = summary.events.slice();
  let order = summary.subagentOrder.slice();
  let byKey = { ...summary.subagentsByKey };
  let plannerContext = summary.plannerContext;
  let stepStatus = summary.stepStatus;
  let completedPayload = summary.completedPayload;
  let lastSequence = summary.lastSequence;

  const ensureOrderIncludes = (key: string) => {
    if (!order.includes(key)) {
      order.push(key);
    }
  };

  for (const event of events) {
    if (!Number.isFinite(event.sequence)) {
      continue;
    }
    if (eventsList.some((existing) => existing.sequence === event.sequence)) {
      continue;
    }
    eventsList.push(event);
    lastSequence = event.sequence;

    if (event.type === 'step_started') {
      const expectedRaw = event.content?.expected_subagents ?? event.content?.expectedSubagents ?? [];
      const expected = Array.isArray(expectedRaw)
        ? (expectedRaw.map(normalizeExpectedSubagent).filter(Boolean) as PlannerExpectedSubagent[])
        : [];
      const contextCandidate = ensurePlannerContext(event.content?.planner_context ?? event.content?.plannerContext);
      if (contextCandidate !== undefined) {
        plannerContext = contextCandidate;
      }
      stepStatus = typeof event.content?.status === 'string' ? event.content.status : stepStatus;
      if (expected.length > 0) {
        const merged = mergeExpectedSubagents(
          { ...next, events: eventsList, subagentOrder: order, subagentsByKey: byKey },
          expected,
          event.timestamp || nowIso()
        );
        byKey = merged.subagentsByKey;
        order = merged.subagentOrder;
      }
      continue;
    }

    if (event.type === 'subagent_result') {
      const stage = event.content?.stage ?? event.content?.subagent ?? event.content?.key;
      if (stage) {
        const key = String(stage);
        ensureOrderIncludes(key);
        const prior = byKey[key];
        const payloadValue = event.content?.payload;
        const resultKeyCandidate =
          event.content?.resultKey ?? event.content?.result_key ?? prior?.resultKey ?? null;
        byKey = {
          ...byKey,
          [key]: {
            key,
            status: typeof event.content?.status === 'string' ? event.content.status : prior?.status ?? 'pending',
            resultKey: resultKeyCandidate,
            payload: payloadValue && typeof payloadValue === 'object' ? payloadValue : prior?.payload ?? null,
            revision: typeof event.content?.revision === 'number' ? event.content.revision : prior?.revision,
            lastUpdated: event.timestamp || nowIso(),
            telemetry: Object.keys(event.telemetry || {}).length ? event.telemetry : prior?.telemetry,
          },
        };
      }
      const statusCandidate = event.content?.overall_status ?? event.content?.status;
      if (typeof statusCandidate === 'string') {
        stepStatus = statusCandidate;
      }
      continue;
    }

    if (event.type === 'plan_step_completed') {
      if (typeof event.content?.status === 'string') {
        stepStatus = event.content.status;
      }
      const payloadValue = event.content?.payload;
      if (payloadValue && typeof payloadValue === 'object') {
        completedPayload = payloadValue;
      }
      continue;
    }

    if (typeof event.content?.status === 'string') {
      stepStatus = event.content.status;
    }
  }

  eventsList.sort((a, b) => a.sequence - b.sequence);

  next = {
    events: eventsList,
    subagentsByKey: byKey,
    subagentOrder: order,
    plannerContext,
    stepStatus,
    completedPayload,
    lastSequence,
  };

  return next;
};

const plannerStreamReducer = (
  state: PlannerStreamSummary,
  action: PlannerStreamAction
): PlannerStreamSummary => {
  switch (action.type) {
    case 'reset': {
      const contextCandidate = ensurePlannerContext(action.plannerContext);
      const base: PlannerStreamSummary = {
        events: [],
        subagentsByKey: {},
        subagentOrder: [],
        plannerContext: contextCandidate,
        stepStatus: undefined,
        completedPayload: undefined,
        lastSequence: undefined,
      };
      if (action.expected && action.expected.length > 0) {
        return mergeExpectedSubagents(base, action.expected, nowIso());
      }
      return base;
    }
    case 'hydrateExpected': {
      const contextCandidate = ensurePlannerContext(action.plannerContext);
      const withExpected = mergeExpectedSubagents(state, action.expected, nowIso());
      if (contextCandidate !== undefined) {
        return {
          ...withExpected,
          plannerContext: contextCandidate,
        };
      }
      return withExpected;
    }
    case 'append':
      return applyPlannerEvents(state, action.events);
    default:
      return state;
  }
};

const buildStreamUrl = (sessionId: string, planStepId: string): string => {
  const baseURL = api.defaults.baseURL ?? '';
  const trimmedBase = baseURL.replace(/\/$/, '');
  const path = `/api/planner/sessions/${encodeURIComponent(sessionId)}/stream?planStepId=${encodeURIComponent(planStepId)}`;
  if (!trimmedBase) {
    return path;
  }
  return `${trimmedBase}${path}`;
};

interface SseMessage {
  id?: string;
  event?: string;
  data?: any;
}

const parseSseMessage = (raw: string): SseMessage | null => {
  if (!raw) {
    return null;
  }
  const lines = raw.split(/\r?\n/);
  const message: SseMessage = {};
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    if (line.startsWith('id:')) {
      message.id = line.slice(3).trim();
      continue;
    }
    if (line.startsWith('event:')) {
      message.event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
      continue;
    }
  }

  if (dataLines.length > 0) {
    const payload = dataLines.join('\n');
    if (payload) {
      try {
        message.data = JSON.parse(payload);
      } catch {
        message.data = payload;
      }
    }
  }

  if (!message.id && !message.event && dataLines.length === 0) {
    return null;
  }

  return message;
};

const normalizePlannerEvent = (value: any): PlannerStreamEvent | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const sequence = Number(value.sequence ?? value.seq ?? value.id);
  if (!Number.isFinite(sequence)) {
    return null;
  }
  const sessionId = String(value.session_id ?? value.sessionId ?? '');
  const planStepId = String(value.plan_step_id ?? value.planStepId ?? '');
  if (!planStepId) {
    return null;
  }
  const timestamp = typeof value.timestamp === 'string' ? value.timestamp : nowIso();
  const content = (value.content && typeof value.content === 'object') ? value.content : {};
  const telemetry = (value.telemetry && typeof value.telemetry === 'object') ? value.telemetry : {};
  return {
    sessionId,
    planStepId,
    sequence,
    type: String(value.type ?? ''),
    timestamp,
    content,
    telemetry,
  };
};

const isTerminalStatus = (status?: string): boolean => {
  if (!status) {
    return false;
  }
  const normalized = status.trim().toLowerCase();
  return [
    'success',
    'completed',
    'complete',
    'error',
    'failed',
    'failure',
    'cancelled',
    'timeout',
    'partial_failure',
    'degraded',
  ].includes(normalized);
};

export interface UsePlannerStreamArgs {
  sessionId?: string | number | null;
  planStepId?: string | null;
  enabled?: boolean;
  initialCursor?: string | number | null;
  expectedSubagents?: PlannerExpectedSubagent[];
  plannerContext?: Record<string, any> | null;
  stopOnCompletion?: boolean;
  onStepCompleted?: (status?: string, payload?: Record<string, any> | null) => void;
}

export interface UsePlannerStreamResult {
  connectionState: PlannerStreamConnectionState;
  error: string | null;
  events: PlannerStreamEvent[];
  subagents: PlannerSubagentState[];
  subagentsByKey: Record<string, PlannerSubagentState>;
  stepStatus?: string;
  plannerContext?: Record<string, any> | null;
  completedPayload?: Record<string, any> | null;
  replayComplete: boolean;
  lastHeartbeatAt?: string | null;
  lastEventId?: string | null;
  isTerminal: boolean;
  stop: () => void;
  restart: () => void;
}

export const usePlannerStream = (args: UsePlannerStreamArgs): UsePlannerStreamResult => {
  const {
    sessionId,
    planStepId,
    enabled = true,
    initialCursor,
    expectedSubagents,
    plannerContext,
    stopOnCompletion = true,
    onStepCompleted,
  } = args;

  const normalizedSessionId = sessionId != null ? String(sessionId) : undefined;
  const normalizedPlanStepId = planStepId != null ? String(planStepId) : undefined;

  const [summary, dispatch] = useReducer(plannerStreamReducer, initialPlannerStreamSummary);
  const [connectionState, setConnectionState] = useState<PlannerStreamConnectionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [replayComplete, setReplayComplete] = useState(false);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<string | null>(null);

  const lastEventIdRef = useRef<string | null>(initialCursor != null ? String(initialCursor) : null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const completionNotifiedRef = useRef(false);

  const resetSummary = useCallback(() => {
    dispatch({ type: 'reset', expected: expectedSubagents, plannerContext });
    lastEventIdRef.current = initialCursor != null ? String(initialCursor) : null;
    setReplayComplete(false);
    setLastHeartbeatAt(null);
    completionNotifiedRef.current = false;
  }, [expectedSubagents, plannerContext, initialCursor]);

  useEffect(() => {
    resetSummary();
  }, [resetSummary, normalizedSessionId, normalizedPlanStepId]);

  useEffect(() => {
    if (expectedSubagents || plannerContext !== undefined) {
      dispatch({ type: 'hydrateExpected', expected: expectedSubagents, plannerContext });
    }
  }, [expectedSubagents, plannerContext]);

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const stop = useCallback(() => {
    shouldReconnectRef.current = false;
    clearReconnectTimer();
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setConnectionState((state) => (state === 'idle' ? state : 'closed'));
  }, []);

  useEffect(() => {
    return () => {
      shouldReconnectRef.current = false;
      clearReconnectTimer();
      abortControllerRef.current?.abort();
    };
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnectRef.current) {
      return;
    }
    const attempt = reconnectAttemptRef.current;
    const delay = Math.min(1000 * Math.pow(2, attempt), 15000);
    reconnectAttemptRef.current = attempt + 1;
    clearReconnectTimer();
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connect(true);
    }, delay);
  }, []);

  const handleCompletion = useCallback(
    (status?: string, payload?: Record<string, any> | null) => {
      if (completionNotifiedRef.current) {
        return;
      }
      completionNotifiedRef.current = true;
      if (stopOnCompletion) {
        stop();
      }
      if (onStepCompleted) {
        try {
          onStepCompleted(status, payload ?? null);
        } catch (callbackError) {
          if (import.meta.env.DEV) {
            console.warn('usePlannerStream onStepCompleted callback failed', callbackError);
          }
        }
      }
    },
    [onStepCompleted, stop, stopOnCompletion]
  );

  const handleSseMessage = useCallback(
    (message: SseMessage) => {
      if (!message) {
        return;
      }
      if (message.id) {
        lastEventIdRef.current = message.id;
      }
      if (message.event === 'heartbeat') {
        setLastHeartbeatAt(nowIso());
        if (!replayComplete) {
          setReplayComplete(true);
        }
        return;
      }
      if (message.event === 'error') {
        const errorMessage = typeof message.data === 'string' ? message.data : message.data?.message;
        setError(errorMessage || 'Planner stream reported an error');
        setConnectionState('error');
        return;
      }
      if (message.event !== 'planner_stream') {
        return;
      }
      const payload = message.data;
      if (!payload || typeof payload !== 'object') {
        return;
      }
      if (payload.type === 'event_batch') {
        const normalizedEvents: PlannerStreamEvent[] = Array.isArray(payload.events)
          ? (payload.events.map(normalizePlannerEvent).filter(Boolean) as PlannerStreamEvent[])
          : [];
        if (normalizedEvents.length > 0) {
          dispatch({ type: 'append', events: normalizedEvents });
          if (!replayComplete) {
            setReplayComplete(true);
          }
        }
      }
    },
    [replayComplete]
  );

  const connect = useCallback(
    async (isReconnect = false) => {
      if (!normalizedSessionId || !normalizedPlanStepId || !enabled) {
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      clearReconnectTimer();
      shouldReconnectRef.current = true;
      reconnectAttemptRef.current = isReconnect ? reconnectAttemptRef.current : 0;
      setConnectionState(isReconnect ? 'reconnecting' : 'connecting');
      setError(null);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const url = buildStreamUrl(normalizedSessionId, normalizedPlanStepId);
      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
      };
      const token = localStorage.getItem('sessionToken');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const deviceId = localStorage.getItem('deviceId');
      if (deviceId) {
        headers['x-device-id'] = deviceId;
      }
      try {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (timeZone) {
          headers['x-timezone'] = timeZone;
        }
      } catch {
        // Ignore timezone resolution failures
      }
      if (lastEventIdRef.current) {
        headers['Last-Event-ID'] = lastEventIdRef.current;
      }

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers,
          credentials: 'include',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Planner stream failed with status ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Planner stream response is missing a readable body');
        }

        setConnectionState('open');
        reconnectAttemptRef.current = 0;
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (shouldReconnectRef.current) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          let separatorIndex = buffer.indexOf('\n\n');
          while (separatorIndex !== -1) {
            const chunk = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            const parsed = parseSseMessage(chunk);
            if (parsed) {
              handleSseMessage(parsed);
            }
            separatorIndex = buffer.indexOf('\n\n');
          }
        }

        if (buffer.trim()) {
          const parsed = parseSseMessage(buffer.trim());
          if (parsed) {
            handleSseMessage(parsed);
          }
        }

        setConnectionState('closed');
      } catch (streamError: any) {
        if (controller.signal.aborted) {
          return;
        }
        const message = streamError instanceof Error ? streamError.message : 'Unknown planner stream error';
        setError(message);
        setConnectionState('error');
      } finally {
        abortControllerRef.current = null;
        if (shouldReconnectRef.current) {
          scheduleReconnect();
        }
      }
    },
    [normalizedSessionId, normalizedPlanStepId, enabled, handleSseMessage, scheduleReconnect]
  );

  useEffect(() => {
    if (!normalizedSessionId || !normalizedPlanStepId || !enabled) {
      stop();
      return;
    }
    connect(false);
    return () => {
      stop();
    };
  }, [normalizedSessionId, normalizedPlanStepId, enabled, connect, stop]);

  useEffect(() => {
    if (isTerminalStatus(summary.stepStatus)) {
      handleCompletion(summary.stepStatus, summary.completedPayload ?? null);
    }
  }, [summary.stepStatus, summary.completedPayload, handleCompletion]);

  const restart = useCallback(() => {
    if (!normalizedSessionId || !normalizedPlanStepId) {
      return;
    }
    stop();
    connect(false);
  }, [connect, stop, normalizedSessionId, normalizedPlanStepId]);

  const subagents = useMemo(() => {
    return summary.subagentOrder.map((key) => summary.subagentsByKey[key]).filter(Boolean);
  }, [summary.subagentOrder, summary.subagentsByKey]);

  return {
    connectionState,
    error,
    events: summary.events,
    subagents,
    subagentsByKey: summary.subagentsByKey,
    stepStatus: summary.stepStatus,
    plannerContext: summary.plannerContext ?? null,
    completedPayload: summary.completedPayload ?? null,
    replayComplete,
    lastHeartbeatAt,
    lastEventId: lastEventIdRef.current,
    isTerminal: isTerminalStatus(summary.stepStatus),
    stop,
    restart,
  };
};

export default usePlannerStream;

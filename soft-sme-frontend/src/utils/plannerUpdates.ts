import type { PlannerStreamEvent } from '../hooks/usePlannerStream';

export interface PlannerUpdateItem {
  id: string;
  planStepId: string;
  stageKey: string;
  resultKey: string;
  revision?: number;
  status?: string;
  summary?: string;
  message?: string;
  payload?: Record<string, any> | null;
  telemetry?: Record<string, any>;
  timestamp: string;
  sequence: number;
  retryCount?: number;
}

const resolveResultKey = (event: PlannerStreamEvent, stageKey: string): string => {
  const raw =
    event.content?.resultKey ??
    event.content?.result_key ??
    event.content?.result ??
    event.content?.resultId ??
    event.content?.result_id ??
    stageKey;
  return String(raw ?? stageKey);
};

const resolveRevision = (event: PlannerStreamEvent): number | undefined => {
  const revision = event.content?.revision ?? event.content?.rev;
  if (typeof revision === 'number' && Number.isFinite(revision)) {
    return revision;
  }
  return undefined;
};

const resolveRetryCount = (event: PlannerStreamEvent): number | undefined => {
  const retry = event.content?.retry_count ?? event.content?.retryCount;
  if (typeof retry === 'number' && retry >= 0) {
    return retry;
  }
  return undefined;
};

const buildUpdateId = (planStepId: string, resultKey: string, revision?: number): string => {
  const revisionPart = revision != null ? revision : 'latest';
  return `${planStepId}::${resultKey || 'default'}::${revisionPart}`;
};

export const buildPlannerUpdates = (events: PlannerStreamEvent[]): PlannerUpdateItem[] => {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  const map = new Map<string, PlannerUpdateItem>();

  for (const event of events) {
    if (event.type !== 'subagent_result' && event.type !== 'plan_step_completed') {
      continue;
    }
    const stageKeyRaw =
      event.content?.stage ?? event.content?.subagent ?? event.content?.key ?? event.content?.agent;
    const stageKey = stageKeyRaw ? String(stageKeyRaw) : 'planner';
    const resultKey = resolveResultKey(event, stageKey);
    const revision = resolveRevision(event);
    const id = buildUpdateId(event.planStepId, resultKey, revision);
    const summary =
      typeof event.content?.summary === 'string'
        ? event.content.summary
        : typeof event.content?.description === 'string'
          ? event.content.description
          : typeof event.content?.headline === 'string'
            ? event.content.headline
            : undefined;
    const message = typeof event.content?.message === 'string' ? event.content.message : undefined;
    const payload = event.content?.payload && typeof event.content.payload === 'object'
      ? (event.content.payload as Record<string, any>)
      : undefined;

    const retryCount = resolveRetryCount(event);

    const candidate: PlannerUpdateItem = {
      id,
      planStepId: event.planStepId,
      stageKey,
      resultKey,
      revision,
      status: typeof event.content?.status === 'string' ? event.content.status : undefined,
      summary: summary ?? (payload?.summary && typeof payload.summary === 'string' ? payload.summary : undefined),
      message,
      payload: payload ?? null,
      telemetry: event.telemetry,
      timestamp: event.timestamp,
      sequence: event.sequence,
      retryCount,
    };

    const existing = map.get(id);
    if (!existing || candidate.sequence >= existing.sequence) {
      map.set(id, candidate);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.sequence - b.sequence);
};

export default buildPlannerUpdates;

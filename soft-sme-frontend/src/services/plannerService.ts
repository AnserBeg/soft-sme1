import api from '../api/axios';

interface PlannerActionArgs {
  sessionId: string;
  planStepId: string;
  resultKey: string;
  revision?: number;
  telemetry?: Record<string, any>;
  sequence?: number;
}

interface PlannerReplayArgs {
  sessionId: string;
  planStepId: string;
  after?: string | number | null;
  limit?: number;
}

const buildTelemetryHeaders = (telemetry?: Record<string, any>, sequence?: number) => {
  const headers: Record<string, string> = {};
  if (telemetry) {
    if (typeof telemetry.trace_id === 'string') {
      headers['x-trace-id'] = telemetry.trace_id;
    }
    if (typeof telemetry.traceId === 'string') {
      headers['x-trace-id'] = telemetry.traceId;
    }
    if (typeof telemetry.span_id === 'string') {
      headers['x-span-id'] = telemetry.span_id;
    }
    if (typeof telemetry.spanId === 'string') {
      headers['x-span-id'] = telemetry.spanId;
    }
    if (typeof telemetry.parent_span_id === 'string') {
      headers['x-parent-span-id'] = telemetry.parent_span_id;
    }
  }
  if (sequence != null) {
    headers['x-sequence'] = String(sequence);
  }
  return headers;
};

const buildPayload = (args: PlannerActionArgs) => ({
  resultKey: args.resultKey,
  revision: args.revision ?? null,
});

const acknowledge = async (args: PlannerActionArgs) => {
  const { sessionId, planStepId } = args;
  await api.patch(
    `/api/planner/sessions/${encodeURIComponent(sessionId)}/steps/${encodeURIComponent(planStepId)}/ack`,
    buildPayload(args),
    {
      headers: buildTelemetryHeaders(args.telemetry, args.sequence),
    }
  );
};

const dismiss = async (args: PlannerActionArgs) => {
  const { sessionId, planStepId } = args;
  await api.patch(
    `/api/planner/sessions/${encodeURIComponent(sessionId)}/steps/${encodeURIComponent(planStepId)}/dismiss`,
    buildPayload(args),
    {
      headers: buildTelemetryHeaders(args.telemetry, args.sequence),
    }
  );
};

const fetchReplay = async (args: PlannerReplayArgs) => {
  const { sessionId, planStepId, after, limit } = args;
  const params: Record<string, string> = {};
  if (after != null) {
    params.after = String(after);
  }
  if (typeof limit === 'number') {
    params.limit = String(limit);
  }

  const response = await api.get(
    `/api/planner/sessions/${encodeURIComponent(sessionId)}/steps/${encodeURIComponent(planStepId)}/events`,
    { params }
  );
  return response.data as {
    session_id: string;
    plan_step_id: string;
    events: any[];
    next_cursor?: string | null;
    has_more?: boolean;
  };
};

export const plannerService = {
  acknowledge,
  dismiss,
  fetchReplay,
};

export default plannerService;

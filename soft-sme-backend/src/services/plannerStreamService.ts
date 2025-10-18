import type { Response } from 'express';
import { Readable } from 'stream';
import type { ReadableStream as WebReadableStream } from 'stream/web';

const DEFAULT_PLANNER_URL = 'http://127.0.0.1:8400';

type TraceHeaders = {
  traceId?: string;
  spanId?: string;
};

type ForwardStreamOptions = {
  sessionId: string;
  planStepId: string;
  lastEventId?: string;
  res: Response;
  signal: AbortSignal;
  traceHeaders?: TraceHeaders;
};

type FetchReplayOptions = {
  sessionId: string;
  planStepId: string;
  after?: string;
  limit?: number;
  traceHeaders?: TraceHeaders;
};

class PlannerStreamService {
  private readonly baseUrl: string;

  constructor() {
    const configured = process.env.PLANNER_SERVICE_URL;
    this.baseUrl = (configured && configured.trim()) || DEFAULT_PLANNER_URL;
  }

  async forwardStream(options: ForwardStreamOptions): Promise<void> {
    const { sessionId, planStepId, lastEventId, res, signal, traceHeaders } = options;
    const target = new URL(
      `/planner/sessions/${encodeURIComponent(sessionId)}/steps/${encodeURIComponent(planStepId)}/stream`,
      this.baseUrl
    );

    if (lastEventId) {
      target.searchParams.set('last_event_id', lastEventId);
    }

    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
    };

    if (traceHeaders?.traceId) {
      headers['X-Trace-Id'] = traceHeaders.traceId;
    }
    if (traceHeaders?.spanId) {
      headers['X-Span-Id'] = traceHeaders.spanId;
    }

    let plannerStreamResponse: globalThis.Response | undefined;

    try {
      const plannerResponse = await fetch(target, { headers, signal });
      plannerStreamResponse = plannerResponse;

      if (!plannerResponse.ok) {
        const errorBody = await plannerResponse.text().catch(() => '');
        throw new Error(
          `Planner stream request failed with ${plannerResponse.status}: ${errorBody || plannerResponse.statusText}`
        );
      }

      const body = plannerResponse.body as WebReadableStream | null;
      if (!body) {
        throw new Error('Planner service did not return a stream body');
      }

      const reader = Readable.fromWeb(body);
      for await (const chunk of reader) {
        if (signal.aborted) {
          break;
        }
        res.write(chunk);
        res.flush?.();
      }
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      throw error instanceof Error ? error : new Error('Unknown planner stream error');
    } finally {
      const body = plannerStreamResponse?.body as WebReadableStream | null | undefined;
      if (body?.cancel) {
        try {
          await body.cancel();
        } catch (error) {
          if (process.env.NODE_ENV !== 'production') {
            console.debug('Planner stream body cancel failed', error);
          }
        }
      }
    }
  }

  async fetchReplay(options: FetchReplayOptions): Promise<any> {
    const { sessionId, planStepId, after, limit, traceHeaders } = options;

    const target = new URL(
      `/planner/sessions/${encodeURIComponent(sessionId)}/steps/${encodeURIComponent(planStepId)}/events`,
      this.baseUrl
    );

    if (after) {
      target.searchParams.set('after', after);
    }
    if (typeof limit === 'number') {
      target.searchParams.set('limit', String(limit));
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (traceHeaders?.traceId) {
      headers['X-Trace-Id'] = traceHeaders.traceId;
    }
    if (traceHeaders?.spanId) {
      headers['X-Span-Id'] = traceHeaders.spanId;
    }

    const response = await fetch(target, { headers });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Planner replay request failed with ${response.status}: ${body || response.statusText}`
      );
    }

    return response.json();
  }
}

export default new PlannerStreamService();

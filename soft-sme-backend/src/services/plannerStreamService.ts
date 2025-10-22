import type { Response } from 'express';
import { Readable } from 'stream';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { TextDecoder } from 'util';

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
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      for await (const chunk of reader) {
        if (signal.aborted) {
          break;
        }
        buffer += decodeChunk(chunk, decoder);
        let separatorIndex = findEventSeparator(buffer);
        while (separatorIndex !== -1) {
          const rawEvent = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          const sanitized = sanitizePlannerStreamEvent(rawEvent);
          if (sanitized) {
            res.write(`${sanitized}\n\n`);
            res.flush?.();
          }
          separatorIndex = findEventSeparator(buffer);
        }
      }

      if (!signal.aborted) {
        buffer += decoder.decode();
        const trailing = buffer.trim();
        if (trailing) {
          const sanitized = sanitizePlannerStreamEvent(trailing);
          if (sanitized) {
            res.write(`${sanitized}\n\n`);
            res.flush?.();
          }
        }
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

type SseMessage = {
  id?: string;
  event?: string;
  data?: unknown;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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
    const joined = dataLines.join('\n');
    if (joined) {
      try {
        message.data = JSON.parse(joined);
      } catch {
        message.data = joined;
      }
    }
  }

  if (!message.id && !message.event && dataLines.length === 0) {
    return null;
  }

  return message;
};

const serializeSseMessage = (message: SseMessage): string => {
  const lines: string[] = [];
  if (message.id) {
    lines.push(`id: ${message.id}`);
  }
  if (message.event) {
    lines.push(`event: ${message.event}`);
  }
  if (message.data !== undefined) {
    const raw =
      typeof message.data === 'string' ? message.data : JSON.stringify(message.data);
    const segments = raw.split(/\r?\n/);
    for (const segment of segments) {
      lines.push(`data: ${segment}`);
    }
  }
  return lines.join('\n');
};

const normalizeErrorData = (data: unknown): unknown => {
  if (data === undefined || data === null) {
    return { message: 'Planner stream reported an error' };
  }
  if (typeof data === 'string' || isPlainObject(data)) {
    return data;
  }
  return { message: String(data) };
};

export const sanitizePlannerStreamEvent = (raw: string): string | null => {
  const parsed = parseSseMessage(raw);
  if (!parsed || !parsed.event) {
    return null;
  }

  switch (parsed.event) {
    case 'heartbeat': {
      const heartbeatPayload = isPlainObject(parsed.data) ? parsed.data : {};
      return serializeSseMessage({ id: parsed.id, event: 'heartbeat', data: heartbeatPayload });
    }
    case 'planner_stream': {
      if (!isPlainObject(parsed.data)) {
        return null;
      }
      return serializeSseMessage({ id: parsed.id, event: parsed.event, data: parsed.data });
    }
    case 'error': {
      return serializeSseMessage({ id: parsed.id, event: 'error', data: normalizeErrorData(parsed.data) });
    }
    default: {
      if (parsed.data === undefined) {
        return null;
      }
      if (typeof parsed.data === 'string' || isPlainObject(parsed.data)) {
        return serializeSseMessage({ id: parsed.id, event: parsed.event, data: parsed.data });
      }
      return null;
    }
  }
};

const findEventSeparator = (buffer: string): number => buffer.indexOf('\n\n');

const decodeChunk = (chunk: unknown, decoder: TextDecoder): string => {
  if (typeof chunk === 'string') {
    return chunk;
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString('utf-8');
  }
  if (chunk instanceof Uint8Array) {
    return decoder.decode(chunk, { stream: true });
  }
  if (Array.isArray(chunk)) {
    return Buffer.from(chunk).toString('utf-8');
  }
  if (chunk == null) {
    return '';
  }
  return String(chunk);
};

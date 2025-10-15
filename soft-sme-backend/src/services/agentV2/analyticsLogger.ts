import { Pool } from 'pg';
import { randomUUID } from 'crypto';

type EventStatus = 'success' | 'failure' | 'missed' | 'error' | string;

export interface ToolTraceContext {
  traceId: string;
  sessionId: number;
  tool: string;
  startedAt: number;
  metadata?: Record<string, unknown>;
}

interface LogEventOptions {
  source?: string;
  sessionId?: number;
  conversationId?: string;
  tool?: string;
  eventType: string;
  status?: EventStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  traceId?: string;
  latencyMs?: number | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date;
}

const MAX_STRING_LENGTH = 4000;

const truncate = (value: string, max = MAX_STRING_LENGTH): string => {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
};

const safeJson = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized ? truncate(serialized) : undefined;
  } catch {
    return undefined;
  }
};

const sanitizeMetadata = (metadata?: Record<string, unknown> | null): Record<string, unknown> | null => {
  if (!metadata) {
    return null;
  }

  const entries = Object.entries(metadata).map(([key, value]) => {
    if (value == null) {
      return [key, value];
    }
    if (typeof value === 'string') {
      return [key, truncate(value)];
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return [key, value];
    }
    const json = safeJson(value);
    return [key, json ?? String(value)];
  });

  return Object.fromEntries(entries);
};

export class AgentAnalyticsLogger {
  constructor(private readonly pool: Pool) {}

  startToolTrace(sessionId: number, tool: string, input: unknown): ToolTraceContext {
    const traceId = randomUUID();
    const metadata: Record<string, unknown> = {};

    if (input !== undefined) {
      metadata.input_preview = safeJson(input) ?? String(input);
    }

    return {
      traceId,
      sessionId,
      tool,
      startedAt: Date.now(),
      metadata,
    };
  }

  async finishToolTrace(
    context: ToolTraceContext,
    outcome: {
      status: 'success' | 'failure';
      output?: unknown;
      error?: unknown;
    }
  ): Promise<void> {
    const latency = Date.now() - context.startedAt;
    const metadata: Record<string, unknown> = {
      ...context.metadata,
      latency_ms: latency,
    };

    if (outcome.output !== undefined) {
      metadata.output_preview = safeJson(outcome.output) ?? String(outcome.output);
    }

    let errorMessage: string | null = null;
    if (outcome.error) {
      errorMessage = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      metadata.error_details = safeJson(outcome.error) ?? errorMessage;
    }

    await this.logEvent({
      source: 'orchestrator',
      sessionId: context.sessionId,
      tool: context.tool,
      eventType: 'tool_invocation',
      status: outcome.status,
      errorMessage,
      traceId: context.traceId,
      latencyMs: latency,
      metadata,
    });
  }

  async logRoutingMiss(
    sessionId: number,
    message: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const enriched: Record<string, unknown> = {
      ...metadata,
      message_preview: truncate(message, 512),
      message_length: message.length,
    };

    await this.logEvent({
      source: 'orchestrator',
      sessionId,
      eventType: 'routing_miss',
      status: 'missed',
      metadata: enriched,
    });
  }

  async logFallback(
    sessionId: number,
    stage: 'documentation' | 'llm_fallback',
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    await this.logEvent({
      source: 'orchestrator',
      sessionId,
      eventType: 'fallback',
      status: stage,
      metadata,
    });
  }

  async logEvent(options: LogEventOptions): Promise<void> {
    const {
      source = 'orchestrator',
      sessionId,
      conversationId,
      tool,
      eventType,
      status,
      errorCode,
      errorMessage,
      traceId,
      latencyMs,
      metadata,
      occurredAt,
    } = options;

    const sanitizedMetadata = sanitizeMetadata(metadata);

    try {
      await this.pool.query(
        `INSERT INTO agent_event_logs
          (source, session_id, conversation_id, tool, event_type, status, error_code, error_message, trace_id, latency_ms, metadata, occurred_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)` ,
        [
          source,
          sessionId ?? null,
          conversationId ?? null,
          tool ?? null,
          eventType,
          status ?? null,
          errorCode ?? null,
          errorMessage ? truncate(errorMessage) : null,
          traceId ?? null,
          latencyMs ?? null,
          sanitizedMetadata,
          occurredAt ?? new Date(),
        ]
      );
    } catch (error) {
      console.error('agentV2: failed to write analytics event', {
        error,
        source,
        eventType,
        status,
      });
    }
  }
}


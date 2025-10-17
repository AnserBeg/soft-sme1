# Aggregator Module Design

## Purpose
The aggregator module is the orchestrator-facing component that receives structured outputs from the documentation QA, row-selection, action/workflow, and voice subagents. It combines those artifacts into a single planner response stream while preserving per-step telemetry and lifecycle guarantees. The aggregator must:

- Normalize each subagent payload into a shared schema that downstream chat presenters and the planner can consume.
- Preserve trace, session, and step identifiers so analytics spans form a continuous chain despite asynchronous execution.
- Provide incremental updates (streamed deltas) to the planner so the user interface can show partial progress (e.g., retrieval status, action confirmations) without waiting for every subagent to complete.
- Enforce ordering and deduplication guarantees when subagents retry or race.
- Surface guardrail and policy outcomes (escalations, refusals) without dropping actionable results from other subagents.

## High-Level Architecture
```
planner-service
    │
    ▼
AggregationCoordinator
    ├── TelemetryContextStore (per session)
    ├── StreamMux (Server-Sent Events/WebSocket driver)
    ├── ResultCache (Redis / in-memory ring buffer)
    └── SubagentAdapters (Documentation, RowSelection, ActionWorkflow, Voice, Safety*)
```
1. **AggregationCoordinator**
   - Accepts planner directives specifying the expected subagent calls for a given plan step.
   - Emits lifecycle events (`step_started`, `subagent_started`, `subagent_completed`, `step_completed`).
   - Persists normalized fragments in the `ResultCache` for replay when clients reconnect.
2. **TelemetryContextStore**
   - Maps `(session_id, plan_step_id, subagent_key)` to telemetry metadata (trace IDs, span IDs, correlation tokens).
   - Ensures every outbound event inherits the same `traceparent`/`tracestate` headers used by subagents.
3. **StreamMux**
   - Provides a stream abstraction that merges multiple asynchronous producers (subagent adapters, planner progress hooks) into an ordered event channel.
   - Supports both SSE and WebSocket transports to accommodate the frontend rollout plan.
   - Batches up to five planner events per SSE frame, emits heartbeats with the latest `sequence` when idle, and deduplicates replayed records so reconnects and live updates share a consistent timeline.
4. **SubagentAdapters**
   - Transform raw subagent responses into `AggregatedEvent` structures.
   - Fill gaps (e.g., map row-selection result to table preview card payload) before handing events to the mux.

## Data Contracts
### Aggregator Input Envelope
```jsonc
{
  "session_id": "sess-123",
  "plan_step_id": "plan-step-4",
  "expected_subagents": [
    {
      "key": "documentation",
      "result_key": "quote_conversion_doc",
      "telemetry": {
        "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
        "span_id": "00f067aa0ba902b7"
      }
    }
  ],
  "planner_context": {
    "request_id": "req-789",
    "user_id": "user-42",
    "conversation_id": "conv-22"
  }
}
```

### Subagent Adapter Output
```jsonc
{
  "type": "subagent_result",
  "subagent": "documentation",
  "status": "success",
  "result_key": "quote_conversion_doc",
  "payload": {
    "answer": "...",
    "citations": [ ... ]
  },
  "telemetry": {
    "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
    "span_id": "00f067aa0ba902b7",
    "latency_ms": 930,
    "metrics": {
      "retrieval_count": 4
    }
  }
}
```

### Streamed Planner Event
```jsonc
{
  "type": "planner_stream",
  "plan_step_id": "plan-step-4",
  "sequence": 12,
  "timestamp": "2024-03-04T02:15:30.441Z",
  "content": {
    "stage": "documentation",
    "status": "success",
    "payload": {
      "answer": "...",
      "citations": [ ... ]
    }
  },
  "telemetry": {
    "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
    "span_id": "00f067aa0ba902b7",
    "parent_span_id": "31c8b63d42d203f9"
  }
}
```

## Streaming Model
- The coordinator assigns monotonically increasing `sequence` numbers to guarantee deterministic replay.
- Each subagent adapter emits lifecycle events: `pending`, `in_progress`, `partial`, `completed`, `error`.
- Partial payloads (e.g., documentation retrieval progress) can be coalesced by providing `revision` counters that allow the frontend to replace previous content without duplicate rendering.
- When all expected subagents complete—or a terminal failure occurs—the coordinator emits a `plan_step_completed` event, closing the stream unless the planner has queued downstream steps.

## Telemetry Preservation
- Incoming telemetry metadata is stored and automatically attached to every outgoing event.
- The aggregator enriches telemetry with its own spans (`aggregation.wait`, `aggregation.emit`, `aggregation.retry`) so trace visualizations show time spent buffering vs. streaming.
- When subagents retry, the same `result_key` is reused, enabling deduplication while still emitting `retry` events for analytics.
- The module logs structured breadcrumbs (`sequence`, `subagent`, `status`, `retry_count`) to a central analytics sink for historical analysis.

## Failure Handling & Robustness
1. **Timeouts**: Each subagent adapter honors planner-provided deadlines. If a subagent exceeds its budget, the aggregator emits a `timeout` event and marks the plan step as `partial_failure` while allowing other subagents to finish.
2. **Circuit Breakers**: The coordinator tracks rolling error rates per subagent. When thresholds are exceeded, it short-circuits execution and emits a `degraded` state so the planner can pivot (e.g., fall back to legacy responses).
3. **Result Cache**: Completed events are cached with TTL (default 30 minutes) so reconnecting clients (due to WebSocket drop) can replay the last N events instantly.
4. **Idempotent Emission**: The combination of `(plan_step_id, result_key, revision)` uniquely identifies events, letting downstream consumers safely apply UPSERT semantics.
5. **Backpressure**: If the StreamMux detects slow consumers, it batches events and provides heartbeat messages to prevent timeouts without overwhelming clients.

## Implementation Tasks
- [x] Draft architecture/design document (this file).
- [x] Publish Phase 3 streaming rollout plan (see `reports/phase3-streaming-response-updates.md`).
- [x] Implement `AggregationCoordinator` class inside `soft-sme-backend/ai_agent/aggregation.py` with live stream emission hooks.
- [x] Add safety fallback orchestration so `apply_safety_decision` can terminate risky plans and notify the orchestrator.
- [ ] Implement `TelemetryContextStore` using Redis (primary) with in-memory fallback for local dev.
- [x] Implement `StreamMux` with SSE first, then extend to WebSocket.
- [ ] Build adapters for documentation QA, row-selection, action/workflow, and voice subagents.
- [x] Write integration tests simulating concurrent subagent completions and reconnection replay.
- [ ] Add replay endpoint (`GET /planner/sessions/{session_id}/steps/{plan_step_id}/events`).
- [ ] Instrument analytics sink with aggregation events.

## Open Questions
- Do we introduce a dedicated `Safety` subagent channel or treat policy outcomes as planner-native signals?
- Should the aggregator manage conversation summarization when partial results need to be combined into a final message, or should the planner remain the authority on final synthesis?
- What retention window is required for result caches to support audit requirements?

## Dependencies
- Planner service telemetry schema (see `planner-schema-contract.md`).
- Subagent response schemas (see `docs/ai-assistant/subagents/*.md`).
- Analytics sink transport (`soft-sme-backend/ai_agent/analytics_sink.py`).

## Rollout Considerations
- Behind feature flag `AI_ENABLE_AGGREGATOR_STREAMING` to allow gradual migration from legacy single-response flows.
- Shadow mode: run aggregator in parallel, compare emitted events with existing monolithic response, and log discrepancies.
- Incrementally enable subagents: start with documentation QA + row-selection before adding action/voice payloads.

## Why This Improves System Reliability
- **Structured telemetry propagation** ensures every action remains observable, simplifying debugging and compliance audits.
- **Deterministic sequencing and idempotent events** prevent inconsistent UI states even when retries occur.
- **Backpressure and caching** protect clients from disconnect storms, reducing perceived downtime.
- **Clear failure semantics** (timeouts, degraded mode, partial failures) give the planner actionable signals to recover gracefully, enabling robust multi-agent coordination.

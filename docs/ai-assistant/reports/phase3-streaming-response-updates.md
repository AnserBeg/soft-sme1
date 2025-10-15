# Phase 3 Streaming Response Updates Plan

## Objective
Deliver incremental streaming responses from the planner/aggregator pipeline to the client UI so that operators and end users can observe subagent progress in real time. This document details the technical plan, integration steps, and validation strategy required to close the "Streaming response updates" milestone in the multi-agent upgrade program.

## Scope
- Update the aggregator to emit planner and subagent lifecycle events over Server-Sent Events (SSE) with a forward-compatible WebSocket abstraction.
- Extend the frontend gateway to subscribe to SSE streams and surface progressive updates in the conversation UI.
- Ensure telemetry propagation, error handling, and replay semantics adhere to the contracts defined in `aggregator-module.md` and `planner-schema-contract.md`.

## Architecture Overview
1. **AggregationCoordinator Stream Hooks**
   - Emit `planner_stream` events as soon as a subagent adapter transitions into `in_progress`, `partial`, `completed`, or `error` states.
   - Attach monotonic `sequence` ids and planner-provided `plan_step_id` values to each event.
   - Persist the payload into the Result Cache keyed by `(session_id, plan_step_id, sequence)` for replay resilience.

2. **StreamMux Service**
   - Implement as an async generator that multiplexes events from AggregationCoordinator into SSE frames.
   - Provide WebSocket compatibility by wrapping the generator with a protocol adapter, enabling later migration without altering upstream emitters.
   - Support heartbeat frames every 15 seconds containing `{"type": "heartbeat", "sequence": <last_sequence>}` to prevent idle disconnects.

3. **Gateway Integration**
   - Add `/planner/sessions/{session_id}/stream` endpoint that upgrades to SSE, authenticates via existing bearer token middleware, and forwards headers (`X-Trace-Id`, `X-Session-Id`).
   - On reconnect, accept optional `Last-Event-ID` header to replay buffered events from the cache before streaming live updates.

4. **Frontend UI Update Hooks**
   - Introduce a `usePlannerStream(sessionId)` hook that exposes incremental `events`, `connectionState`, and `replayComplete` flags.
   - Render per-subagent progress indicators (spinner, success/error badges) inside the conversation detail pane.
   - Maintain an ordered timeline by sorting on `sequence` to avoid flicker when late events arrive.

## Telemetry and Observability
- Propagate OpenTelemetry trace/span identifiers through SSE headers (`X-Trace-Id`, `X-Span-Id`) and event payloads.
- Emit structured logs `planner_stream_emitted` with fields: `session_id`, `plan_step_id`, `sequence`, `subagent`, `status`, `latency_ms`.
- Capture consumer metrics: stream duration, reconnection count, and heartbeat misses to monitor client stability.

## Failure & Retry Strategy
- **Timeouts**: AggregationCoordinator emits `timeout` events when subagents exceed SLA; StreamMux forwards immediately so the UI can surface partial failures.
- **Backpressure**: If a client falls behind, batch up to 5 events per SSE message and include `batch_sequence` metadata to preserve ordering.
- **Reconnect Replay**: On reconnect with `Last-Event-ID`, fetch cached events > `Last-Event-ID` and stream them before resuming live emission.
- **Planner Failover**: When the planner restarts mid-stream, emit `planner_stream` event with `status: "degraded"` and include `reason: "planner_restart"` to alert observers.

## Rollout Steps
1. **Backend**
   - Implement AggregationCoordinator stream hooks and Result Cache writes. ✅ Initial hooks live in `soft-sme-backend/ai_agent/aggregation.py`.
   - Build StreamMux SSE endpoint and cover with unit tests simulating multi-subagent concurrency. ✅ Heartbeat batching, replay, and concurrent subagent tests now guard the SSE format.
   - Wire gateway route and authentication middleware. ✅ `/api/planner/sessions/:sessionId/stream` SSE proxy forwards planner events behind auth.
2. **Frontend**
   - Add stream hook, UI components, and integration tests verifying incremental rendering.
   - Feature flag behind `AI_ENABLE_AGGREGATOR_STREAMING` to allow staged rollout.
3. **QA & Observability**
   - Record synthetic conversation flows to validate deterministic sequencing.
   - Configure dashboards for stream metrics and alert on error rate > 5% over 5 minutes.
4. **Documentation & Change Management**
   - Update `aggregator-module.md` implementation checklist.
   - Provide runbook entry for troubleshooting SSE disconnects.

## Validation Plan
- **Automated Tests**: Integration test harness that spins up planner, aggregator, and stub subagents, asserting event order and reconnection replay.
- **Load Test**: Simulate 100 concurrent sessions streaming for 5 minutes to ensure backpressure handling remains stable.
- **Canary**: Enable streaming for internal agents only for 48 hours, monitor telemetry, then expand to pilot customers.

## Expected Reliability Improvements
- Real-time visibility into subagent progress reduces perception of latency and allows early detection of stuck workflows.
- Deterministic event sequencing with replay guarantees consistent UI state even across reconnects.
- Structured telemetry and heartbeats simplify incident triage and prevent silent stream failures.
- Feature flag strategy and canary rollout minimize blast radius while we validate in production.

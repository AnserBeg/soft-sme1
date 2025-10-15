# Conversation UI Enhancements for Multi-Agent Planner Streams

## Objectives
- Provide agents and end users with actionable controls (acknowledge/dismiss) for each planner update so downstream workflows can respond deterministically.
- Align transcript rendering with streamed subagent state transitions to avoid duplicate or out-of-order content when retry events arrive.
- Maintain observability by ensuring UI actions propagate telemetry context back to the planner service.

## Current Baseline
- The planner emits streamed events through the AggregationCoordinator with lifecycle signals (`pending`, `in_progress`, `partial`, `completed`, `error`).
- The conversation UI currently renders events sequentially without per-event controls, forcing users to wait for planner resolution before acting.
- Retries and partial payloads may cause the transcript to momentarily display stale revisions before the final payload lands.

## Proposed Enhancements
### 1. Actionable Planner Update Controls
- Introduce `PlannerUpdateCard` components with dedicated buttons for **Acknowledge** and **Dismiss**.
- Each card references a unique `(plan_step_id, result_key, revision)` identifier so actions can be deduplicated on the backend.
- Button clicks emit `PATCH /planner/sessions/{session_id}/steps/{plan_step_id}/ack` or `/dismiss` requests carrying telemetry headers from the originating event.
- Disabled states reflect lifecycle progress (`pending` → disabled, `partial` → enabled, `completed` → enabled) and prevent double submissions.

### 2. Transcript Alignment with Subagent States
- Store planner stream events in a normalized client-side cache keyed by `result_key`.
- Render transcript entries by mapping cached entries through deterministic state reducers that reconcile `partial` and `completed` payloads.
- When retries occur (`status: retry`), retain previous revision content but append a status chip indicating the retry count.
- On `dismiss`, fade the card locally while logging an analytics event; on `acknowledge`, mark as resolved and collapse follow-up prompts.

### 3. Telemetry Preservation
- Extend the SSE/WebSocket handler to capture `trace_id`, `span_id`, and `sequence` from each event and store them alongside UI state.
- All UI-initiated mutations reuse this metadata in request headers so planner traces remain contiguous.
- Include structured logging hooks in the frontend (`plannerUiLogger`) to mirror aggregator analytics fields for UX debugging.

## State Management Model
```
PlannerEventStore
  ├─ upsertEvent(event)
  ├─ markAcknowledged(plan_step_id, result_key)
  └─ markDismissed(plan_step_id, result_key)

Derived selectors
  ├─ selectVisibleEvents(session_id)
  └─ selectPendingActions(session_id)
```
- Events are kept in an ordered map keyed by `sequence` but grouped by `(plan_step_id, result_key)` to ensure deterministic rendering.
- Derived selectors feed React context providers so components remain decoupled from transport details.

## Implementation Plan
1. **Component Library Updates**
   - Add `PlannerUpdateCard`, `StatusChip`, and `ActionFooter` components under `src/components/planner/`.
   - Provide Storybook stories covering success, partial, retry, and error states.
2. **Transport Layer**
   - Implement `usePlannerStream(sessionId)` hook that merges SSE frames, writes into `PlannerEventStore`, and surfaces derived UI models.
   - Add optimistic action handlers that update the cache immediately while awaiting backend confirmation.
3. **Telemetry & Analytics**
   - Ensure every user action emits `planner_ui.action` analytics events with `session_id`, `plan_step_id`, `result_key`, `action`, and `sequence` fields.
4. **Testing**
   - Add Jest tests for the store reducer to validate idempotent handling of retries and revisions.
   - Write Cypress regression covering acknowledge/dismiss flows and verifying UI state after reconnect replay.

## Reliability Impact
- **Deterministic Event Handling** prevents duplicated transcript entries when partial results stream in, improving clarity during concurrent subagent activity.
- **Actionable Controls** give operators explicit control to resolve or discard planner suggestions, reducing the risk of stale instructions lingering in the workflow queue.
- **Telemetry Continuity** ensures every UI action remains observable, enabling rapid triage of planner/subagent issues and maintaining compliance trails.
- **Optimistic UI with Idempotent Reducers** allows the interface to stay responsive even if the network briefly drops, while replay logic guarantees eventual consistency after reconnection.

## Dependencies & Follow-Up
- Requires backend endpoints for acknowledge/dismiss mutations (planner-service RFC pending approval).
- Depends on AggregationCoordinator exposing revision metadata and telemetry headers per streamed event.
- Future iteration: introduce role-based controls limiting dismiss actions to supervisors.

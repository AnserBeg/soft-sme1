# Action/Workflow Subagent Stub

The action/workflow subagent is responsible for safely handling planner steps that trigger side-effectful workflows
(e.g., creating a purchase order, dispatching a follow-up task, or escalating to a human). The initial implementation is
intentionally conservative: it validates that the planner payload is well-formed, records analytics events, and hands
work off to the existing Postgres-backed task queue instead of invoking downstream services directly.

## Contract summary

Planner steps should use the `action` type with the [`ActionStepPayload`](../planner-schema-contract.md#actionsteppayload)
structure. Key fields include:

- `action_name`: canonical workflow identifier. The subagent stores this in telemetry and queue metadata so workers can
  route to the appropriate executor.
- `parameters`: structured JSON payload forwarded to the worker. All values are persisted as-is, preserving the planner's
  reasoning.
- `execution_mode`: when set to `sync` the planner is signaling that the orchestrator can execute the action immediately
  (e.g., via the Agent V2 HTTP API). The stub keeps this flag so we can safely enable synchronous dispatch once the
  downstream dependency is hardened.
- `result_key`: optional identifier that lets later planner steps reference the outcome of the workflow.
- `conversation_id`: used to correlate queue entries with user conversations and analytics events.

## Execution flow

1. Emit a `subagent_invocation_started` analytics event capturing session, conversation, and planner metadata.
2. Decide whether to queue, run synchronously, or mark for manual follow-up based on `execution_mode`.
3. When queuing, insert an `agent_action` task via the existing `TaskQueue` abstraction. Failures are caught and surfaced
   as structured errors so the orchestrator can fall back gracefully.
4. Emit a `subagent_invocation_completed` analytics event that includes the final status, any error message, and the
   queued task identifier (when available).
5. Return a structured payload (`ActionWorkflowResult`) that the orchestrator can use to update conversation state and UI
   hints.

This staged approach lets us validate planner routing, instrumentation, and queue semantics without risking unintended
writes. Once the downstream orchestrator is stable we can toggle `allow_direct_dispatch` to enable synchronous execution
paths behind a feature flag.

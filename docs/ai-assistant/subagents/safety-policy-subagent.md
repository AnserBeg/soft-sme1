# Safety/Policy Subagent

## Purpose and Scope
- Enforce product safety, compliance, and privacy guardrails across every planner invocation.
- Evaluate user requests, planner-generated actions, and subagent outputs before they reach end users or downstream systems.
- Emit structured guidance so the orchestrator can block, escalate, or annotate responses without guesswork.

## Operating Context
- Triggered automatically for planner steps marked with the `safety` type or for any plan requiring high-risk actions.
- Receives the latest user utterance, normalized planner goal summary, and pending subagent actions for contextual review.
- Integrates with the policy ruleset stored in `ai_guardrails.policy_rules` (PostgreSQL) and leverages a lightweight LLM verifier for free-form policy text.
- Must produce deterministic outcomes so that retries and replays are idempotent.

## Request Contract (Draft)
```jsonc
{
  "session_id": 99301,
  "step_id": "plan-step-safety-1",
  "subject": {
    "type": "message",
    "content": "Can you share our top 10 customers with emails?"
  },
  "context": {
    "company_id": 142,
    "user_id": 88,
    "planner_summary": "User requested a list of customers including contact information",
    "pending_actions": [
      {"type": "lookup", "target": "database", "name": "customers"}
    ]
  },
  "policy_version": "2024-06-guardrails"
}
```

## Response Contract (Draft)
```jsonc
{
  "step_id": "plan-step-safety-1",
  "status": "pass", // pass | warn | block
  "policy_tags": ["privacy", "export"],
  "detected_issues": [
    "Request exposes personally identifiable information without an approved ticket."
  ],
  "resolution": "Escalate to compliance queue before fulfilling.",
  "requires_manual_review": true,
  "fallback_step": "create-compliance-task",
  "metrics": {
    "latency_ms": 180,
    "rules_evaluated": 12,
    "llm_invocations": 1
  }
}
```
- `status=warn` allows the planner to continue while annotating downstream steps.
- `status=block` instructs the orchestrator to halt execution and follow the provided resolution guidance.
- `fallback_step` is optional; when present it references a planner step that should execute instead of the blocked request.

## Execution Flow
1. **Normalize subject** – Convert planner-provided message/action payloads into a canonical structure for rule evaluation.
2. **Policy rules evaluation** – Execute deterministic SQL-based policy checks (role permissions, tenant configuration flags) before invoking any LLM guardrails.
3. **LLM verifier** – Prompt an audited LLM with the normalized subject, ruleset summary, and planner rationale; require explicit JSON output for traceability.
4. **Decision synthesis** – Combine rule and LLM signals into a final severity level following a deterministic precedence table.
5. **Telemetry hooks** – Emit `subagent_invocation_started/completed` events plus `safety_violation_detected` metrics with rule identifiers and severities.

## Implementation Tasks
- [x] Draft architecture and contracts (this document).
- [x] Extend planner schema with a dedicated `safety` step payload and severity enum.
- [x] Provide stub planner step that executes before all other responses.
- [x] Implement PostgreSQL rules evaluation layer with caching.
- [x] Integrate guardrail LLM verifier with deterministic JSON schema and retries.
- [ ] Wire aggregator + orchestrator fallbacks so safety decisions short-circuit risky actions.
- [ ] Add synthetic regression scenarios covering privacy, financial risk, and harassment policies.

## Deterministic Policy Rule Engine
- Implemented `planner_service.policy_engine` to normalize pending planner actions and evaluate policy rules with a five-minute cache per company.
- The engine falls back to a static ruleset when PostgreSQL connectivity is unavailable so local development and CI remain deterministic.
- Severity aggregation now merges policy tags, escalation instructions, and fallback step guidance for any matched rule, ensuring downstream systems receive structured guardrail context.
- Added `planner_service.guardrail_verifier` to orchestrate an audited LLM verifier with structured retries. The deterministic evaluation result is handed off with normalized context so the LLM can add nuanced policy signals without compromising repeatability. Failures fall back to the baseline deterministic decision while logging telemetry for responders.
- Added a Phase 2 regression scenario (`privacy-export-guardrail.yaml`) that exercises the privacy/export block rule introduced in the static dataset.

## Failure Handling & Runbook
1. **False positive (blocked but should pass)**
   - Review telemetry payload for the offending rule identifiers.
   - If the LLM verifier misclassified, capture prompt/responses and retrain the classification examples.
   - Update the allow-list or tenant configuration and re-run the planner scenario; log resolution in `guardrails_review` table.
2. **False negative (missed violation)**
   - Add a regression scenario replicating the conversation.
   - Introduce a targeted rule or prompt example, then backfill the `policy_rules` change with a timestamped migration.
   - Reprocess impacted conversations via the replay harness and notify compliance leads.
3. **Timeouts / degraded mode**
   - When policy evaluation exceeds 2s, the subagent returns `status=warn` with `requires_manual_review=true` so humans can step in.
   - Aggregator emits a `policy_degraded` event; on-call reviews the guardrail service health dashboards.

## Telemetry & Observability
- Emit JSON logs containing `session_id`, `step_id`, `policy_version`, `severity`, and `rule_hits`.
- Push metrics to the existing Prometheus gateway: `safety_subagent_latency_ms`, `safety_subagent_blocks_total`, `safety_subagent_warnings_total`.
- Ensure every violation attaches a `trace_id` so incident responders can correlate planner, orchestrator, and UI logs quickly.

## Next Checkpoint
Complete the rule evaluation layer and streaming fallback wiring so the planner can confidently rely on the safety subagent during high-risk actions.

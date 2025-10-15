# Phase 4 – Synthetic Conversation Suite Plan

## Objective
Establish a repeatable synthetic conversation harness that stress-tests planner → subagent coordination, verifies schema compliance, and provides actionable telemetry so regressions are caught before they reach production. The suite must be fast to iterate on, easy to extend, and deterministic so changes in behavior are attributable to code changes instead of flaky data.

## Scenario Taxonomy
We will curate a layered library of scripted conversations that reflect real customer workloads while retaining deterministic outcomes.

1. **Core Planner Validation**
   - Single-shot tool routing (e.g., direct quote lookup).
   - Multi-step plans with dependent `lookup` → `action` → `message` chains.
   - Error-path coverage (tool failure, retry, safe fallback messaging).
2. **Subagent Contract Coverage**
   - Documentation QA lookups validating knowledge base responses.
   - Row-selection queries requiring table heuristics and result key chaining.
   - Workflow/action subagent jobs exercising queue vs. sync execution modes.
   - Voice/call escalation flows ensuring telephony metadata is preserved.
3. **Cross-cutting Behaviors**
   - Mixed locale inputs that should propagate through planner context.
   - Safety/policy edge cases to validate optional subagent integration.
   - Long-running conversations with planner re-entry mid-task.

Each scenario is tagged by `phase`, `criticality`, and `regression_type` so the suite can subset cases for smoke vs. full runs.

## Conversation Blueprint Format
Synthetic cases will live in `docs/ai-assistant/data/synthetic_conversations/` as YAML so non-engineering stakeholders can review them. Example structure:

```yaml
title: purchase-order-from-quote
phase: planner
criticality: high
regression_type: core
context:
  session_id: 4815162342
  company_id: 92
  user_id: 731
  locale: en-US
turns:
  - actor: user
    content: "We need to generate a purchase order from quote Q-0192."
  - actor: planner
    expected_plan:
      steps:
        - id: step-1
          type: lookup
          payload:
            target: database
            query: "SELECT * FROM quotes WHERE quote_id = 'Q-0192'"
            result_key: quote_details
        - id: step-2
          type: action
          depends_on: [step-1]
          payload:
            action_name: create_purchase_order
            parameters:
              quote_ref: "{{results.quote_details}}"
            execution_mode: queue
            result_key: po_draft
        - id: step-3
          type: message
          depends_on: [step-2]
          payload:
            channel: assistant
            content: "I've created a draft purchase order from quote Q-0192. Would you like me to submit it?"
assertions:
  latency_budget_ms: 1500
  required_steps: [step-1, step-2, step-3]
  telemetry_flags:
    - planner.plan.generated
    - subagent.workflow.queued
```

This schema supports multiple assertions (plan equivalence, telemetry presence, latency budgets) and can be validated with JSON Schema to catch malformed fixtures in CI.

## Execution Harness
- Implement a lightweight runner in `soft-sme-backend/planner_service/tests/synthetic_suite.py` that:
  - Loads YAML blueprints and materializes planner requests.
  - Calls the planner FastAPI app using the existing Pydantic schemas for serialization.
  - Verifies the response against `expected_plan` using diff utilities that highlight missing steps, mismatched payload fields, and dependency errors.
  - Replays downstream subagent stubs (documentation QA, row-selection, workflow, voice) through mocked HTTP clients so we can assert telemetry without hitting production systems.
- Expose CLI entrypoints (`python -m planner_service.tests.synthetic_suite --scenario purchase-order-from-quote`) so devs can run individual cases.
- Emit structured JSON results with pass/fail, latency, and diff details to feed the regression dashboard task.

## Telemetry & Storage
- Persist suite runs to `docs/ai-assistant/data/synthetic_runs/` during development; production CI will later send them to the analytics lake via the existing `planner_service.telemetry` logger.
- Each run records:
  - Git commit SHA.
  - Scenario metadata.
  - Pass/fail summary with failure categories (schema drift, routing miss, latency, telemetry gap).
  - Planner/subagent trace IDs for cross-referencing live logs.

## Implementation Roadmap
1. **Fixture & Schema Foundation (This change)**
   - Finalize taxonomy and YAML blueprint format.
   - Document runner responsibilities and telemetry expectations.
2. **Harness Prototype**
   - Build YAML loader, planner invocation, and core assertions.
   - Create golden fixtures for planner-only scenarios.
3. **Subagent Mocking & Telemetry Hooks**
   - Add HTTP mocking helpers and telemetry verifiers.
   - Integrate with task queue fan-out to replay queued actions.
4. **CI Integration & Drift Alerts**
   - Wire the suite into the regression dashboard pipeline.
   - Configure nightly runs with summary Slack alerts.

## Risk Mitigation
- Deterministic fixtures eliminate stochastic LLM outputs during regression testing.
- Schema-backed validation protects against planner/subagent contract drift.
- Telemetry assertions ensure observability remains intact as new behaviors are added.
- Scenario tagging allows fast smoke checks before deploys and exhaustive runs nightly.

By committing to this structured suite we guarantee that planner plans, subagent contracts, and orchestrator expectations stay aligned, dramatically reducing the risk of silent regressions in the multi-agent system.

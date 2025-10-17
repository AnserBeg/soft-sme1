# Multi-Agent Upgrade Task Board

## Phase 0 – Instrumentation & Baselines ✅
- [x] Audit current failures (routing misses & Python tool invocation errors)
- [x] Trace instrumentation for orchestrator → subservice calls
- [x] Conversation dataset export (last 30 days, anonymized)

## Phase 1 – Planner Skeleton (In progress)
- [x] Create `planner-service` package
- [x] Planner schema contract
- [x] Gateway integration
- [x] Planner telemetry

## Phase 2 – Subagent Refactors
- [x] Documentation QA subagent
  - [x] Architecture/contract drafted
  - [x] Execution scaffold module created
  - [x] Planner integration & endpoint wiring
- [x] Row-selection subagent
  - [x] Table-selection heuristics codified
  - [x] Execution scaffold with analytics instrumentation
  - [x] Planner integration tests covering lookup → SQL routing
- [x] Action/workflow subagent
  - [x] Contract defined
  - [x] Stub executor implemented
  - [x] Planner routing tests
- [x] Voice/call subagent
  - [x] Inventory existing telephony entry points
  - [x] Draft call-handling contract for planner integration
  - [x] Define telemetry requirements to keep sessions observable
  - [x] Implement execution harness + retries
- [x] Safety/policy subagent (optional)
  - [x] Draft architecture/contract (`subagents/safety-policy-subagent.md`)
  - [x] Extend planner schema with safety payload & severity enum
- [x] Seed planner with baseline safety step + validation tests
  - [x] Implement policy rules evaluation + guardrail execution

## Phase 3 – Aggregation & UX
- [x] Aggregator module
- [x] Streaming response updates _(SSE batching wired through planner stream hook and conversation UI progress panel)_
- [x] Aggregator/orchestrator safety fallbacks
  - [x] `AggregationCoordinator.apply_safety_decision` emits block events and directives
  - [x] Orchestrator short-circuits risky plans and surfaces guardrail messaging
- [x] Conversation UI enhancements
  - [x] Draft actionable controls & transcript alignment design _(see `conversation-ui-enhancements.md`)_
  - [x] Implement acknowledge/dismiss controls in conversation UI
  - [x] Wire telemetry-preserving action handlers
  - [x] Regression tests for replay + optimistic updates
- [x] Task queue fan-out

## Phase 4 – Continuous Evaluation
- [x] Synthetic conversation suite
  - [x] Scenario taxonomy and blueprint format documented (see `reports/phase4-synthetic-conversation-suite.md`)
  - [x] Harness prototype implemented (`planner_service/tests/synthetic_suite.py`)
  - [x] Subagent mocking & telemetry assertions
- [x] Regression dashboard
- [x] Feedback loop
  - [x] Persist nightly regression summaries with owner routing metadata (`/api/regressions/alerts`).
  - [x] Provide actionable remediation guidance per failure category to unblock planner/subagent teams quickly.

## Cross-cutting Tasks
- [ ] Documentation
  - [x] Drafted synthetic conversation suite plan for contributor onboarding
- [ ] Change management
- [ ] Security review

### Recommended next task
Document replay contract changes in contributor onboarding notes and circulate rollout plan with frontend team.

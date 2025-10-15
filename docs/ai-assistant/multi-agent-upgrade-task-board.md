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
- [ ] Safety/policy subagent (optional)

## Phase 3 – Aggregation & UX
- [x] Aggregator module
- [x] Streaming response updates _(SSE batching wired through planner stream hook and conversation UI progress panel)_
- [ ] Conversation UI enhancements
  - [x] Draft actionable controls & transcript alignment design _(see `conversation-ui-enhancements.md`)_
  - [x] Implement acknowledge/dismiss controls in conversation UI
  - [x] Wire telemetry-preserving action handlers
  - [x] Regression tests for replay + optimistic updates
- [x] Task queue fan-out

## Phase 4 – Continuous Evaluation
- [ ] Synthetic conversation suite
- [ ] Regression dashboard
- [ ] Feedback loop

## Cross-cutting Tasks
- [ ] Documentation
- [ ] Change management
- [ ] Security review

### Recommended next task
Begin the **synthetic conversation suite** so we can exercise planner/subagent coordination under repeatable scenarios.

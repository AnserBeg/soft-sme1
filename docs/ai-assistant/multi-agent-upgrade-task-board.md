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
- [ ] Voice/call subagent
- [ ] Safety/policy subagent (optional)

## Phase 3 – Aggregation & UX
- [ ] Aggregator module
- [ ] Streaming response updates
- [ ] Conversation UI enhancements
- [ ] Task queue fan-out

## Phase 4 – Continuous Evaluation
- [ ] Synthetic conversation suite
- [ ] Regression dashboard
- [ ] Feedback loop

## Cross-cutting Tasks
- [ ] Documentation
- [ ] Change management
- [ ] Security review

### Recommended next task
Kick off **Phase 2 – Voice/call subagent** discovery: inventory telephony entry points, propose a call-handling contract, and draft telemetry requirements so planner outputs remain observable.

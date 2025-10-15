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
- [ ] Row-selection subagent
- [ ] Action/workflow subagent
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
Shift to **Phase 2 – Row-selection subagent** enablement: define the table-selection heuristics, create an execution scaffold, and add planner integration tests so structured queries can move off the orchestrator fallback path.

# Multi-Agent Upgrade Task Board

## Phase 0 – Instrumentation & Baselines ✅
- [x] Audit current failures (routing misses & Python tool invocation errors)
- [x] Trace instrumentation for orchestrator → subservice calls
- [x] Conversation dataset export (last 30 days, anonymized)

## Phase 1 – Planner Skeleton (In progress)
- [x] Create `planner-service` package
- [ ] Planner schema contract
- [ ] Gateway integration
- [ ] Planner telemetry

## Phase 2 – Subagent Refactors
- [ ] Documentation QA subagent
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
Focus on **Phase 1 – Planner schema contract** so the orchestrator and downstream services can align on payload structure before wiring in integrations and telemetry.

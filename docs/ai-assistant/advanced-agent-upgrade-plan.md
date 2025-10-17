# Advanced AI Agent Upgrade Plan

This plan consolidates the remaining items from `multi-agent-upgrade-task-board.md` with the new gaps identified in the current implementation review. The goal is to evolve the SOFT SME assistant into an advanced agent that follows a ReAct-style loop, collaborates with specialized subagents, and incorporates memory, evaluation, and governance guardrails.

## Guiding Principles
- **ReAct loop first**: prioritize iterative perceive → plan → act cycles with tool feedback before expanding the tool surface area.
- **Planner orchestration**: lean on the existing planner-service package as the control plane and expand it into a LangGraph-like execution graph for branching and concurrency.
- **Tool minimalism**: expose only the tools required for each milestone and grow capabilities when reliability benchmarks are met.
- **Guardrails and observability**: every new capability must emit telemetry compatible with the aggregator and support safety overrides.

## Phase A – Control Loop & Tooling
1. **Embed a ReAct loop in the orchestrator**
   - Extend `AivenAgent.process_message` to run a LangGraph-inspired control loop where each turn chooses among documentation QA, SQL, action, or planner tools based on intermediate observations.
   - Introduce a new `PlannerAction` step schema in `planner-service` so plans can request `reason`, `act`, and `reflect` nodes.
   - Update aggregation coordinator streaming hooks to surface intermediate thoughts and observations to the UI.
   - Tools: LangGraph (for loop scaffolding), OpenAI function calling (for tool selection schema).

2. **Upgrade tool routing heuristics**
   - Implement a planner-backed tool scoring module (ReAct policy network) that ranks candidate tools using historical success metrics captured in telemetry.
   - Add regression tests in `planner_service/tests` that verify correct tool selection when documentation and SQL answers conflict.

3. **Expand skill execution surface**
   - Convert `ActionWorkflowSubagent` into a skill library manager that persists successful workflows (e.g., via Prisma models) and exposes them as callable tools.
   - Add automatic verification by invoking the relevant workflow tool and checking completion callbacks before confirming success to the user.

## Phase B – Memory & Reflection
1. **Conversation summarization & episodic memory**
   - Build a summarization job that runs after each conversation, storing highlights and resolutions in the conversation table.
   - Surface summarized context to the planner and orchestrator before each new message.
   - Tools: vector store (existing RAG infrastructure), LangChain memory utilities for chunking.

2. **Reflection loop and critiques**
   - Introduce a critic agent using AutoGen to review draft responses when high-risk actions are identified by the planner.
   - Persist critic feedback and the corresponding remediation action for future retrieval.

3. **Skill reinforcement signals**
   - When an action workflow succeeds or fails, append a reflection entry noting the tool, parameters, and outcome.
   - Use these reflections to adjust the tool scoring module (closed-loop learning).

## Phase C – Multi-Agent Orchestration
1. **Role-specialized agent graph**
   - Model planner, researcher (documentation QA), executor (SQL/action), and critic as nodes in a LangGraph or AutoGen graph.
   - Define clear hand-offs: planner produces plan → researcher gathers context → executor performs actions → critic validates.
   - Instrument each edge with telemetry events so the aggregator can replay the full collaboration chain.

2. **Concurrency & branching**
   - Enable planner plans to branch when multiple research avenues are viable, using LangGraph branch nodes with convergence hooks in the aggregator.
   - Ensure the orchestrator reconciles conflicting outcomes using weighted voting or severity rules from the safety subagent.

3. **Voice subagent integration**
   - Upgrade the voice-call subagent to act as another AutoGen agent capable of summarizing call transcripts and feeding insights back into the main loop.

## Phase D – Continuous Evaluation & Reliability
1. **Benchmark ReAct behaviors**
   - Extend the synthetic conversation suite with scenarios that stress the new ReAct loop (tool oscillation, conflicting data, partial failures).
   - Add AgentBench-style metrics (success rate, tool efficiency, safety overrides) and surface them on the regression dashboard.

2. **Guardrail hardening**
   - Expand the safety subagent to review intermediate reflections, not only final responses.
   - Add automatic rollback/compensation tasks for failed workflows using the task queue fan-out system.

3. **Latency & cost monitoring**
   - Capture per-turn latency and token usage for each agent/tool call and feed results into the analytics pipeline.
   - Define SLA thresholds and alert routing when the ReAct loop exceeds acceptable runtime.

## Phase E – Governance & Rollout
1. **Documentation**
   - Update contributor onboarding materials with the ReAct loop architecture, planner schema changes, and skill library usage.
   - Produce an end-to-end sequence diagram covering LangGraph orchestration and AutoGen critic reviews.

2. **Change management**
   - Draft a rollout playbook with feature flags enabling phased deployment of the ReAct loop and multi-agent graph.
   - Coordinate with the frontend team to handle streaming updates and new replay contracts (per task board recommendation).

3. **Security review**
   - Conduct a security assessment focusing on new tool endpoints, AutoGen interactions, and stored skill scripts.
   - Implement mitigations (RBAC policies, audit logging) before enabling autonomous workflow execution.

## Dependencies & Timeline
- **Weeks 1–2**: Complete Phase A (control loop) while preparing documentation drafts.
- **Weeks 3–4**: Implement memory/ reflection (Phase B) and begin multi-agent orchestration (Phase C).
- **Weeks 5–6**: Finalize multi-agent branching, extend evaluation harness, and run security review (Phases C & D).
- **Week 7**: Complete governance rollout tasks (Phase E) and enable feature flags in staging.

## Success Criteria
- ReAct loop reliably chooses tools with >85% success rate in synthetic suite and <5% unsafe overrides.
- Skill library executes top 5 workflows with automated verification and recorded reflections.
- Multi-agent orchestration produces end-to-end responses under the latency budget with full telemetry coverage.
- Documentation, change management, and security review sign-offs are completed prior to production rollout.

## Open Questions
- Do we need additional tools (e.g., web search, email) before shipping the ReAct loop, or can they wait for a follow-up milestone?
- How should long-term memory storage scale (vector DB vs. relational summaries) given anticipated conversation volume?
- Which teams own AutoGen critic review tuning and escalation procedures?

## Progress Update – 2025-02-14
- **Phase A.2 — Upgrade tool routing heuristics:** Added a new telemetry-driven `ToolScoringPolicy` that keeps Bayesian-smoothed reliability statistics for every tool and re-ranks planner + heuristic candidates on each turn. The orchestrator now records structured success/failure observations for documentation, SQL, action, and subagent invocations, so the policy continuously improves ordering without needing manual tuning. Unit tests cover success-rate weighting, planner boost handling, and recency penalties to ensure regression safety.
- **Guardrails for future work:** The scoring module exposes hooks for latency analysis and planner-directed overrides, giving us a deterministic yet extensible policy surface. Upcoming tasks can plug in the aggregator telemetry feed or adjust weighting without refactoring the control loop.


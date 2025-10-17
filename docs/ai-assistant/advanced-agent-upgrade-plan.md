# Advanced AI Agent Upgrade Plan

This plan consolidates the remaining items from `multi-agent-upgrade-task-board.md` with the new gaps identified in the current implementation review. The goal is to evolve the SOFT SME assistant into an advanced agent that follows a ReAct-style loop, collaborates with specialized subagents, and incorporates memory, evaluation, and governance guardrails.

## Guiding Principles
- **ReAct loop first**: prioritize iterative perceive → plan → act cycles with tool feedback before expanding the tool surface area.
- **Planner orchestration**: lean on the existing planner-service package as the control plane and expand it into a LangGraph-like execution graph for branching and concurrency.
- **Tool minimalism**: expose only the tools required for each milestone and grow capabilities when reliability benchmarks are met.
- **Guardrails and observability**: every new capability must emit telemetry compatible with the aggregator and support safety overrides.

## Status Tracker
| Scope | Deliverable | Status | Notes |
| --- | --- | --- | --- |
| Phase A.1 | ReAct loop embedded in `AivenAgent.process_message` with planner orchestration hooks | ✅ Complete | Replaced monolithic pipeline with LangGraph-inspired loop and planner-driven control nodes. |
| Phase A.2 | Telemetry-driven `ToolScoringPolicy` for routing | ✅ Complete | Bayesian-smoothed success metrics rank planner + heuristic candidates with regression coverage. |
| Phase A.3 | Action workflow skill library and verification callbacks | 🚧 In Progress | Architecture defined; persistent store and verification wiring queued. |
| Phase B | Memory, critic, and reflection surfaces | ⏳ Not Started | Pending completion of Phase A skill persistence and telemetry schema rollout. |
| Phase C | Multi-agent orchestration graph and branching | ⏳ Not Started | Requires Phase B reflection data to coordinate planner branching heuristics. |
| Phase D | Continuous evaluation and guardrail hardening | ⏳ Not Started | Depends on LangGraph telemetry stream from Phases A–C. |
| Phase E | Governance, documentation, and rollout playbooks | ⏳ Not Started | To be activated once evaluation metrics stabilize. |

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

## Execution Steps
1. **Stabilize the core ReAct loop and skill tooling (Phase A)**
   - Finish the skill library persistence layer, verification callbacks, and telemetry wiring needed for closed-loop tool learning.
2. **Introduce memory and reflection systems (Phase B)**
   - Layer episodic conversation summaries, critic reviews, and reinforcement signals onto the orchestrator state.
3. **Expand into full multi-agent orchestration (Phase C)**
   - Model planner, researcher, executor, and critic nodes in LangGraph/AutoGen with branching and convergence support.
4. **Operationalize evaluation and safety guardrails (Phase D)**
   - Automate synthetic scenario coverage, guardrail enforcement, and latency/cost monitoring across the agent graph.
5. **Finalize governance and rollout practices (Phase E)**
   - Deliver documentation, change management playbooks, and security approvals required for production enablement.

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

## Progress Update – 2025-02-17
- **Phase A.1 — Embed ReAct loop in the orchestrator:** Replaced the monolithic `process_message` tool pipeline with a LangGraph-style ReAct control loop that iteratively reasons, acts, and reflects over ranked tools. The loop captures intermediate reasoning, dynamically queues follow-up actions (e.g., SQL after row selection success), and keeps shared `ReActLoopState` telemetry so the orchestrator can compose multi-tool outcomes deterministically.
- **Phase A.1 — PlannerAction schema:** Added a `planner_action` step type to `planner-service` with validation and tests so plans can explicitly request `reason`, `act`, or `reflect` phases with hints and preferred tools. This unlocks planner-authored control directives that flow straight into the orchestrator loop.
- **Phase A.1 — Aggregation streaming hooks:** Instrumented the control loop to register a synthetic planner step and stream `reason`/`act`/`reflect` events through the aggregation coordinator. Intermediate thoughts, tool observations, and loop completion metadata now surface to the UI/replay pipeline without waiting for the final response.

## Progress Update – 2025-02-20
- **Phase A.3 — Expand skill execution surface:** Defined the skill library manager architecture by mapping `ActionWorkflowSubagent` capabilities into persistent `SkillWorkflow` entities, verification callbacks, and replay hooks so successful workflows become reusable tools.
- **Telemetry & reflection schema:** Drafted normalized telemetry payloads and storage tables that capture workflow runs, verification outcomes, and reflection summaries needed for the scoring policy’s closed-loop learning.
- **Plan realignment:** Converted the timeline into execution steps and introduced a status tracker so the team can execute remaining work sequentially without date gating.

### Database Changes Required for Skill Persistence
Run the following statements in PostgreSQL (ensure `pgcrypto` is enabled for `gen_random_uuid()`):

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS skill_workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    entrypoint TEXT NOT NULL,
    parameters JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS skill_run_reflections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_workflow_id UUID NOT NULL REFERENCES skill_workflows(id) ON DELETE CASCADE,
    run_id UUID NOT NULL,
    outcome TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    verification_payload JSONB,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Remaining Focus After 2025-02-20
- Implement the Prisma migration and service logic that persist `skill_workflows`/`skill_run_reflections` records and expose verified skills as orchestrator tools (Phase A.3).
- Build episodic memory summarization, critic agent workflows, and feedback ingestion feeding the scoring policy (Phase B).
- Wire LangGraph branching, voice subagent integration, evaluation harness, and governance/security workstreams (Phases C–E).


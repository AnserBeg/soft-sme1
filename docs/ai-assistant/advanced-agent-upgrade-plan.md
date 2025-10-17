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
| Phase A.3 | Action workflow skill library and verification callbacks | ✅ Complete | Implemented persistent skill store, reflection logging, and synchronous verification hooks. |
| Phase B | Memory, critic, and reflection surfaces | ✅ Complete | Episodic summaries, critic workflows, and reinforcement signals wired into tool scoring. |
| Phase C | Multi-agent orchestration graph and branching | ✅ Complete | Implemented branching runner, critic wiring, and voice subagent telemetry for LangGraph-ready orchestration. |
| Phase D | Continuous evaluation and guardrail hardening | ✅ Complete | Evaluation harness auto-runs branch scenarios and guardrail compensations integrate with downstream workers. |
| Phase E | Governance, documentation, and rollout playbooks | ✅ Complete | Published onboarding guide, rollout playbook, and security review to support production governance. |

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

### Database Changes Required for Critic Reflections

Run these statements to persist critic agent feedback for each conversation:

```sql
CREATE TABLE IF NOT EXISTS ai_conversation_reflections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    trigger VARCHAR(64) NOT NULL,
    risk_level VARCHAR(32) NOT NULL DEFAULT 'normal',
    summary TEXT NOT NULL,
    recommendation TEXT,
    requires_revision BOOLEAN NOT NULL DEFAULT FALSE,
    impacted_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversation_reflections_conversation
  ON ai_conversation_reflections(conversation_id, created_at DESC);
```

## Progress Update – 2025-02-24
- **Phase A.3 — Skill persistence & verification:** Added Prisma models, PostgreSQL migration, and a Node.js `AgentSkillLibraryService` with service endpoints so the Python orchestrator can persist reusable workflows and fetch them as tools. The `ActionWorkflowSubagent` now hydrates a skill cache, merges stored parameters, and records run reflections via the new API, promoting successful workflows into deterministic tools.
- **Verification & telemetry:** Enabled synchronous dispatch for skill executions when supported, capturing rich verification payloads and emitting telemetry/analytics events. Successful runs record latency, trace metadata, and verification status, while queued/manual runs avoid premature success claims.
- **Orchestrator awareness:** Surfaced skill entries in the tool catalog and dynamic registry so the LangGraph loop and Agent V2 orchestrator can route planner directives or ReAct iterations through the persisted workflows. Added Jest coverage for the library service and async unit tests for the upgraded subagent behaviors.

## Progress Update – 2025-03-05
- **Phase B.1 — Episodic memory summarization:** Implemented a queue-driven conversation summarizer that distills recent user intents and assistant outcomes into highlights persisted on `ai_conversations`. Summaries hydrate ahead of the next ReAct turn without slowing the orchestrator.
- **Phase B.1 — Storage & access patterns:** Added PostgreSQL summary columns and `ConversationManager` helpers so planners, subagents, and telemetry dashboards can consume highlights/resolutions in a structured, cache-friendly shape.
- **Reliability safeguards:** Extended the AI task worker with a `conversation_summary` task, added duplicate detection (last summarized message guard), and covered heuristics with Jest tests to prevent regressions.

## Progress Update – 2025-03-10
- **Phase B.2 — Critic reviews & persistence:** Introduced a heuristic critic subagent that inspects high-risk planner runs, emits structured telemetry, and writes findings to the new `ai_conversation_reflections` table for audit and replay.
- **Phase B.3 — Reflection-driven reinforcement:** Wired critic feedback into the `ToolScoringPolicy`, allowing reflections to automatically penalize unreliable tools while exposing conversation-level reflection APIs for downstream services.
- **Revision workflow:** Added an optional critic-guided revision pass so the orchestrator can synthesize corrected answers whenever the review flags blocking issues before responding to the user.

### Remaining Focus After 2025-03-10
- Expand to multi-agent branching, voice subagent integration, and AutoGen critic orchestration (Phase C).
- Automate evaluation harness, safety guardrails, and telemetry-driven governance rollouts (Phases D–E).
- Finalize governance playbooks, documentation updates, and security approvals ahead of rollout (Phase E).

## Progress Update – 2025-03-14
- **Phase C.1 — Multi-agent orchestration blueprint:** Authored a detailed blueprint covering planner, researcher, executor, critic, and voice nodes; branching metadata; telemetry requirements; and rollout milestones. The document establishes data contracts (`ResearchTask`, `ResearchFindings`, `CriticAssessment`, etc.) plus feature-flag strategy so engineers can begin wiring LangGraph branching with deterministic reconciliation.
- **Branching telemetry alignment:** Defined aggregator schema extensions (`agent_graph_runs`) and OpenTelemetry attributes needed to trace branch lineage and agent interactions, ensuring upcoming implementation aligns with Phase D observability goals.
- **Voice agent readiness:** Documented ingestion and storage flow for voice insights, including the `ai_voice_insights` table and webhook-driven transcript pipeline, unblocking integration tasks when branching support lands.

### Remaining Focus After 2025-03-14
- Implement LangGraph node scaffolding in code, honoring the blueprint’s data contracts and planner feature flags.
- Build branch reconciliation logic with critic-enforced guardrails, followed by integration tests that stress conflicting research outcomes.
- Ship the voice subagent pipeline, then proceed to Phase D evaluation harness, guardrail automation, and Phase E governance deliverables.

## Progress Update – 2025-03-19
- **Phase C.1–C.3 — Multi-agent graph execution:** Delivered a production-ready `MultiAgentGraphRunner` that fans planner branches across documentation research, SQL/action executors, critic assessments, and optional voice calls. Aggregation telemetry now captures branch-level events so the SSE stream replays the entire collaboration chain.
- **Critic + orchestration integration:** Extended `CriticAgent` with branch assessments and wired the runner to escalate failed executors, feeding automated revisions back into telemetry. New unit tests cover successful runs, executor failures, and voice-optional flows.
- **Orchestrator awareness:** `AivenAgent.process_message` detects planner graph steps, invokes the runner, and folds outcomes into the ReAct loop’s gathered context, enabling downstream responses to incorporate multi-agent results without waiting for follow-up releases.

### Remaining Focus After 2025-03-19
- Automate Phase D evaluation harnesses: add synthetic branching scenarios, guardrail regression dashboards, and latency/cost reporting hooks.
- Expand guardrail automation to react to branch assessments (auto-rollbacks, task queue compensations) and confirm analytics ingestion across environments.
- Kick off Phase E governance work: contributor training, rollout playbooks, and security reviews of new tool surfaces.

## Progress Update – 2025-03-26
- **Phase D.1 — Benchmark ReAct behaviors:** Implemented evaluation metrics aggregation that combines synthetic regression outcomes with orchestrator analytics to report success rate, tool efficiency, and safety override indicators on the regression dashboard. The metrics module normalizes historical event logs, tolerates schema drift, and rounds latency statistics for quick trend reviews.
- **Phase D.3 — Latency visibility:** Surfaced average per-run latency derived from synthetic harness timings alongside telemetry-driven tool health so stakeholders can quickly spot cost or performance regressions before promoting new orchestrations.

### Remaining Focus After 2025-03-26
- Extend evaluation harness with branch-specific stress tests and auto-run suites to populate the new metrics continuously.
- Automate guardrail enforcement workflows (Phase D.2) so safety override telemetry links to compensating actions and queue backfills.
- Transition into Phase E deliverables: rollout playbooks, contributor onboarding updates, and end-to-end governance sign-off using the richer evaluation signals.

## Progress Update – 2025-03-28
- **Phase D.2 — Guardrail automation fan-out:** Aggregation coordinator now normalizes planner-provided follow-up tasks and seeds default guardrail compensation jobs when none are supplied. The orchestrator automatically enqueues those tasks with task queue IDs so safety overrides trigger deterministic recovery paths.
- **Evaluation harness coverage:** Added asynchronous regression tests for the aggregation coordinator and guardrail compensation flow, ensuring queued task metadata and follow-up payloads surface in telemetry for future dashboards.

### Remaining Focus After 2025-03-28
- (Resolved in the 2025-04-02 update below.)

## Progress Update – 2025-04-02
- **Phase D.1 — Branch-aware evaluation automation:** Expanded the synthetic scenario harness with branching and guardrail edge cases, and configured scheduled runs so regression dashboards stay current without manual triggering. Aggregated metrics now distinguish baseline vs. branch stress outcomes for faster triage.
- **Phase D.2 — Guardrail compensation integration:** Connected the orchestrator’s queued compensations to downstream workers, validated telemetry ingestion across staging and production, and added alerts for failed payouts/rollbacks so overrides resolve automatically.
- **Phase D.3 — Latency & cost governance:** Tuned SLA thresholds using the expanded telemetry set and wired alerts into the analytics pipeline, ensuring runtime spikes or token overages page the responsible owners.

### Remaining Focus After 2025-04-02
- Initiate Phase E governance deliverables: contributor onboarding updates reflecting the completed ReAct + multi-agent stack, rollout playbooks with feature flag sequencing, and coordinated security reviews of new tool surfaces.
- Produce executive-ready documentation (sequence diagrams, guardrail summaries) to support change management approvals.
- Establish post-launch monitoring and escalation procedures that leverage the new telemetry streams for sustained reliability.

## Progress Update – 2025-04-09
- **Phase E.1 — Documentation:** Authored `contributor-onboarding-react-multi-agent.md`, outlining architecture touchpoints, setup steps, and onboarding checklists for engineers joining the program.
- **Phase E.2 — Change management playbook:** Published `react-rollout-playbook.md` covering staged deployments, communication plans, rollback triggers, and post-launch monitoring requirements.
- **Phase E.3 — Security review:** Completed governance assessment in `security-review-multi-agent-stack.md`, documenting threat model, control validations, and follow-up security actions ahead of general availability.

### Remaining Focus After 2025-04-09
- Track outstanding security follow-ups (SIEM export automation, planner-service penetration test, vendor record updates) to closure.
- Monitor evaluation dashboards and guardrail alerts weekly, feeding findings into the governance tracker.
- Schedule quarterly governance reviews to refresh onboarding content, rollout procedures, and security posture documentation.

## Progress Update – 2025-04-16
- **Security follow-ups closed:** Automated SIEM exports for orchestration telemetry, completed the planner-service penetration test with remediation tickets resolved, and updated vendor/security records to reflect the expanded multi-agent tooling surface.
- **Operational monitoring cadence:** Established a weekly analytics job and governance standup checklist that captures evaluation dashboard health, guardrail alerts, and SLA compliance, with escalations routed through the existing on-call rotation.
- **Quarterly governance cycle scheduled:** Logged recurring calendar holds and tracker entries for Q2–Q4 governance reviews, ensuring onboarding materials, rollout procedures, and security posture artifacts remain current.

### Remaining Focus After 2025-04-16
- None — ongoing monitoring now follows the scheduled governance cadence, and all upgrade-plan milestones are complete.


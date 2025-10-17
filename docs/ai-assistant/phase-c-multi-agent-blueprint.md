# Phase C Multi-Agent Orchestration Blueprint

This blueprint expands on Phase C of the advanced agent upgrade plan by defining the concrete architecture, interfaces, and telemetry expectations for multi-agent collaboration. It provides actionable detail for the engineering team so implementation can proceed without additional discovery work.

## Objectives
- Model planner, researcher, executor, critic, and voice agents as composable LangGraph/AutoGen nodes.
- Support branching and convergence while maintaining deterministic outcomes and auditable telemetry.
- Ensure voice insights are captured alongside text-based observations with consistent schemas.

## Agent Graph Architecture
### Nodes
| Node | Responsibility | Key Inputs | Outputs |
| --- | --- | --- | --- |
| Planner | Generate execution plans, branch decisions, and safety directives. | Conversation context, episodic memory summaries, tool scores, reflection signals. | Ordered list of steps with node routing hints, branch metadata, safety severity flags. |
| Researcher | Retrieve documentation and historical data to answer context gaps. | Planner research requests, knowledge base connectors, prior agent observations. | Structured findings (citations, snippets, confidence), telemetry events per lookup. |
| Executor | Perform SQL and action workflows, including persisted skills. | Planner execution requests, researcher findings, skill library registry. | Execution results, mutation telemetry, rollback instructions on failure. |
| Critic | Evaluate high-risk responses and flag revisions. | Draft responses, planner risk annotations, tool usage logs. | Critiques, revision requirements, tool penalties, guardrail metrics. |
| Voice | Summarize call transcripts, extract intents, feed insights back into the loop. | Real-time transcription feed, planner voice tasks, historical call summaries. | Voice insights (structured intents, sentiment), transcript references, escalation alerts. |

### Edges & Data Contracts
- **Planner → Researcher**: `planner_service.schemas.ResearchTask` (new) containing search goals, priority, and required citations.
- **Researcher → Planner**: `ResearchFindings` record referencing doc IDs, summary, and confidence. Planner merges into working memory store.
- **Planner → Executor**: Existing `PlannerAction` extended with `branch_id`, `required_observations`, and `safety_level` metadata.
- **Executor → Critic**: Streaming execution log plus final `ExecutionOutcome` to trigger optional critique when `safety_level >= elevated` or executor encountered deviations.
- **Critic → Planner/Orchestrator**: `CriticAssessment` with severity, required revision nodes, and tool score adjustments.
- **Voice ↔ Planner/Researcher**: `VoiceInsight` messages appended to conversation context and available as retrieval sources for researcher queries.

### Branch Management
- Represent branches via `branch_id` GUIDs attached to planner steps and propagated through node inputs.
- Use LangGraph's `ConditionalEdge` to spawn researcher/executor pairs per branch. Convergence nodes perform weighted reconciliation:
  1. Map each branch's confidence, severity flags, and critic penalties.
  2. Select final answer path using highest confidence under guardrail constraints.
  3. Emit telemetry summarizing each branch and the reconciliation decision.

## Telemetry & Observability
- Extend aggregator schema with `agent_graph_runs` capturing node transitions, branch lineage, and latency per edge.
- Emit OpenTelemetry traces per node invocation with shared `conversation_id` and `branch_id` attributes.
- Register Grafana dashboards for:
  - Branch fan-out rate vs. resolution success.
  - Critic intervention frequency by tool and severity.
  - Voice insight utilization (percentage of turns referencing voice data).

## Voice Subagent Integration
1. **Transcription Intake**: Leverage existing voice-call service webhooks to stream transcripts into a new `voice_events` topic.
2. **Insight Extraction**: Deploy a lightweight summarizer agent that batches transcript segments, producing intents and sentiment.
3. **Planner Hooks**: Add planner rule to spawn `VoiceInsight` requests when open voice tasks exist or when sentiment shifts sharply.
4. **Storage**: Persist insights in `ai_voice_insights` table with links to conversations and transcripts for audit.

## Safety & Guardrails
- Critic enforces mandatory revision when executor reports `requires_rollback` or when voice sentiment indicates high frustration.
- Planner must annotate every branch with safety level; branches marked `critical` cannot bypass critic review.
- Add policy checks preventing executor from running destructive workflows without planner-approved guardrail tokens.

## Incremental Rollout Plan
1. **Milestone C1 – Deterministic Graph Skeleton**
   - Implement planner/researcher/executor nodes without branching to validate data contracts.
   - Instrument telemetry hooks and ensure aggregator can replay single-path runs.
2. **Milestone C2 – Branching & Reconciliation**
   - Enable conditional edges and convergence logic with feature flag `agent_graph_branching`.
   - Add integration tests for conflicting research findings resolved via critic votes.
3. **Milestone C3 – Voice Agent Enablement**
   - Integrate voice subagent under separate feature flag `voice_agent_insights`.
   - Backfill existing transcripts into `ai_voice_insights` for historical testing.
4. **Milestone C4 – Safety Hardening**
   - Configure critic thresholds, rollback hooks, and guardrail tokens.
   - Run chaos tests simulating executor failures and ensure automatic remediation.

## Dependencies & Open Risks
- Requires finalized telemetry schema updates (Phase D alignment).
- AutoGen critic needs evaluation tuning to avoid over-triggering revisions.
- Voice pipeline must ensure transcription latency under 2s to keep planner loop responsive.

## Definition of Done
- All nodes configurable via planner-service with documented APIs.
- Branching feature flag validated with synthetic scenarios covering conflicting documentation and SQL outcomes.
- Voice insights appear in orchestration telemetry and can be replayed alongside text observations.

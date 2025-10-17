# Contributor Onboarding – ReAct + Multi-Agent Stack

This guide accelerates onboarding for engineers contributing to the upgraded SOFT SME assistant. It aligns with the LangGraph-inspired ReAct loop, planner schema extensions, and skill library persistence introduced across Phases A–D of the upgrade plan.

## Audience & Prerequisites
- Familiarity with TypeScript/Node.js (planner service, skill APIs) and Python (orchestrator, subagents).
- Access to the `soft-sme-backend`, `planner-service` package, and AI task worker repositories.
- Working knowledge of PostgreSQL and Prisma migrations.

## Architecture Snapshot
1. **ReAct Orchestrator Loop** (`src/agents/aiven_agent.py`)
   - Iteratively reasons, acts, and reflects based on the `ToolScoringPolicy`.
   - Streams intermediate `reason`/`act`/`reflect` events through the aggregation coordinator for UI replay.
2. **Planner Service** (`planner_service/`)
   - Exposes `planner_action` steps with hints for reason/act/reflect stages.
   - Provides plan validation and execution graph templates consumed by the orchestrator.
3. **Skill Library** (`soft-sme-backend/services/AgentSkillLibraryService`)
   - Persists reusable workflows in PostgreSQL via Prisma.
   - Surfaces verified skills to the orchestrator and planner tool catalog.
4. **Multi-Agent Graph Runner** (`src/agents/multi_agent_runner.py`)
   - Fans planner branches across researcher, executor, critic, and voice subagents.
   - Emits telemetry into `agent_graph_runs` for replay and evaluation harnesses.
5. **Telemetry & Guardrails**
   - Aggregation coordinator captures per-turn outcomes, guardrail overrides, and compensation tasks.
   - Evaluation harness aggregates metrics for regression dashboards.

## Development Environment Setup
1. **Install dependencies**
   - Backend: `cd soft-sme-backend && pnpm install`.
   - Planner: `cd planner-service && poetry install` (or pip as defined in repository README).
   - Orchestrator: `pip install -r requirements.txt` from the project root.
2. **Database migrations**
   - Apply Prisma migrations for skill workflows (`prisma/migrations/*`).
   - Apply critic reflection tables (`docs/ai-assistant/advanced-agent-upgrade-plan.md` – Database Changes sections).
   - Confirm telemetry tables exist (`agent_graph_runs`, guardrail compensation queue metadata).
3. **Environment variables**
   - Copy `.env.example` files from backend and orchestrator directories.
   - Configure OpenAI, database, and telemetry credentials.
4. **Local services**
   - Start PostgreSQL (Docker compose recommended).
   - Run planner service (`poetry run planner-api serve`).
   - Launch backend skill API (`pnpm dev` or `pnpm start` depending on service).
   - Start orchestrator worker (`python -m src.orchestrator.worker`).

## Contribution Workflow
1. **Create a feature flag** for new behaviors using the planner configuration service.
2. **Implement changes** alongside unit tests (pytest for Python, Jest for Node.js).
3. **Update telemetry schemas** when introducing new events; ensure aggregator ingestion is backward compatible.
4. **Run regression suites**
   - `pnpm test --filter skill-library` for skill workflows.
   - `pytest src/agents/tests/test_multi_agent_runner.py` for orchestrator changes.
   - `python -m scripts.run_evaluation --scenario branch-regression` for synthetic harness coverage.
5. **Document outcomes** in the appropriate report within `docs/ai-assistant/reports/` and update the upgrade plan progress log.

## Debugging & Observability
- Use the aggregation dashboard to inspect streamed ReAct thoughts and tool outputs.
- Query `skill_run_reflections` and `ai_conversation_reflections` tables to diagnose workflow issues.
- Monitor latency alerts via the analytics pipeline; adjust thresholds in `config/telemetry.yaml` as needed.

## Knowledge Sharing
- Record implementation decisions in `docs/ai-assistant/implementation-roadmap.md`.
- Schedule knowledge transfer sessions covering:
  - Planner schema updates and branching graph usage.
  - Guardrail automation hooks and compensation queues.
  - Security and RBAC considerations (see `security-review-multi-agent-stack.md`).

## Onboarding Checklist
- [ ] Access granted to repositories, databases, and telemetry dashboards.
- [ ] Local environment reproduces ReAct loop end-to-end with sample conversations.
- [ ] Contributor has reviewed planner schema contracts and skill persistence workflows.
- [ ] Contributor completed a supervised change (bug fix or telemetry update) and captured learnings in the reports directory.

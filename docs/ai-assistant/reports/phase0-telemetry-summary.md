# Phase 0 – Instrumentation & Baselines Summary

## Structured telemetry instrumentation
- Added `agent_event_logs` table (migration `20250330000000_create_agent_event_logs.sql`) for centralized analytics across orchestrator and Python agent.
- Node orchestrator now wraps every tool execution with trace IDs, latency metrics, success/failure status, and fallback metadata. Routing misses, missing tool registrations, and LLM fallbacks stream into the analytics sink automatically.
- Introduced `/api/agent/v2/analytics/events` service endpoint so trusted runtimes (e.g., Python `AivenAgent`) can push structured events via service tokens/API keys.
- Python tooling publishes failures through a shared `AnalyticsSink`, covering action tool HTTP issues, RAG/SQL runtime errors, and session initialization problems.

## Failure signature audit (last 30 days)
- Script: `npx ts-node scripts/audit-agent-failures.ts`
- Output: `docs/ai-assistant/reports/phase0-failure-audit.md`
- Highlights:
  - Documentation fallback accounts for the majority of routing misses in the sample dataset.
  - Missing `updateQuote` tool surfaced as the top orchestrator configuration gap.
  - Python agent failures split evenly between orchestrator HTTP errors, RAG index gaps, and missing SQL tables.

## Conversation dataset export
- Script: `npx ts-node scripts/export-conversations.ts`
- Generates anonymized JSONL exports (salted hash for company/user IDs, truncated payloads) in `soft-sme-backend/analytics_exports/`.
- Falls back to `docs/ai-assistant/data/sample_conversations.json` when Postgres is unavailable so downstream tooling can be validated offline.
- Intended for seeding planner prompt tuning and regression suites once warehouse connectivity is available.

## Next focus recommendation
With Phase 0 complete, proceed to **Phase 1 – Planner Skeleton**, starting with scaffolding the `planner-service` FastAPI proxy and formalizing the JSON schema contract so orchestration telemetry can drive plan quality metrics.

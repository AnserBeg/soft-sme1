# AI Agent Database Migration Audit

This document inventories every PostgreSQL migration the AI assistant stack depends on and
explains how to verify or (re)apply them in environments where tables, columns, or indexes
are missing. All listed scripts are idempotent unless otherwise noted, so it is safe to rerun
them when in doubt.

## Quick reference

| Priority | Migration file | What it provides | Verification query | Action |
| --- | --- | --- | --- | --- |
| P0 | `migrations/20250315_create_ai_assistant_tables.sql` | Core `ai_conversations`, `ai_messages`, `ai_task_queue` tables, timestamp trigger | `SELECT table_name FROM information_schema.tables WHERE table_name IN ('ai_conversations','ai_messages','ai_task_queue');` | Run immediately if any table is missing; rerun to backfill triggers/indexes. |
| P0 | `migrations/20250328_add_conversation_summary.sql` | Conversation summary columns + index on `summary_updated_at` | `SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_conversations' AND column_name = 'summary';` | Apply after the base tables so episodic memory fields exist. |
| P0 | `migrations/20250330_add_ai_conversation_reflections.sql` | `ai_conversation_reflections` table + descending index | `SELECT table_name FROM information_schema.tables WHERE table_name = 'ai_conversation_reflections';` | Run to unblock critic logging and the Python conversation manager. |
| P1 | `migrations/20250321_create_skill_workflow_tables.sql` | `skill_workflows` + `skill_run_reflections` tables for planner workflows | `SELECT table_name FROM information_schema.tables WHERE table_name IN ('skill_workflows','skill_run_reflections');` | Execute before enabling workflow-driven planner steps. |
| P1 | `migrations/20250330000000_create_agent_event_logs.sql` | `agent_event_logs` analytics sink and supporting indexes | `SELECT table_name FROM information_schema.tables WHERE table_name = 'agent_event_logs';` | Apply so orchestrator/worker telemetry persists. |
| P0 | **New:** `migrations/20250331_create_ai_guardrails_schema.sql` (proposed below) | Creates `ai_guardrails.policy_rules` schema/table used by the safety subagent | `SELECT * FROM information_schema.tables WHERE table_schema = 'ai_guardrails' AND table_name = 'policy_rules';` | Add new migration and seed baseline rules (`docs/ai-assistant/data/policy_rules_seed.sql`). |

> **Status legend**
> - **P0** – required before the AI agent can start without runtime errors.
> - **P1** – required to unlock auxiliary features (planner workflows, analytics) but the
>   agent can answer basic questions without them.

## Detailed notes

### 1. Base conversation persistence (20250315)

The Python `ConversationManager` and the Node.js `ConversationManager` service both assume
that `ai_conversations`, `ai_messages`, and `ai_task_queue` exist with JSONB metadata columns,
`last_message_at` timestamps, and `update_timestamp` triggers to keep `updated_at` current.【F:soft-sme-backend/ai_agent/conversation_manager.py†L24-L188】【F:soft-sme-backend/src/services/aiConversationManager.ts†L1-L256】

The migration `20250315_create_ai_assistant_tables.sql` provisions those tables, supporting
indexes, and the shared trigger function.【F:soft-sme-backend/migrations/20250315_create_ai_assistant_tables.sql†L1-L68】 If any of these
objects are missing (for example, the queue table or its `idx_ai_task_queue_status_schedule`
index), rerun the migration via `psql -f` to recreate them. The script is idempotent and will
not clobber existing data.

**Verification steps**
1. Confirm each table exists: `\d+ ai_conversations`, `\d+ ai_messages`, `\d+ ai_task_queue`.
2. Check indexes: `\di ai_conversations` should list `idx_ai_conversations_user`,
   `idx_ai_conversations_last_message`; `\di ai_task_queue` should include
   `idx_ai_task_queue_status_schedule`.
3. Validate triggers with `SELECT tgname FROM pg_trigger WHERE tgrelid = 'ai_conversations'::regclass;` – ensure `trg_ai_conversations_updated_at` is present.

### 2. Conversation summaries (20250328)

Frontend and backend code store rolling conversation summaries in the `summary`,
`summary_metadata`, and `summary_updated_at` columns and rely on the
`idx_ai_conversations_summary_updated` index for recency queries.【F:soft-sme-backend/src/services/aiConversationManager.ts†L166-L228】 These
columns are added by `20250328_add_conversation_summary.sql`. If the columns are absent,
updating a summary will throw `column "summary" does not exist` errors.

**Action:** rerun the migration and verify with `\d+ ai_conversations` that the three columns
and the index exist.【F:soft-sme-backend/migrations/20250328_add_conversation_summary.sql†L1-L8】

### 3. Conversation reflections (20250330)

The critic agent records reflections via `ai_conversation_reflections`; without this table the
Python side raises `relation "ai_conversation_reflections" does not exist` whenever a risk
assessment is stored.【F:soft-sme-backend/ai_agent/conversation_manager.py†L158-L205】 Apply the migration
`20250330_add_ai_conversation_reflections.sql` to create the table and its descending
index.【F:soft-sme-backend/migrations/20250330_add_ai_conversation_reflections.sql†L1-L14】 Verify by running
`\d+ ai_conversation_reflections` and ensuring `idx_ai_conversation_reflections_conversation` exists.

### 4. Skill workflow registry (20250321)

Planner workflows fetched by `AgentSkillLibraryService` depend on `skill_workflows` and
`skill_run_reflections` with JSONB parameter storage and `gen_random_uuid()` defaults.【F:soft-sme-backend/src/services/agentV2/skillLibrary.ts†L1-L137】 The migration
`20250321_create_skill_workflow_tables.sql` creates both tables and necessary indexes.【F:soft-sme-backend/migrations/20250321_create_skill_workflow_tables.sql†L1-L22】
Without it, any attempt to list or upsert workflows fails.

**Verification:** `\d+ skill_workflows` should show `(name, version)` unique constraint and the
`idx_skill_workflows_name` index; `\d+ skill_run_reflections` should include the composite index
on `(skill_workflow_id, created_at)`.

### 5. Agent analytics sink (20250330000000)

Orchestrator telemetry (`AgentAnalyticsLogger`) writes to `agent_event_logs`; missing tables or
indexes cause worker logging failures and lose incident breadcrumbs.【F:soft-sme-backend/src/services/agentV2/analyticsLogger.ts†L150-L226】 Execute
`20250330000000_create_agent_event_logs.sql` to create the table and high-cardinality indexes.
This script is also idempotent.【F:soft-sme-backend/migrations/20250330000000_create_agent_event_logs.sql†L1-L19】

**Verification:** `\d+ agent_event_logs` and `\di agent_event_logs` should list the
`occurred_at`, `(event_type, status)`, `source`, and filtered `tool` indexes.

### 6. Guardrail policy schema (new migration required)

The safety subagent and planner policy repository query `ai_guardrails.policy_rules`, but no
migration currently creates the `ai_guardrails` schema or table. The repo only ships a seed file
for manual execution.【F:docs/ai-assistant/subagents/safety-policy-subagent.md†L9-L47】【F:docs/ai-assistant/data/policy_rules_seed.sql†L1-L44】【F:soft-sme-backend/planner_service/policy_engine.py†L183-L238】 To stabilize deployments, add a new migration
(e.g. `20250331_create_ai_guardrails_schema.sql`) with the following structure:

```sql
CREATE SCHEMA IF NOT EXISTS ai_guardrails;

CREATE TABLE IF NOT EXISTS ai_guardrails.policy_rules (
  name TEXT PRIMARY KEY,
  severity VARCHAR(16) NOT NULL,
  policy_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  message TEXT NOT NULL,
  resolution TEXT,
  requires_manual_review BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_step TEXT,
  match_all_keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  match_any_keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  match_pending_action_slugs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  priority INTEGER NOT NULL DEFAULT 0,
  company_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policy_rules_priority
  ON ai_guardrails.policy_rules (priority DESC, name);
```

After introducing the migration, run the seed script in `docs/ai-assistant/data/policy_rules_seed.sql`
to populate the baseline privacy/finance guardrails.

## Rollout checklist

1. Apply the migrations in the order listed (base tables first, then summaries, reflections,
   supporting schemas).
2. Seed guardrail rules if they were never imported.
3. Restart the Node backend and Python agent to pick up schema changes.
4. Run `SELECT COUNT(*) FROM ai_conversations;` and `SELECT COUNT(*) FROM ai_messages;` to
   confirm existing data remains intact.
5. Monitor the logs for `ai_task_queue` dequeue activity and guardrail policy cache refreshes to
   ensure all services can reach their tables.

Following this checklist will restore the database prerequisites the AI assistant expects and
prevent runtime `relation does not exist` or missing column/index errors during agent startup.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS skill_workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    description TEXT,
    entrypoint TEXT NOT NULL,
    parameters JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skill_workflows_name ON skill_workflows (name);
CREATE INDEX IF NOT EXISTS idx_skill_run_reflections_workflow ON skill_run_reflections (skill_workflow_id, created_at DESC);

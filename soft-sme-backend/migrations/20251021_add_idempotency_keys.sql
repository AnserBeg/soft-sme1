CREATE TABLE IF NOT EXISTS idempotency_keys (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NULL,
  tool_name TEXT NOT NULL,
  target_id TEXT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress','succeeded','failed_permanent')),
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_idem_unique ON idempotency_keys(tool_name,idempotency_key);
CREATE INDEX IF NOT EXISTS idx_idem_status ON idempotency_keys(status);

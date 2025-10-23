CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope TEXT NOT NULL,
  "key" TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, "key")
);

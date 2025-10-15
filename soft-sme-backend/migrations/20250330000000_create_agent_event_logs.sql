-- Agent analytics event log to capture orchestrator traces and Python agent failures
CREATE TABLE IF NOT EXISTS agent_event_logs (
  id BIGSERIAL PRIMARY KEY,
  source VARCHAR(32) NOT NULL,
  session_id INTEGER,
  conversation_id UUID,
  tool VARCHAR(100),
  event_type VARCHAR(50) NOT NULL,
  status VARCHAR(20),
  error_code VARCHAR(100),
  error_message TEXT,
  trace_id UUID,
  latency_ms INTEGER,
  metadata JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_event_logs_occurred_at
  ON agent_event_logs (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_event_logs_event_status
  ON agent_event_logs (event_type, status);

CREATE INDEX IF NOT EXISTS idx_agent_event_logs_source
  ON agent_event_logs (source);

CREATE INDEX IF NOT EXISTS idx_agent_event_logs_tool
  ON agent_event_logs (tool)
  WHERE tool IS NOT NULL;

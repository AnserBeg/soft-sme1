ALTER TABLE vendor_call_sessions
  ADD COLUMN IF NOT EXISTS agent_session_id INTEGER REFERENCES agent_sessions(id);

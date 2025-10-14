-- Enhance tasks for AI agent coordination
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS created_by_agent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS agent_session_id INTEGER REFERENCES agent_sessions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS agent_task_subscriptions (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  subscribed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_notified_status VARCHAR(50),
  last_notified_at TIMESTAMPTZ,
  last_notified_message_id INTEGER REFERENCES agent_messages(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (session_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_task_subscriptions_task ON agent_task_subscriptions(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_task_subscriptions_session ON agent_task_subscriptions(session_id);

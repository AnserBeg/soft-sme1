-- AI Assistant persistence tables
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user
  ON ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_last_message
  ON ai_conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role VARCHAR(32) NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON ai_messages(conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS ai_task_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NULL REFERENCES ai_conversations(id) ON DELETE SET NULL,
  task_type VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_task_queue_status_schedule
  ON ai_task_queue(status, scheduled_for);

CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ai_conversations_updated_at'
  ) THEN
    CREATE TRIGGER trg_ai_conversations_updated_at
      BEFORE UPDATE ON ai_conversations
      FOR EACH ROW
      EXECUTE PROCEDURE update_timestamp();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ai_task_queue_updated_at'
  ) THEN
    CREATE TRIGGER trg_ai_task_queue_updated_at
      BEFORE UPDATE ON ai_task_queue
      FOR EACH ROW
      EXECUTE PROCEDURE update_timestamp();
  END IF;
END $$;

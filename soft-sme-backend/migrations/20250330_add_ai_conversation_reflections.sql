-- Critic reflection persistence for AI conversations
CREATE TABLE IF NOT EXISTS ai_conversation_reflections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  trigger VARCHAR(64) NOT NULL,
  risk_level VARCHAR(32) NOT NULL DEFAULT 'normal',
  summary TEXT NOT NULL,
  recommendation TEXT,
  requires_revision BOOLEAN NOT NULL DEFAULT FALSE,
  impacted_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversation_reflections_conversation
  ON ai_conversation_reflections(conversation_id, created_at DESC);

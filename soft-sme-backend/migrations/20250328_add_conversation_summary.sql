-- Add summary fields to AI conversations for episodic memory support
ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS summary_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS summary_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ai_conversations_summary_updated
  ON ai_conversations(summary_updated_at DESC NULLS LAST);

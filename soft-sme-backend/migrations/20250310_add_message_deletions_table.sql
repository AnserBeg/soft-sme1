-- Adds per-user message deletion tracking for messaging feature
CREATE TABLE IF NOT EXISTS message_deletions (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'message_deletions_unique'
  ) THEN
    ALTER TABLE message_deletions
      ADD CONSTRAINT message_deletions_unique UNIQUE (message_id, user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_message_deletions_user ON message_deletions(user_id);
CREATE INDEX IF NOT EXISTS idx_message_deletions_message ON message_deletions(message_id);

-- Ensure per-user message deletion tracking exists for the messaging module
-- This table allows conversations to hide specific messages for a user
-- without removing the original record for other participants.

CREATE TABLE IF NOT EXISTS message_deletions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_deletions_user ON message_deletions(user_id);
CREATE INDEX IF NOT EXISTS idx_message_deletions_deleted_at ON message_deletions(deleted_at);

-- Ensure messages.sender_id exists for messaging feature compatibility
-- Some environments may have an older messages table without this column.

ALTER TABLE IF EXISTS messages
  ADD COLUMN IF NOT EXISTS sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Helpful index for filtering by sender
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);


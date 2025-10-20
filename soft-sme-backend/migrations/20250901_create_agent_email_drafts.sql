-- Store encrypted drafts for agent-managed outbound emails (confirmation flow)
CREATE TABLE IF NOT EXISTS agent_email_drafts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  draft_encrypted TEXT NOT NULL,
  draft_nonce TEXT NOT NULL,
  confirm_token TEXT NOT NULL,
  confirm_token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_email_drafts_user ON agent_email_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_email_drafts_provider ON agent_email_drafts(provider);
CREATE INDEX IF NOT EXISTS idx_agent_email_drafts_confirm_token ON agent_email_drafts(confirm_token);

CREATE OR REPLACE FUNCTION update_agent_email_drafts_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_agent_email_drafts_updated_at ON agent_email_drafts;

CREATE TRIGGER update_agent_email_drafts_updated_at
BEFORE UPDATE ON agent_email_drafts
FOR EACH ROW
EXECUTE FUNCTION update_agent_email_drafts_updated_at_column();

-- Create table to store encrypted agent email connections (Titan, etc.)
CREATE TABLE IF NOT EXISTS agent_email_connections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  config_encrypted TEXT NOT NULL,
  config_nonce TEXT NOT NULL,
  config_version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_validated_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_agent_email_connections_user ON agent_email_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_email_connections_provider ON agent_email_connections(provider);
CREATE INDEX IF NOT EXISTS idx_agent_email_connections_active ON agent_email_connections(is_active);

CREATE OR REPLACE FUNCTION update_agent_email_connections_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_agent_email_connections_updated_at ON agent_email_connections;

CREATE TRIGGER update_agent_email_connections_updated_at
BEFORE UPDATE ON agent_email_connections
FOR EACH ROW
EXECUTE FUNCTION update_agent_email_connections_updated_at_column();

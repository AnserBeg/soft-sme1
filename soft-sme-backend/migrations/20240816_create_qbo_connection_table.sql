-- Create table for storing QBO OAuth tokens per company
CREATE TABLE IF NOT EXISTS qbo_connection (
  company_id INTEGER PRIMARY KEY,
  realm_id VARCHAR(32) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
); 
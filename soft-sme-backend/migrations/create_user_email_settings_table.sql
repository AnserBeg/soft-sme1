-- Create user_email_settings table for per-user email configuration
CREATE TABLE IF NOT EXISTS user_email_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_provider VARCHAR(50) NOT NULL DEFAULT 'gmail',
  email_host VARCHAR(255) NOT NULL,
  email_port INTEGER NOT NULL DEFAULT 587,
  email_secure BOOLEAN NOT NULL DEFAULT false,
  email_user VARCHAR(255) NOT NULL,
  email_pass VARCHAR(255) NOT NULL, -- This should be encrypted in production
  email_from VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id) -- Each user can only have one active email configuration
);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_user_email_settings_user_id ON user_email_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_email_settings_active ON user_email_settings(is_active);

-- Create trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_email_settings_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_user_email_settings_updated_at ON user_email_settings;

CREATE TRIGGER update_user_email_settings_updated_at
BEFORE UPDATE ON user_email_settings
FOR EACH ROW
EXECUTE FUNCTION update_user_email_settings_updated_at_column();
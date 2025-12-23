-- Track EULA and Privacy Policy acceptance per user
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS eula_accepted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMP WITH TIME ZONE;

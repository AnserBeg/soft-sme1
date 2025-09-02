-- Update session timeout settings to much longer durations
-- Session timeout: 24 hours -> 30 days (720 hours)
-- Refresh token: 30 days -> 90 days

UPDATE companies 
SET 
  session_timeout_hours = 720,
  refresh_token_days = 90
WHERE session_timeout_hours = 24 OR refresh_token_days = 30;

-- Update the default values for new companies
ALTER TABLE companies 
ALTER COLUMN session_timeout_hours SET DEFAULT 720,
ALTER COLUMN refresh_token_days SET DEFAULT 90;



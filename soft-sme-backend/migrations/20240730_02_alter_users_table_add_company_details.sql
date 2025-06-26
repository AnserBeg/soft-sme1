-- Add company_id, role, and force_password_change columns to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'employee',
ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN NOT NULL DEFAULT TRUE;

-- Add an index on company_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id); 
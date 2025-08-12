-- Create user profile access control table
-- This allows admins to control which profiles mobile users can access

CREATE TABLE IF NOT EXISTS user_profile_access (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  granted_by INTEGER REFERENCES users(id),
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, profile_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_profile_access_user_id ON user_profile_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profile_access_profile_id ON user_profile_access(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_profile_access_active ON user_profile_access(is_active);

-- Add a comment to explain the table purpose
COMMENT ON TABLE user_profile_access IS 'Controls which profiles mobile users can access for time tracking';
COMMENT ON COLUMN user_profile_access.user_id IS 'The user who has access to the profile';
COMMENT ON COLUMN user_profile_access.profile_id IS 'The profile the user has access to';
COMMENT ON COLUMN user_profile_access.granted_by IS 'The admin user who granted this access';
COMMENT ON COLUMN user_profile_access.is_active IS 'Whether this access is currently active'; 
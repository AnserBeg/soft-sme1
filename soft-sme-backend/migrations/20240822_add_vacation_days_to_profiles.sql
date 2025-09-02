-- Add vacation_days_available column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS vacation_days_available DECIMAL(5,2) DEFAULT 20.0;

-- Update existing profiles to have default vacation days if they don't have any
UPDATE profiles SET vacation_days_available = 20.0 WHERE vacation_days_available IS NULL;


-- Add phone_number to profiles for time tracking/attendance
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS phone_number VARCHAR(50);

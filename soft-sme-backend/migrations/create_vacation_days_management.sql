-- Create vacation_days_management table
CREATE TABLE IF NOT EXISTS vacation_days_management (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  total_vacation_days INTEGER NOT NULL DEFAULT 20,
  days_used INTEGER NOT NULL DEFAULT 0,
  days_remaining INTEGER GENERATED ALWAYS AS (total_vacation_days - days_used) STORED,
  reset_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(profile_id)
);

-- Create global vacation reset settings table
CREATE TABLE IF NOT EXISTS vacation_reset_settings (
  id SERIAL PRIMARY KEY,
  reset_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_vacation_days_management_profile_id ON vacation_days_management(profile_id);
CREATE INDEX IF NOT EXISTS idx_vacation_days_management_reset_date ON vacation_days_management(reset_date);
CREATE INDEX IF NOT EXISTS idx_vacation_reset_settings_active ON vacation_reset_settings(is_active);

-- Insert default reset date (January 1st of next year)
INSERT INTO vacation_reset_settings (reset_date) 
VALUES (DATE_TRUNC('year', CURRENT_DATE + INTERVAL '1 year')::date)
ON CONFLICT DO NOTHING;

-- Create or replace function to update vacation days when leave is approved
CREATE OR REPLACE FUNCTION update_vacation_days_on_approval()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update if this is a vacation request that was just approved
  IF NEW.status = 'approved' AND OLD.status != 'approved' AND NEW.request_type = 'vacation' THEN
    -- Update the vacation days management for this profile
    INSERT INTO vacation_days_management (profile_id, total_vacation_days, days_used, reset_date)
    VALUES (NEW.profile_id, 20, NEW.total_days, (SELECT reset_date FROM vacation_reset_settings WHERE is_active = true LIMIT 1))
    ON CONFLICT (profile_id) 
         DO UPDATE SET 
       days_used = vacation_days_management.days_used + CAST(NEW.total_days AS INTEGER),
      updated_at = CURRENT_TIMESTAMP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update vacation days when leave is approved
DROP TRIGGER IF EXISTS trigger_update_vacation_days ON leave_requests;
CREATE TRIGGER trigger_update_vacation_days
  AFTER UPDATE ON leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_vacation_days_on_approval();

-- Create function to reset vacation days for all employees
CREATE OR REPLACE FUNCTION reset_vacation_days_for_all()
RETURNS void AS $$
DECLARE
  current_reset_date DATE;
  current_year INTEGER;
  new_reset_date DATE;
BEGIN
  -- Get the current reset date
  SELECT reset_date INTO current_reset_date 
  FROM vacation_reset_settings 
  WHERE is_active = true 
  LIMIT 1;
  
  -- Get the current year
  SELECT EXTRACT(YEAR FROM CURRENT_DATE) INTO current_year;
  
  -- Calculate the next reset date using the same month and day as the current reset date
  -- but for the next year
  new_reset_date := DATE(current_year + 1, EXTRACT(MONTH FROM current_reset_date)::INTEGER, EXTRACT(DAY FROM current_reset_date)::INTEGER);
  
  -- Update all vacation days management records
  UPDATE vacation_days_management 
  SET 
    days_used = 0,
    reset_date = new_reset_date,
    updated_at = CURRENT_TIMESTAMP;
  
  -- Update the global reset date
  UPDATE vacation_reset_settings 
  SET 
    reset_date = new_reset_date,
    updated_at = CURRENT_TIMESTAMP
  WHERE is_active = true;
  
  -- Reset vacation_days_available in profiles table for backward compatibility
  UPDATE profiles 
  SET vacation_days_available = 20;
END;
$$ LANGUAGE plpgsql;

-- Create attendance_shifts table for shift tracking
CREATE TABLE IF NOT EXISTS attendance_shifts (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id),
  clock_in TIMESTAMP WITH TIME ZONE NOT NULL,
  clock_out TIMESTAMP WITH TIME ZONE,
  created_by INTEGER,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_attendance_shifts_profile_id ON attendance_shifts(profile_id);
CREATE INDEX IF NOT EXISTS idx_attendance_shifts_clock_in ON attendance_shifts(clock_in);
CREATE INDEX IF NOT EXISTS idx_attendance_shifts_clock_out ON attendance_shifts(clock_out); 
-- Add wanted by fields to salesorderhistory if they don't already exist
ALTER TABLE salesorderhistory
  ADD COLUMN IF NOT EXISTS wanted_by_date DATE,
  ADD COLUMN IF NOT EXISTS wanted_by_time_of_day TEXT;


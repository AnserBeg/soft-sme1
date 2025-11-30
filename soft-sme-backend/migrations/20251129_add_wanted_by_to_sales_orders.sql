-- Add optional "wanted by" date and time-of-day fields to sales orders
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'salesorderhistory' AND column_name = 'wanted_by_date'
  ) THEN
    ALTER TABLE salesorderhistory ADD COLUMN wanted_by_date DATE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'salesorderhistory' AND column_name = 'wanted_by_time_of_day'
  ) THEN
    ALTER TABLE salesorderhistory ADD COLUMN wanted_by_time_of_day TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_schema = 'public' AND table_name = 'salesorderhistory' AND constraint_name = 'salesorderhistory_wanted_by_time_check'
  ) THEN
    ALTER TABLE salesorderhistory
      ADD CONSTRAINT salesorderhistory_wanted_by_time_check
      CHECK (wanted_by_time_of_day IS NULL OR wanted_by_time_of_day IN ('morning', 'afternoon', 'evening'));
  END IF;
END $$;

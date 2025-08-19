-- Migration: Add postal_code to customermaster
-- Add postal_code column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customermaster'
      AND column_name = 'postal_code'
  ) THEN
    ALTER TABLE customermaster ADD COLUMN postal_code VARCHAR(20);
  END IF;
END $$;
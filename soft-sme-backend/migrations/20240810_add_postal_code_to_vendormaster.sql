-- Migration: Add postal_code to vendormaster
-- Add postal_code column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vendormaster'
      AND column_name = 'postal_code'
  ) THEN
    ALTER TABLE vendormaster ADD COLUMN postal_code VARCHAR(20);
  END IF;
END $$; 
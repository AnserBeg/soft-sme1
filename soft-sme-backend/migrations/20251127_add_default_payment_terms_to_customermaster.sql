-- Add default payment terms to customers for invoice due date calculation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customermaster'
      AND column_name = 'default_payment_terms_in_days'
  ) THEN
    ALTER TABLE customermaster
      ADD COLUMN default_payment_terms_in_days INTEGER NOT NULL DEFAULT 30;
  ELSE
    -- Ensure sensible defaults for existing rows/definition
    ALTER TABLE customermaster
      ALTER COLUMN default_payment_terms_in_days SET DEFAULT 30;
    UPDATE customermaster
      SET default_payment_terms_in_days = 30
      WHERE default_payment_terms_in_days IS NULL;
    ALTER TABLE customermaster
      ALTER COLUMN default_payment_terms_in_days SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customermaster_default_terms
  ON customermaster(default_payment_terms_in_days);

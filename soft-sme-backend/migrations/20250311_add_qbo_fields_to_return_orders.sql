-- Add QuickBooks export tracking fields to return orders
-- Safe to run multiple times

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'return_orders'
  ) THEN
    ALTER TABLE return_orders
      ADD COLUMN IF NOT EXISTS exported_to_qbo BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS qbo_exported_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS qbo_export_status TEXT,
      ADD COLUMN IF NOT EXISTS qbo_vendor_credit_id VARCHAR(255);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_return_orders_exported_to_qbo
  ON return_orders (exported_to_qbo);

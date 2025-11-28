-- Add editable invoice header fields independent of sales orders
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'product_name'
  ) THEN
    ALTER TABLE invoices
      ADD COLUMN product_name TEXT,
      ADD COLUMN product_description TEXT,
      ADD COLUMN vin_number TEXT,
      ADD COLUMN unit_number TEXT,
      ADD COLUMN vehicle_make TEXT,
      ADD COLUMN vehicle_model TEXT;
  END IF;
END $$;

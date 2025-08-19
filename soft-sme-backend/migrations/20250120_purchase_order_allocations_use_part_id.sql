-- Add part_id to purchase_order_allocations and backfill from inventory
-- Idempotent and safe to run multiple times

DO $$
BEGIN
  -- Add part_id column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='purchase_order_allocations' AND column_name='part_id'
  ) THEN
    ALTER TABLE purchase_order_allocations ADD COLUMN part_id INTEGER;
  END IF;

  -- Backfill part_id using normalized part_number if any rows are NULL
  UPDATE purchase_order_allocations poa
  SET part_id = i.part_id
  FROM inventory i
  WHERE poa.part_id IS NULL
    AND poa.part_number IS NOT NULL
    AND REPLACE(REPLACE(UPPER(poa.part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER(i.part_number), '-', ''), ' ', '');

  -- Add FK if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_schema = 'public' AND tc.table_name = 'purchase_order_allocations'
      AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'part_id'
  ) THEN
    ALTER TABLE purchase_order_allocations
      ADD CONSTRAINT fk_purchase_order_allocations_part_id
      FOREIGN KEY (part_id) REFERENCES inventory(part_id) ON DELETE SET NULL;
  END IF;

  -- Helpful index for lookups by part_id
  CREATE INDEX IF NOT EXISTS idx_purchase_order_allocations_part_id ON purchase_order_allocations(part_id);
END $$;



-- Add part_id to purchaselineitems and backfill from inventory
-- Idempotent; safe to run multiple times

DO $$
BEGIN
  -- Add column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='purchaselineitems' AND column_name='part_id'
  ) THEN
    ALTER TABLE purchaselineitems ADD COLUMN part_id INTEGER;
  END IF;

  -- Backfill from inventory using normalized part_number
  UPDATE purchaselineitems pli
  SET part_id = i.part_id
  FROM inventory i
  WHERE pli.part_id IS NULL
    AND pli.part_number IS NOT NULL
    AND REPLACE(REPLACE(UPPER(pli.part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER(i.part_number), '-', ''), ' ', '');

  -- Add FK if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_schema='public' AND tc.table_name='purchaselineitems'
      AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='part_id'
  ) THEN
    ALTER TABLE purchaselineitems
      ADD CONSTRAINT fk_purchaselineitems_part_id
      FOREIGN KEY (part_id) REFERENCES inventory(part_id) ON DELETE SET NULL;
  END IF;

  -- Index for joins
  CREATE INDEX IF NOT EXISTS idx_purchaselineitems_part_id ON purchaselineitems(part_id);
END $$;



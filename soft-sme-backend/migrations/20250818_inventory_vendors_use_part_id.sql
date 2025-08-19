-- Migrate inventory_vendors to use part_id as the canonical FK instead of part_number

-- 1) Ensure part_id column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inventory_vendors' AND column_name='part_id'
  ) THEN
    ALTER TABLE inventory_vendors ADD COLUMN part_id INTEGER;
  END IF;
END $$;

-- 2) Backfill part_id from inventory by exact part_number match
UPDATE inventory_vendors iv
SET part_id = i.part_id
FROM inventory i
WHERE iv.part_id IS NULL AND iv.part_number = i.part_number;

-- 3) Drop FK on part_number if present
DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
  WHERE tc.table_schema='public' AND tc.table_name='inventory_vendors'
    AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='part_number'
  LIMIT 1;
  IF fk_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE inventory_vendors DROP CONSTRAINT ' || quote_ident(fk_name);
  END IF;
END $$;

-- 4) Add FK on part_id if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_schema='public' AND tc.table_name='inventory_vendors'
      AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='part_id'
  ) THEN
    ALTER TABLE inventory_vendors
      ADD CONSTRAINT fk_inventory_vendors_part_id
      FOREIGN KEY (part_id) REFERENCES inventory(part_id) ON DELETE CASCADE;
  END IF;
END $$;

-- 5) Replace unique index to use part_id instead of part_number
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ux_inventory_vendors_map'
  ) THEN
    DROP INDEX ux_inventory_vendors_map;
  END IF;
  CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_vendors_map
    ON inventory_vendors (part_id, vendor_id, vendor_part_number);
END $$;

-- 6) Add supporting index on part_id
CREATE INDEX IF NOT EXISTS idx_inventory_vendors_part_id ON inventory_vendors(part_id);

-- 7) Enforce NOT NULL for part_id after backfill
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inventory_vendors' AND column_name='part_id' AND is_nullable='YES'
  ) THEN
    ALTER TABLE inventory_vendors ALTER COLUMN part_id SET NOT NULL;
  END IF;
END $$;



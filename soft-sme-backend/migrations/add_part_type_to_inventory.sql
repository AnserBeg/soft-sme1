-- Migration to add part_type to the existing inventory table.
-- This script is idempotent and can be run safely multiple times.
-- It only adds the part_type column and its related constraints/indexes if they don't already exist.

-- 1. Add the part_type column if it doesn't exist.
-- It defaults to 'stock' for all existing rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'inventory' AND column_name = 'part_type'
  ) THEN
    ALTER TABLE inventory ADD COLUMN part_type VARCHAR(10) NOT NULL DEFAULT 'stock';
  END IF;
END $$;

-- 2. Add a check constraint to ensure part_type is either 'stock' or 'supply' if it doesn't exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'check_part_type' AND table_name = 'inventory'
  ) THEN
    ALTER TABLE inventory ADD CONSTRAINT check_part_type CHECK (part_type IN ('stock', 'supply'));
  END IF;
END $$;

-- 3. Create an index on the new column for better query performance if it doesn't exist.
CREATE INDEX IF NOT EXISTS idx_inventory_part_type ON inventory(part_type);

-- Note: The `DEFAULT 'stock'` in the ADD COLUMN statement handles setting the value for existing rows.
-- An explicit UPDATE is not necessary if the column is being added for the first time.

-- 4. Verify the changes (optional)
-- You can run this SELECT statement in pgAdmin to see the final structure.
-- SELECT column_name, data_type, is_nullable, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'inventory'; 
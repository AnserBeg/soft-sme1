-- Migration to move line item tables from part_number to part_id foreign keys
-- This will solve the part number change issue permanently

-- Step 1: Add part_id columns to line item tables
DO $$
BEGIN
  -- Add part_id to salesorderlineitems if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='salesorderlineitems' AND column_name='part_id'
  ) THEN
    ALTER TABLE salesorderlineitems ADD COLUMN part_id INTEGER;
  END IF;

  -- Add part_id to purchaselineitems if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='purchaselineitems' AND column_name='part_id'
  ) THEN
    ALTER TABLE purchaselineitems ADD COLUMN part_id INTEGER;
  END IF;

  -- Add part_id to purchase_order_allocations if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='purchase_order_allocations' AND column_name='part_id'
  ) THEN
    ALTER TABLE purchase_order_allocations ADD COLUMN part_id INTEGER;
  END IF;
END $$;

-- Step 2: Populate part_id values from inventory table
-- Only update records that have valid part_number references
UPDATE salesorderlineitems 
SET part_id = i.part_id
FROM inventory i
WHERE salesorderlineitems.part_number = i.part_number
AND salesorderlineitems.part_number IS NOT NULL
AND salesorderlineitems.part_number != '';

UPDATE purchaselineitems 
SET part_id = i.part_id
FROM inventory i
WHERE purchaselineitems.part_number = i.part_number
AND purchaselineitems.part_number IS NOT NULL
AND purchaselineitems.part_number != '';

UPDATE purchase_order_allocations 
SET part_id = i.part_id
FROM inventory i
WHERE purchase_order_allocations.part_number = i.part_number
AND purchase_order_allocations.part_number IS NOT NULL
AND purchase_order_allocations.part_number != '';

-- Step 3: Drop existing foreign key constraints on part_number (if they exist)
DO $$
DECLARE
  fk_name text;
BEGIN
  -- Drop FK on salesorderlineitems.part_number if it exists
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
  WHERE tc.table_schema='public' AND tc.table_name='salesorderlineitems'
    AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='part_number'
  LIMIT 1;
  IF fk_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE salesorderlineitems DROP CONSTRAINT ' || quote_ident(fk_name);
  END IF;

  -- Drop FK on purchaselineitems.part_number if it exists
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
  WHERE tc.table_schema='public' AND tc.table_name='purchaselineitems'
    AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='part_number'
  LIMIT 1;
  IF fk_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE purchaselineitems DROP CONSTRAINT ' || quote_ident(fk_name);
  END IF;

  -- Drop FK on purchase_order_allocations.part_number if it exists
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
  WHERE tc.table_schema='public' AND tc.table_name='purchase_order_allocations'
    AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='part_number'
  LIMIT 1;
  IF fk_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE purchase_order_allocations DROP CONSTRAINT ' || quote_ident(fk_name);
  END IF;
END $$;

-- Step 4: Add foreign key constraints on part_id
DO $$
BEGIN
  -- Add FK on salesorderlineitems.part_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_schema='public' AND tc.table_name='salesorderlineitems'
      AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='part_id'
  ) THEN
    ALTER TABLE salesorderlineitems
      ADD CONSTRAINT fk_salesorderlineitems_part_id
      FOREIGN KEY (part_id) REFERENCES inventory(part_id) ON DELETE SET NULL;
  END IF;

  -- Add FK on purchaselineitems.part_id if it doesn't exist
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

  -- Add FK on purchase_order_allocations.part_id if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_schema='public' AND tc.table_name='purchase_order_allocations'
      AND tc.constraint_type='FOREIGN KEY' AND kcu.column_name='part_id'
  ) THEN
    ALTER TABLE purchase_order_allocations
      ADD CONSTRAINT fk_purchase_order_allocations_part_id
      FOREIGN KEY (part_id) REFERENCES inventory(part_id) ON DELETE CASCADE;
  END IF;
END $$;

-- Step 5: Create indexes on part_id for better performance
CREATE INDEX IF NOT EXISTS idx_salesorderlineitems_part_id ON salesorderlineitems(part_id);
CREATE INDEX IF NOT EXISTS idx_purchaselineitems_part_id ON purchaselineitems(part_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_allocations_part_id ON purchase_order_allocations(part_id);

-- Step 6: Update unique constraints to use part_id instead of part_number
DO $$
BEGIN
  -- Update purchase_order_allocations unique constraint
  IF EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ux_inventory_vendors_map'
  ) THEN
    DROP INDEX IF EXISTS ux_inventory_vendors_map;
  END IF;
  
  -- Create new unique constraint for purchase_order_allocations using part_id
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ux_purchase_order_allocations_part_id'
  ) THEN
    CREATE UNIQUE INDEX ux_purchase_order_allocations_part_id
    ON purchase_order_allocations (purchase_id, sales_order_id, part_id)
    WHERE part_id IS NOT NULL;
  END IF;
END $$;

-- Migration completed successfully
-- The part_id columns have been added and populated
-- Foreign key constraints have been updated to use part_id
-- Indexes have been created for better performance

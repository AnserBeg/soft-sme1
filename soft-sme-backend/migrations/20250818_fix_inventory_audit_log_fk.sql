-- Align inventory_audit_log.part_id with inventory.part_id (INTEGER FK)
-- Steps:
-- 1) Ensure inventory has a numeric part_id column
-- 2) Create a temporary column on audit log for numeric ids
-- 3) Backfill numeric ids by joining via part_number
-- 4) Swap columns and add FK

-- 1) Ensure inventory.part_id exists (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inventory' AND column_name='part_id'
  ) THEN
    ALTER TABLE inventory ADD COLUMN part_id SERIAL;
    -- Create unique index if missing
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ux_inventory_part_id'
    ) THEN
      CREATE UNIQUE INDEX ux_inventory_part_id ON inventory(part_id);
    END IF;
  END IF;
END $$;

-- 2) Add temp numeric column if needed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inventory_audit_log' AND column_name='part_id_int'
  ) THEN
    ALTER TABLE inventory_audit_log ADD COLUMN part_id_int INTEGER;
  END IF;
END $$;

-- 3) Backfill using part_number mapping if possible
-- Only run if audit log currently stores string part ids matching inventory.part_number
-- We cannot join directly without the original part_number, so handle two cases:
--   a) If inventory_audit_log.part_id is numeric already, copy over
--   b) If it's text, try to map by matching inventory.part_number = audit.part_id
DO $$
DECLARE
  part_id_is_text BOOLEAN;
BEGIN
  SELECT (data_type <> 'integer') INTO part_id_is_text
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='inventory_audit_log' AND column_name='part_id';

  IF part_id_is_text THEN
    -- Attempt best-effort backfill
    UPDATE inventory_audit_log ial
    SET part_id_int = inv.part_id
    FROM inventory inv
    WHERE CAST(ial.part_id AS TEXT) = inv.part_number
      AND ial.part_id_int IS NULL;
  ELSE
    -- Already integer, copy values
    UPDATE inventory_audit_log SET part_id_int = part_id WHERE part_id_int IS NULL;
  END IF;
END $$;

-- 4) Drop old FK if exists, replace column, add new FK
DO $$
BEGIN
  -- Drop existing FK if present (check multiple possible constraint names)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    WHERE tc.table_schema='public' AND tc.table_name='inventory_audit_log'
      AND tc.constraint_type='FOREIGN KEY' 
      AND tc.constraint_name LIKE '%part_id%'
  ) THEN
    -- Get the actual constraint name and drop it
    EXECUTE (
      'ALTER TABLE inventory_audit_log DROP CONSTRAINT ' || 
      (SELECT tc.constraint_name 
       FROM information_schema.table_constraints tc
       WHERE tc.table_schema='public' AND tc.table_name='inventory_audit_log'
         AND tc.constraint_type='FOREIGN KEY' 
         AND tc.constraint_name LIKE '%part_id%'
       LIMIT 1)
    );
  END IF;

  -- Change column type to INTEGER using the backfilled temp column
  ALTER TABLE inventory_audit_log
    ALTER COLUMN part_id DROP DEFAULT,
    ALTER COLUMN part_id TYPE INTEGER USING COALESCE(part_id_int, NULL),
    DROP COLUMN part_id_int;

  -- Add FK to inventory(part_id)
  ALTER TABLE inventory_audit_log
    ADD CONSTRAINT fk_inventory_audit_log_part_id
    FOREIGN KEY (part_id) REFERENCES inventory(part_id) ON DELETE SET NULL;
END $$;



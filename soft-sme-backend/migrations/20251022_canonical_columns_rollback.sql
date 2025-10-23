-- Roll back the canonical column migration so it can be safely reapplied.
-- This removes the generated columns, indexes, and helper functions. All
-- derived canonical data will be recomputed when the forward migration runs
-- again.

-- Drop the uniqueness constraint before the columns it references.
ALTER TABLE inventory
    DROP CONSTRAINT IF EXISTS inventory_canonical_part_number_key;

-- Remove supporting indexes.
DROP INDEX IF EXISTS idx_vendormaster_canonical_name_trgm;
DROP INDEX IF EXISTS idx_customermaster_canonical_name_trgm;
DROP INDEX IF EXISTS idx_inventory_canonical_part_number_trgm;
DROP INDEX IF EXISTS idx_inventory_canonical_name_trgm;

-- Remove the derived canonical columns.
ALTER TABLE vendormaster
    DROP COLUMN IF EXISTS canonical_name;

ALTER TABLE customermaster
    DROP COLUMN IF EXISTS canonical_name;

ALTER TABLE inventory
    DROP COLUMN IF EXISTS canonical_part_number,
    DROP COLUMN IF EXISTS canonical_name;

-- Drop the helper functions so the latest definitions can be installed.
DROP FUNCTION IF EXISTS canonicalize_part_number(TEXT);
DROP FUNCTION IF EXISTS canonicalize_text(TEXT);

-- Enable required extensions for canonical text search support
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- Drop the canonical uniqueness constraint if it already exists so the
-- backfill statements below can run without immediate uniqueness checks.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'inventory_canonical_part_number_key'
          AND conrelid = 'inventory'::regclass
    ) THEN
        ALTER TABLE inventory
            DROP CONSTRAINT inventory_canonical_part_number_key;
    END IF;
END;
$$;

-- Ensure canonical columns exist with a non-null default
ALTER TABLE vendormaster
    ADD COLUMN IF NOT EXISTS canonical_name TEXT NOT NULL DEFAULT '';

ALTER TABLE customermaster
    ADD COLUMN IF NOT EXISTS canonical_name TEXT NOT NULL DEFAULT '';

ALTER TABLE inventory
    ADD COLUMN IF NOT EXISTS canonical_part_number TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS canonical_name TEXT NOT NULL DEFAULT '';

-- Canonicalization helper for general names
CREATE OR REPLACE FUNCTION canonicalize_text(input TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT COALESCE(
        NULLIF(
            REGEXP_REPLACE(
                REGEXP_REPLACE(
                    REGEXP_REPLACE(
                        UPPER(unaccent(input)),
                        '[^0-9A-Z]+',
                        ' ',
                        'g'
                    ),
                    '\\s+',
                    ' ',
                    'g'
                ),
                '^\\s+|\\s+$',
                '',
                'g'
            ),
            ''
        ),
        ''
    );
$$;

-- Canonicalization helper specialized for part numbers
CREATE OR REPLACE FUNCTION canonicalize_part_number(input TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT COALESCE(
        NULLIF(
            REGEXP_REPLACE(
                REGEXP_REPLACE(
                    UPPER(unaccent(input)),
                    '[-\\s\\./]+',
                    '',
                    'g'
                ),
                '[^0-9A-Z]+',
                '',
                'g'
            ),
            ''
        ),
        ''
    );
$$;

-- Backfill canonical values using the helper functions
UPDATE vendormaster
SET canonical_name = canonicalize_text(vendor_name);

UPDATE customermaster
SET canonical_name = canonicalize_text(customer_name);

UPDATE inventory
SET canonical_part_number = canonicalize_part_number(part_number),
    canonical_name = canonicalize_text(part_description);

-- Make empty canonical part numbers unique with deterministic placeholders
WITH blank_part_numbers AS (
    SELECT part_number
    FROM inventory
    WHERE canonical_part_number = ''
)
UPDATE inventory i
SET canonical_part_number = 'NOPARTNUMBER' || UPPER(MD5(blank_part_numbers.part_number::TEXT))
FROM blank_part_numbers
WHERE i.part_number = blank_part_numbers.part_number;

-- Deduplicate remaining canonical part numbers by appending a stable suffix
WITH duplicate_part_numbers AS (
    SELECT part_number,
           canonical_part_number,
           ROW_NUMBER() OVER (
               PARTITION BY canonical_part_number
               ORDER BY part_number
           ) AS rn
    FROM inventory
    WHERE canonical_part_number <> ''
)
UPDATE inventory i
SET canonical_part_number = duplicate_part_numbers.canonical_part_number || 'DUP' || LPAD(duplicate_part_numbers.rn::TEXT, 6, '0')
FROM duplicate_part_numbers
WHERE i.part_number = duplicate_part_numbers.part_number
  AND duplicate_part_numbers.rn > 1;

-- Create trigram indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_vendormaster_canonical_name_trgm
    ON vendormaster USING GIN (canonical_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customermaster_canonical_name_trgm
    ON customermaster USING GIN (canonical_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_inventory_canonical_part_number_trgm
    ON inventory USING GIN (canonical_part_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_inventory_canonical_name_trgm
    ON inventory USING GIN (canonical_name gin_trgm_ops);

-- Add the unique constraint on canonical part numbers if it is not already present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'inventory_canonical_part_number_key'
          AND conrelid = 'inventory'::regclass
    ) THEN
        ALTER TABLE inventory
            ADD CONSTRAINT inventory_canonical_part_number_key
            UNIQUE (canonical_part_number)
            DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
END;
$$;

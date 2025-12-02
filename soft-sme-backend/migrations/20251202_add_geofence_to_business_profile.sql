ALTER TABLE business_profile
ADD COLUMN IF NOT EXISTS geo_fence_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS geo_fence_center_latitude NUMERIC(9,6),
ADD COLUMN IF NOT EXISTS geo_fence_center_longitude NUMERIC(9,6),
ADD COLUMN IF NOT EXISTS geo_fence_radius_meters INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'business_profile'
      AND column_name = 'geo_fence_radius_meters'
  ) THEN
    -- no-op placeholder to keep the DO block valid if future changes are needed
    NULL;
  END IF;
END $$;

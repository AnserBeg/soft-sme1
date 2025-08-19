-- Change quantity_on_hand column to VARCHAR to allow "NA" values for supply items
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'inventory'
      AND column_name = 'quantity_on_hand'
      AND data_type <> 'character varying'
  ) THEN
    ALTER TABLE inventory 
    ALTER COLUMN quantity_on_hand TYPE VARCHAR(20);
  END IF;
END $$;

-- Add a comment to explain the new data type
COMMENT ON COLUMN inventory.quantity_on_hand IS 'Quantity on hand. For stock items: numeric value. For supply items: "NA".'; 
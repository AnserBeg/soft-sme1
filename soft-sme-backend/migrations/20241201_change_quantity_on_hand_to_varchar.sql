-- Change quantity_on_hand column to VARCHAR to allow "NA" values for supply items
ALTER TABLE inventory 
ALTER COLUMN quantity_on_hand TYPE VARCHAR(20);

-- Add a comment to explain the new data type
COMMENT ON COLUMN inventory.quantity_on_hand IS 'Quantity on hand. For stock items: numeric value. For supply items: "NA".'; 
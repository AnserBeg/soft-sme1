-- Remove pickup and order tracking fields from purchase orders

ALTER TABLE purchasehistory
  DROP COLUMN IF EXISTS pickup_notes,
  DROP COLUMN IF EXISTS pickup_time,
  DROP COLUMN IF EXISTS pickup_location,
  DROP COLUMN IF EXISTS pickup_contact_person,
  DROP COLUMN IF EXISTS pickup_phone,
  DROP COLUMN IF EXISTS pickup_instructions,
  DROP COLUMN IF EXISTS order_placed,
  DROP COLUMN IF EXISTS order_placed_at,
  DROP COLUMN IF EXISTS order_placed_by,
  DROP COLUMN IF EXISTS order_placed_method,
  DROP COLUMN IF EXISTS vendor_confirmation_status,
  DROP COLUMN IF EXISTS vendor_confirmation_notes,
  DROP COLUMN IF EXISTS vendor_confirmation_date,
  DROP COLUMN IF EXISTS pricing_updated,
  DROP COLUMN IF EXISTS pricing_updated_at,
  DROP COLUMN IF EXISTS pricing_updated_by,
  DROP COLUMN IF EXISTS pricing_updated_method,
  DROP COLUMN IF EXISTS quantity_adjusted,
  DROP COLUMN IF EXISTS quantity_adjusted_at,
  DROP COLUMN IF EXISTS quantity_adjusted_by,
  DROP COLUMN IF EXISTS quantity_adjusted_method,
  DROP COLUMN IF EXISTS original_quantities,
  DROP COLUMN IF EXISTS adjusted_quantities,
  DROP COLUMN IF EXISTS vendor_pricing_notes;

DROP INDEX IF EXISTS idx_purchasehistory_pickup_time;
DROP INDEX IF EXISTS idx_purchasehistory_pickup_location;
DROP INDEX IF EXISTS idx_purchasehistory_order_placed;
DROP INDEX IF EXISTS idx_purchasehistory_vendor_confirmation_status;
DROP INDEX IF EXISTS idx_purchasehistory_pricing_updated;
DROP INDEX IF EXISTS idx_purchasehistory_quantity_adjusted;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'purchase_orders') THEN
    ALTER TABLE purchase_orders
      DROP COLUMN IF EXISTS pickup_notes,
      DROP COLUMN IF EXISTS pickup_time,
      DROP COLUMN IF EXISTS pickup_location,
      DROP COLUMN IF EXISTS pickup_contact_person,
      DROP COLUMN IF EXISTS pickup_phone,
      DROP COLUMN IF EXISTS pickup_instructions,
      DROP COLUMN IF EXISTS order_placed,
      DROP COLUMN IF EXISTS order_placed_at,
      DROP COLUMN IF EXISTS order_placed_by,
      DROP COLUMN IF EXISTS order_placed_method,
      DROP COLUMN IF EXISTS vendor_confirmation_status,
      DROP COLUMN IF EXISTS vendor_confirmation_notes,
      DROP COLUMN IF EXISTS vendor_confirmation_date,
      DROP COLUMN IF EXISTS pricing_updated,
      DROP COLUMN IF EXISTS pricing_updated_at,
      DROP COLUMN IF EXISTS pricing_updated_by,
      DROP COLUMN IF EXISTS pricing_updated_method,
      DROP COLUMN IF EXISTS quantity_adjusted,
      DROP COLUMN IF EXISTS quantity_adjusted_at,
      DROP COLUMN IF EXISTS quantity_adjusted_by,
      DROP COLUMN IF EXISTS quantity_adjusted_method,
      DROP COLUMN IF EXISTS original_quantities,
      DROP COLUMN IF EXISTS adjusted_quantities,
      DROP COLUMN IF EXISTS vendor_pricing_notes;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'purchaseorder') THEN
    ALTER TABLE purchaseorder
      DROP COLUMN IF EXISTS pickup_notes,
      DROP COLUMN IF EXISTS pickup_time,
      DROP COLUMN IF EXISTS pickup_location,
      DROP COLUMN IF EXISTS pickup_contact_person,
      DROP COLUMN IF EXISTS pickup_phone,
      DROP COLUMN IF EXISTS pickup_instructions,
      DROP COLUMN IF EXISTS order_placed,
      DROP COLUMN IF EXISTS order_placed_at,
      DROP COLUMN IF EXISTS order_placed_by,
      DROP COLUMN IF EXISTS order_placed_method,
      DROP COLUMN IF EXISTS vendor_confirmation_status,
      DROP COLUMN IF EXISTS vendor_confirmation_notes,
      DROP COLUMN IF EXISTS vendor_confirmation_date,
      DROP COLUMN IF EXISTS pricing_updated,
      DROP COLUMN IF EXISTS pricing_updated_at,
      DROP COLUMN IF EXISTS pricing_updated_by,
      DROP COLUMN IF EXISTS pricing_updated_method,
      DROP COLUMN IF EXISTS quantity_adjusted,
      DROP COLUMN IF EXISTS quantity_adjusted_at,
      DROP COLUMN IF EXISTS quantity_adjusted_by,
      DROP COLUMN IF EXISTS quantity_adjusted_method,
      DROP COLUMN IF EXISTS original_quantities,
      DROP COLUMN IF EXISTS adjusted_quantities,
      DROP COLUMN IF EXISTS vendor_pricing_notes;
  END IF;
END $$;

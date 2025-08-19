-- Populate part_id values in inventory_vendors table
UPDATE inventory_vendors 
SET part_id = i.part_id
FROM inventory i
WHERE inventory_vendors.part_number = i.part_number
AND inventory_vendors.part_id IS NULL;

-- Verify the update
SELECT 
  COUNT(*) as total_vendor_mappings,
  COUNT(part_id) as mappings_with_part_id,
  COUNT(*) - COUNT(part_id) as mappings_without_part_id
FROM inventory_vendors;

-- Table to map canonical parts to vendor-specific part numbers
CREATE TABLE IF NOT EXISTS inventory_vendors (
  id SERIAL PRIMARY KEY,
  part_number TEXT NOT NULL,
  vendor_id INTEGER NOT NULL,
  vendor_part_number TEXT NOT NULL,
  vendor_part_description TEXT NULL,
  preferred BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP NULL,
  CONSTRAINT fk_inventory_vendors_part
    FOREIGN KEY (part_number) REFERENCES inventory(part_number)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_inventory_vendors_vendor
    FOREIGN KEY (vendor_id) REFERENCES vendormaster(vendor_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

-- Ensure uniqueness for the same vendor-part mapping
CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_vendors_map
  ON inventory_vendors (part_number, vendor_id, vendor_part_number);

CREATE INDEX IF NOT EXISTS ix_inventory_vendors_part
  ON inventory_vendors (part_number);

CREATE INDEX IF NOT EXISTS ix_inventory_vendors_vendor
  ON inventory_vendors (vendor_id);



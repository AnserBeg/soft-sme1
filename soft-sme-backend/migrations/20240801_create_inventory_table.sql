-- Create inventory table
CREATE TABLE IF NOT EXISTS inventory (
  part_number VARCHAR(50) PRIMARY KEY,
  part_description VARCHAR(255),
  unit VARCHAR(50),
  last_unit_cost NUMERIC(12, 2),
  quantity_on_hand NUMERIC(12, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  reorder_point NUMERIC(12, 2),
  part_type VARCHAR(10) NOT NULL DEFAULT 'stock'
);

-- Add a check constraint to ensure part_type is either 'stock' or 'supply'
ALTER TABLE inventory
  ADD CONSTRAINT IF NOT EXISTS check_part_type CHECK (part_type IN ('stock', 'supply'));

-- Create an index on part_type for better query performance
CREATE INDEX IF NOT EXISTS idx_inventory_part_type ON inventory(part_type);

-- Create a trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_inventory_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_inventory_updated_at ON inventory;

CREATE TRIGGER update_inventory_updated_at
BEFORE UPDATE ON inventory
FOR EACH ROW
EXECUTE FUNCTION update_inventory_updated_at_column(); 
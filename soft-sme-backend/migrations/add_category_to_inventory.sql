-- Migration to add category field to the existing inventory table.
-- This script is idempotent and can be run safely multiple times.
-- It only adds the category column and its related constraints/indexes if they don't already exist.

-- 1. Add the category column if it doesn't exist.
-- It defaults to 'Uncategorized' for all existing rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'inventory' AND column_name = 'category'
  ) THEN
    ALTER TABLE inventory ADD COLUMN category VARCHAR(100) NOT NULL DEFAULT 'Uncategorized';
  END IF;
END $$;

-- 2. Create an index on the new column for better query performance if it doesn't exist.
CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory(category);

-- 3. Create a separate table for managing categories if it doesn't exist.
CREATE TABLE IF NOT EXISTS part_categories (
  category_id SERIAL PRIMARY KEY,
  category_name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Create a trigger to automatically update the updated_at timestamp for part_categories
CREATE OR REPLACE FUNCTION update_part_categories_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_part_categories_updated_at ON part_categories;

CREATE TRIGGER update_part_categories_updated_at
BEFORE UPDATE ON part_categories
FOR EACH ROW
EXECUTE FUNCTION update_part_categories_updated_at_column();

-- 5. Insert default categories if the table is empty
INSERT INTO part_categories (category_name, description) 
VALUES 
  ('Uncategorized', 'Default category for parts without specific classification'),
  ('Fasteners', 'Screws, bolts, nuts, washers, and other fastening hardware'),
  ('Electrical', 'Wires, connectors, switches, and electrical components'),
  ('Plumbing', 'Pipes, fittings, valves, and plumbing components'),
  ('Tools', 'Hand tools, power tools, and tool accessories'),
  ('Safety', 'Safety equipment, PPE, and safety-related items'),
  ('Raw Materials', 'Basic materials like steel, aluminum, wood, etc.'),
  ('Consumables', 'Items that are used up during work like welding rods, cutting discs'),
  ('Lubricants', 'Oils, greases, and other lubricating materials'),
  ('Adhesives', 'Glues, tapes, sealants, and bonding materials')
ON CONFLICT (category_name) DO NOTHING;

-- Note: The `DEFAULT 'Uncategorized'` in the ADD COLUMN statement handles setting the value for existing rows.
-- An explicit UPDATE is not necessary if the column is being added for the first time.

-- 6. Verify the changes (optional)
-- You can run this SELECT statement in pgAdmin to see the final structure.
-- SELECT column_name, data_type, is_nullable, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'inventory';

-- Add quantity_to_order and quantity_committed columns to salesorderlineitems table
-- This migration adds support for tracking quantities that need to be ordered
-- and quantities that have been committed from purchase orders

-- Add quantity_to_order column to salesorderlineitems table
ALTER TABLE salesorderlineitems 
ADD COLUMN IF NOT EXISTS quantity_to_order DECIMAL(10,2) DEFAULT 0;

-- Add quantity_committed column if it doesn't exist (for allocation tracking)
ALTER TABLE salesorderlineitems 
ADD COLUMN IF NOT EXISTS quantity_committed DECIMAL(10,2) DEFAULT 0;

-- Update existing records to have quantity_to_order = 0
UPDATE salesorderlineitems 
SET quantity_to_order = 0 
WHERE quantity_to_order IS NULL;

-- Update existing records to have quantity_committed = 0
UPDATE salesorderlineitems 
SET quantity_committed = 0 
WHERE quantity_committed IS NULL; 
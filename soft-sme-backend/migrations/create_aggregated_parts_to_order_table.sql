-- Create aggregated_parts_to_order table
CREATE TABLE IF NOT EXISTS aggregated_parts_to_order (
  id SERIAL PRIMARY KEY,
  part_number VARCHAR(255) NOT NULL UNIQUE,
  part_description TEXT,
  total_quantity_needed DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit VARCHAR(50),
  unit_price DECIMAL(10,2) DEFAULT 0,
  total_line_amount DECIMAL(10,2) DEFAULT 0,
  min_required_quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_aggregated_parts_to_order_part_number ON aggregated_parts_to_order(part_number);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_aggregated_parts_to_order_updated_at 
    BEFORE UPDATE ON aggregated_parts_to_order 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column(); 
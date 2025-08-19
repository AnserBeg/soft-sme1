-- Create sales_order_parts_to_order table
CREATE TABLE IF NOT EXISTS sales_order_parts_to_order (
  id SERIAL PRIMARY KEY,
  sales_order_id INTEGER NOT NULL REFERENCES salesorderhistory(sales_order_id) ON DELETE CASCADE,
  part_number VARCHAR(255) NOT NULL,
  part_description TEXT,
  quantity_needed DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit VARCHAR(50),
  unit_price DECIMAL(10,2) DEFAULT 0,
  line_amount DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_sales_order_parts_to_order_sales_order_id ON sales_order_parts_to_order(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_sales_order_parts_to_order_part_number ON sales_order_parts_to_order(part_number);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_sales_order_parts_to_order_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_sales_order_parts_to_order_updated_at ON sales_order_parts_to_order;
CREATE TRIGGER update_sales_order_parts_to_order_updated_at 
    BEFORE UPDATE ON sales_order_parts_to_order 
    FOR EACH ROW 
    EXECUTE FUNCTION update_sales_order_parts_to_order_updated_at_column(); 
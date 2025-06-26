-- Create quotes table
CREATE TABLE IF NOT EXISTS quotes (
  quote_id SERIAL PRIMARY KEY,
  quote_number VARCHAR(255) UNIQUE NOT NULL,
  customer_id INTEGER,
  quote_date DATE,
  valid_until DATE,
  product_name VARCHAR(255),
  product_description TEXT,
  estimated_cost DECIMAL(12, 2),
  status VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  sequence_number VARCHAR(16)
);

-- Create an index on sequence_number for better query performance
CREATE INDEX IF NOT EXISTS idx_quotes_sequence_number ON quotes(sequence_number);

-- Create a trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_quotes_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_quotes_updated_at ON quotes;

CREATE TRIGGER update_quotes_updated_at
BEFORE UPDATE ON quotes
FOR EACH ROW
EXECUTE FUNCTION update_quotes_updated_at_column(); 
-- Create labourrate table for storing the hourly labour rate
CREATE TABLE IF NOT EXISTS labourrate (
  id SERIAL PRIMARY KEY,
  rate NUMERIC(10,2) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trigger to update updated_at on change
CREATE OR REPLACE FUNCTION update_labourrate_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_labourrate_updated_at ON labourrate;

CREATE TRIGGER update_labourrate_updated_at
BEFORE UPDATE ON labourrate
FOR EACH ROW
EXECUTE FUNCTION update_labourrate_updated_at_column(); 
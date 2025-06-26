-- Create marginschedule table
CREATE TABLE IF NOT EXISTS marginschedule (
  margin_id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  cost_lower_bound NUMERIC(12, 2) NOT NULL,
  cost_upper_bound NUMERIC(12, 2) NOT NULL,
  margin_factor NUMERIC(6, 4) NOT NULL
);

-- Create a trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_marginschedule_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_marginschedule_updated_at ON marginschedule;

CREATE TRIGGER update_marginschedule_updated_at
BEFORE UPDATE ON marginschedule
FOR EACH ROW
EXECUTE FUNCTION update_marginschedule_updated_at_column(); 
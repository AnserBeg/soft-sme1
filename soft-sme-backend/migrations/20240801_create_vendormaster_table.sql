-- Create vendormaster table
CREATE TABLE IF NOT EXISTS vendormaster (
  vendor_id SERIAL PRIMARY KEY,
  vendor_name VARCHAR(255) NOT NULL,
  street_address VARCHAR(255),
  city VARCHAR(100),
  province VARCHAR(100),
  country VARCHAR(100),
  contact_person VARCHAR(255),
  telephone_number VARCHAR(50),
  email VARCHAR(255),
  website VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create a trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_vendormaster_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_vendormaster_updated_at ON vendormaster;

CREATE TRIGGER update_vendormaster_updated_at
BEFORE UPDATE ON vendormaster
FOR EACH ROW
EXECUTE FUNCTION update_vendormaster_updated_at_column(); 
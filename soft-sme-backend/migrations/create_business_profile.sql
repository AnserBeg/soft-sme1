CREATE TABLE IF NOT EXISTS business_profile (
    id SERIAL PRIMARY KEY,
    business_name VARCHAR(255) NOT NULL,
    street_address VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    province VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL,
    telephone_number VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    business_number VARCHAR(50) NOT NULL,
    logo_url VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create a trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_business_profile_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop trigger if it already exists before creating it
DROP TRIGGER IF EXISTS update_business_profile_updated_at ON business_profile;

CREATE TRIGGER update_business_profile_updated_at
BEFORE UPDATE ON business_profile
FOR EACH ROW
EXECUTE FUNCTION update_business_profile_updated_at_column(); 
-- Add customer_po_number and vin_number columns to quotes table
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_po_number VARCHAR(255);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS vin_number VARCHAR(255);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_quotes_customer_po_number ON quotes(customer_po_number);
CREATE INDEX IF NOT EXISTS idx_quotes_vin_number ON quotes(vin_number); 
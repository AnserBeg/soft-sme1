-- Add customer_po_number and vin_number columns to salesorderhistory table
ALTER TABLE salesorderhistory ADD COLUMN IF NOT EXISTS customer_po_number VARCHAR(255);
ALTER TABLE salesorderhistory ADD COLUMN IF NOT EXISTS vin_number VARCHAR(255);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_salesorderhistory_customer_po_number ON salesorderhistory(customer_po_number);
CREATE INDEX IF NOT EXISTS idx_salesorderhistory_vin_number ON salesorderhistory(vin_number); 
-- Add terms column to salesorderhistory table
ALTER TABLE salesorderhistory ADD COLUMN IF NOT EXISTS terms TEXT;

-- Add index for better performance if needed
CREATE INDEX IF NOT EXISTS idx_salesorderhistory_terms ON salesorderhistory(terms); 
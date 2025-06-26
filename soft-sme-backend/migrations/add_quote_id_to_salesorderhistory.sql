-- Add quote_id column to salesorderhistory table
ALTER TABLE salesorderhistory ADD COLUMN IF NOT EXISTS quote_id INTEGER;

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_salesorderhistory_quote_id ON salesorderhistory(quote_id); 
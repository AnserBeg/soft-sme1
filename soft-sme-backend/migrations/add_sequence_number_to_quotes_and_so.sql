-- Add sequence_number to salesorderhistory if not exists
ALTER TABLE salesorderhistory ADD COLUMN IF NOT EXISTS sequence_number VARCHAR(16);
CREATE INDEX IF NOT EXISTS idx_salesorderhistory_sequence_number ON salesorderhistory(sequence_number);

-- Add sequence_number to quotes if not exists
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sequence_number VARCHAR(16);
CREATE INDEX IF NOT EXISTS idx_quotes_sequence_number ON quotes(sequence_number); 
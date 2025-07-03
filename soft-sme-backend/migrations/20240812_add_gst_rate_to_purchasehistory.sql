-- Add gst_rate column to purchasehistory table
ALTER TABLE purchasehistory ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2) DEFAULT 5.0;

-- Backfill existing rows with 5.0 if null
UPDATE purchasehistory SET gst_rate = 5.0 WHERE gst_rate IS NULL; 
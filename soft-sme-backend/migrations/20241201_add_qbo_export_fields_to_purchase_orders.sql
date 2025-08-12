-- Add QuickBooks export fields to purchasehistory table
ALTER TABLE purchasehistory 
ADD COLUMN IF NOT EXISTS qbo_bill_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS qbo_export_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS qbo_export_status VARCHAR(50) DEFAULT 'not_exported';

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_purchasehistory_qbo_export_status ON purchasehistory(qbo_export_status);
CREATE INDEX IF NOT EXISTS idx_purchasehistory_qbo_bill_id ON purchasehistory(qbo_bill_id); 
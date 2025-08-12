-- Add QBO export fields to salesorderhistory table
-- This allows sales orders to be exported to QuickBooks as invoices

ALTER TABLE salesorderhistory 
ADD COLUMN IF NOT EXISTS exported_to_qbo BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS qbo_invoice_id VARCHAR(64),
ADD COLUMN IF NOT EXISTS qbo_export_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS qbo_export_status VARCHAR(255);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_salesorderhistory_qbo_export_status ON salesorderhistory(qbo_export_status);
CREATE INDEX IF NOT EXISTS idx_salesorderhistory_exported_to_qbo ON salesorderhistory(exported_to_qbo);

-- Add comments to document the new fields
COMMENT ON COLUMN salesorderhistory.exported_to_qbo IS 'Whether this sales order has been exported to QuickBooks';
COMMENT ON COLUMN salesorderhistory.qbo_invoice_id IS 'QuickBooks invoice ID after export';
COMMENT ON COLUMN salesorderhistory.qbo_export_date IS 'Date when the sales order was exported to QuickBooks';
COMMENT ON COLUMN salesorderhistory.qbo_export_status IS 'Status of the QBO export (success, error, etc.)'; 
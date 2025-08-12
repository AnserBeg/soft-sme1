-- Add sales-related account mappings to qbo_account_mapping table
-- This allows sales orders to be exported to QuickBooks with proper account mapping

ALTER TABLE qbo_account_mapping 
ADD COLUMN IF NOT EXISTS qbo_sales_account_id VARCHAR(64),
ADD COLUMN IF NOT EXISTS qbo_labour_sales_account_id VARCHAR(64),
ADD COLUMN IF NOT EXISTS qbo_ar_account_id VARCHAR(64);

-- Add comments to document the new fields
COMMENT ON COLUMN qbo_account_mapping.qbo_sales_account_id IS 'QuickBooks account ID for sales revenue (materials, parts, etc.)';
COMMENT ON COLUMN qbo_account_mapping.qbo_labour_sales_account_id IS 'QuickBooks account ID for labour sales revenue';
COMMENT ON COLUMN qbo_account_mapping.qbo_ar_account_id IS 'QuickBooks account ID for accounts receivable'; 
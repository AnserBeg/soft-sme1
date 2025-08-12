-- Add COGS account mapping to qbo_account_mapping table
-- This allows proper cost of goods sold accounting for sales orders

ALTER TABLE qbo_account_mapping 
ADD COLUMN IF NOT EXISTS qbo_cogs_account_id VARCHAR(64);

-- Add comment to document the new field
COMMENT ON COLUMN qbo_account_mapping.qbo_cogs_account_id IS 'QuickBooks account ID for cost of goods sold (expense account)'; 
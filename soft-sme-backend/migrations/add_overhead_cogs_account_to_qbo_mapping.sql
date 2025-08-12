-- Add overhead COGS account to QBO account mapping
ALTER TABLE qbo_account_mapping
ADD COLUMN IF NOT EXISTS qbo_overhead_cogs_account_id VARCHAR(64);

COMMENT ON COLUMN qbo_account_mapping.qbo_overhead_cogs_account_id IS 'QuickBooks account ID for overhead cost of goods sold (expense account)';

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_qbo_account_mapping_overhead_cogs
ON qbo_account_mapping(qbo_overhead_cogs_account_id); 
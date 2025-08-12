-- Add labour expense reduction account to QBO account mapping
ALTER TABLE qbo_account_mapping
ADD COLUMN IF NOT EXISTS qbo_labour_expense_reduction_account_id VARCHAR(64);

COMMENT ON COLUMN qbo_account_mapping.qbo_labour_expense_reduction_account_id IS 'QuickBooks account ID for labour expense reduction (used when labour costs are reduced upon sale)';

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_qbo_account_mapping_labour_expense_reduction
ON qbo_account_mapping(qbo_labour_expense_reduction_account_id); 
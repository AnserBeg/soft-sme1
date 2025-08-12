-- Add payroll account to QBO account mapping
ALTER TABLE qbo_account_mapping
ADD COLUMN IF NOT EXISTS qbo_payroll_account_id VARCHAR(64);

COMMENT ON COLUMN qbo_account_mapping.qbo_payroll_account_id IS 'QuickBooks account ID for payroll expenses (used when labour costs are expensed)';

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_qbo_account_mapping_payroll 
ON qbo_account_mapping(qbo_payroll_account_id); 
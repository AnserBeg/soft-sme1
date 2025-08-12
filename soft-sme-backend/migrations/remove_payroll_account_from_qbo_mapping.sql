-- Remove payroll account from QBO account mapping
ALTER TABLE qbo_account_mapping
DROP COLUMN IF EXISTS qbo_payroll_account_id;

-- Drop the index if it exists
DROP INDEX IF EXISTS idx_qbo_account_mapping_payroll; 
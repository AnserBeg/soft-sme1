-- Add supply expense account field to qbo_account_mapping table
-- This allows supply items to be mapped to expense accounts in QuickBooks

ALTER TABLE qbo_account_mapping 
ADD COLUMN IF NOT EXISTS qbo_supply_expense_account_id VARCHAR(64);

-- Add a comment to document the new field
COMMENT ON COLUMN qbo_account_mapping.qbo_supply_expense_account_id IS 'QuickBooks account ID for supply expense items (e.g., Office Supplies, Tools, etc.)'; 
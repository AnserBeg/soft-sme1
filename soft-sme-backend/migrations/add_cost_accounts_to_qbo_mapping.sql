-- Add cost-related account mappings to qbo_account_mapping table
-- This allows proper cost tracking for sales orders

ALTER TABLE qbo_account_mapping 
ADD COLUMN IF NOT EXISTS qbo_cost_of_labour_account_id VARCHAR(64),
ADD COLUMN IF NOT EXISTS qbo_cost_of_materials_account_id VARCHAR(64);

-- Add comments to document the new fields
COMMENT ON COLUMN qbo_account_mapping.qbo_cost_of_labour_account_id IS 'QuickBooks account ID for cost of labour (expense account)';
COMMENT ON COLUMN qbo_account_mapping.qbo_cost_of_materials_account_id IS 'QuickBooks account ID for cost of materials (expense account)'; 
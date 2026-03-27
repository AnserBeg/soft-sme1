-- Add service account mappings to qbo_account_mapping table
ALTER TABLE qbo_account_mapping
ADD COLUMN IF NOT EXISTS qbo_service_expense_account_id VARCHAR(64),
ADD COLUMN IF NOT EXISTS qbo_cost_of_services_account_id VARCHAR(64);

COMMENT ON COLUMN qbo_account_mapping.qbo_service_expense_account_id IS 'QuickBooks account ID for service expense items (service purchases)';
COMMENT ON COLUMN qbo_account_mapping.qbo_cost_of_services_account_id IS 'QuickBooks account ID for cost of services sold (COGS)';

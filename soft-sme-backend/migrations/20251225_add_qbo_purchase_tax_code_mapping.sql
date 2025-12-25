-- Add optional QBO purchase tax code mapping for bill exports
ALTER TABLE qbo_account_mapping
  ADD COLUMN IF NOT EXISTS qbo_purchase_tax_code_id VARCHAR(64);

COMMENT ON COLUMN qbo_account_mapping.qbo_purchase_tax_code_id IS 'QuickBooks TaxCode ID to apply on bill lines for purchase tax (GST/HST)';

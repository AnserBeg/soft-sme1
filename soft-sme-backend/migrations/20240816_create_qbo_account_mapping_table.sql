-- Create table for company-specific QBO account mapping
CREATE TABLE IF NOT EXISTS qbo_account_mapping (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  qbo_inventory_account_id VARCHAR(64) NOT NULL,
  qbo_gst_account_id VARCHAR(64) NOT NULL,
  qbo_ap_account_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (company_id)
); 
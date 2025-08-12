-- Add QBO export status fields to purchasehistory
ALTER TABLE purchasehistory
  ADD COLUMN IF NOT EXISTS exported_to_qbo BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS qbo_exported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qbo_export_status TEXT; 
-- Ensure GST account mapping is optional (QBO tax codes handle GST)
ALTER TABLE qbo_account_mapping
  ALTER COLUMN qbo_gst_account_id DROP NOT NULL;

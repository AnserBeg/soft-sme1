-- Allow QuickBooks GST account mapping to be optional now that tax is handled by QBO tax codes
ALTER TABLE qbo_account_mapping
  ALTER COLUMN qbo_gst_account_id DROP NOT NULL;

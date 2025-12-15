-- Track invoice/attachment ingestions from email for automatic PO creation
CREATE TABLE IF NOT EXISTS invoice_email_ingestions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL DEFAULT 'titan',
  message_uid TEXT NOT NULL,
  message_id TEXT,
  subject TEXT,
  from_address TEXT,
  received_at TIMESTAMP WITH TIME ZONE,
  attachment_id TEXT NOT NULL,
  attachment_filename TEXT,
  attachment_content_type TEXT,
  attachment_size INTEGER,
  status VARCHAR(32) NOT NULL DEFAULT 'processed',
  purchase_id INTEGER REFERENCES purchasehistory(purchase_id) ON DELETE SET NULL,
  ocr_upload_id TEXT,
  ocr_raw_text TEXT,
  ocr_normalized JSONB,
  ocr_warnings JSONB,
  ocr_notes JSONB,
  ocr_issues JSONB,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, provider, message_uid, attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_email_ingestions_user_created
  ON invoice_email_ingestions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_email_ingestions_status
  ON invoice_email_ingestions(status);

CREATE OR REPLACE FUNCTION update_invoice_email_ingestions_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_invoice_email_ingestions_updated_at ON invoice_email_ingestions;

CREATE TRIGGER update_invoice_email_ingestions_updated_at
BEFORE UPDATE ON invoice_email_ingestions
FOR EACH ROW
EXECUTE FUNCTION update_invoice_email_ingestions_updated_at_column();


-- Add technician story field to sales orders and invoices
ALTER TABLE salesorderhistory
  ADD COLUMN IF NOT EXISTS tech_story TEXT;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS tech_story TEXT;

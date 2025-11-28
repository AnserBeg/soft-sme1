-- Create invoices and invoice line items tables
CREATE TABLE IF NOT EXISTS invoices (
  invoice_id SERIAL PRIMARY KEY,
  invoice_number VARCHAR(32) UNIQUE NOT NULL,
  sequence_number VARCHAR(16),
  customer_id INTEGER NOT NULL REFERENCES customermaster(customer_id) ON DELETE CASCADE,
  sales_order_id INTEGER REFERENCES salesorderhistory(sales_order_id) ON DELETE SET NULL,
  source_sales_order_number VARCHAR(64),
  status VARCHAR(20) NOT NULL DEFAULT 'Unpaid',
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 day')::date,
  payment_terms_in_days INTEGER,
  subtotal DECIMAL(12,2) DEFAULT 0,
  total_gst_amount DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoicelineitems (
  invoice_line_item_id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(invoice_id) ON DELETE CASCADE,
  part_id INTEGER REFERENCES inventory(part_id) ON DELETE SET NULL,
  part_number VARCHAR(255),
  part_description TEXT,
  quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
  unit VARCHAR(50),
  unit_price DECIMAL(12,2) DEFAULT 0,
  line_amount DECIMAL(12,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Keep updated_at in sync
CREATE OR REPLACE FUNCTION update_invoices_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_invoices_updated_at ON invoices;
CREATE TRIGGER update_invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION update_invoices_updated_at_column();

DROP TRIGGER IF EXISTS update_invoicelineitems_updated_at ON invoicelineitems;
CREATE TRIGGER update_invoicelineitems_updated_at
BEFORE UPDATE ON invoicelineitems
FOR EACH ROW
EXECUTE FUNCTION update_invoices_updated_at_column();

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_invoicelineitems_invoice_id ON invoicelineitems(invoice_id);

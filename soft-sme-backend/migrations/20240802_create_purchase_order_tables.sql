-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS purchaselineitems CASCADE;
DROP TABLE IF EXISTS purchasehistory CASCADE;

-- Create purchasehistory table
CREATE TABLE IF NOT EXISTS purchasehistory (
  purchase_id SERIAL PRIMARY KEY,
  purchase_number VARCHAR(255) UNIQUE NOT NULL,
  vendor_id INTEGER REFERENCES vendormaster(vendor_id),
  purchase_date DATE,
  date DATE,
  bill_number VARCHAR(255),
  subtotal DECIMAL(10,2),
  total_gst_amount DECIMAL(10,2),
  total_amount DECIMAL(10,2),
  status VARCHAR(50) DEFAULT 'Open',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create purchaselineitems table
CREATE TABLE IF NOT EXISTS purchaselineitems (
  line_item_id SERIAL PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchasehistory(purchase_id),
  part_number VARCHAR(255) NOT NULL,
  part_description TEXT,
  quantity DECIMAL(10,2) NOT NULL,
  unit VARCHAR(50),
  unit_cost DECIMAL(10,2),
  gst_amount DECIMAL(10,2),
  line_total DECIMAL(10,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_purchasehistory_vendor_id ON purchasehistory(vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchasehistory_status ON purchasehistory(status);
CREATE INDEX IF NOT EXISTS idx_purchasehistory_created_at ON purchasehistory(created_at);
CREATE INDEX IF NOT EXISTS idx_purchaselineitems_purchase_id ON purchaselineitems(purchase_id); 
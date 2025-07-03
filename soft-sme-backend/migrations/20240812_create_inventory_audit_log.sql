-- Create inventory_audit_log table
CREATE TABLE IF NOT EXISTS inventory_audit_log (
  id SERIAL PRIMARY KEY,
  part_id VARCHAR(255) NOT NULL,
  delta INTEGER NOT NULL,
  new_on_hand INTEGER NOT NULL,
  reason TEXT,
  sales_order_id INTEGER,
  user_id INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
); 
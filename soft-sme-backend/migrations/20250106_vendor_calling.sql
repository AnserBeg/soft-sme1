-- Vendor calling session and event logs
CREATE TABLE IF NOT EXISTS vendor_call_sessions (
  id SERIAL PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchasehistory(purchase_id) ON DELETE CASCADE,
  vendor_id INTEGER NOT NULL REFERENCES vendormaster(vendor_id) ON DELETE CASCADE,
  vendor_phone VARCHAR(50),
  status VARCHAR(20) DEFAULT 'created',
  captured_email VARCHAR(255),
  emailed_at TIMESTAMP WITH TIME ZONE,
  structured_notes JSONB,
  transcript TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vendor_call_events (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES vendor_call_sessions(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);



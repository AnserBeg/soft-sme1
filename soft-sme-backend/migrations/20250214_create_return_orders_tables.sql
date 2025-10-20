-- Create return orders and line items tables
-- Idempotent migration to allow re-running safely

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'return_orders'
  ) THEN
    CREATE TABLE return_orders (
      return_id SERIAL PRIMARY KEY,
      return_number VARCHAR(255) NOT NULL UNIQUE,
      purchase_id INTEGER NOT NULL REFERENCES purchasehistory(purchase_id) ON DELETE CASCADE,
      status VARCHAR(50) NOT NULL DEFAULT 'Requested',
      requested_by VARCHAR(255),
      requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      returned_at TIMESTAMP WITH TIME ZONE,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'return_order_line_items'
  ) THEN
    CREATE TABLE return_order_line_items (
      line_item_id SERIAL PRIMARY KEY,
      return_id INTEGER NOT NULL REFERENCES return_orders(return_id) ON DELETE CASCADE,
      purchase_line_item_id INTEGER REFERENCES purchaselineitems(line_item_id) ON DELETE SET NULL,
      part_id INTEGER REFERENCES inventory(part_id) ON DELETE SET NULL,
      part_number VARCHAR(255) NOT NULL,
      part_description TEXT,
      quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
      unit VARCHAR(50),
      unit_cost NUMERIC(12,2),
      reason TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  END IF;

  -- Ensure indexes exist
  CREATE INDEX IF NOT EXISTS idx_return_orders_purchase_id ON return_orders(purchase_id);
  CREATE INDEX IF NOT EXISTS idx_return_orders_status ON return_orders(status);
  CREATE INDEX IF NOT EXISTS idx_return_order_line_items_return_id ON return_order_line_items(return_id);
  CREATE INDEX IF NOT EXISTS idx_return_order_line_items_purchase_line_item_id ON return_order_line_items(purchase_line_item_id);
END $$;

-- Update trigger for updated_at if not existing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_return_orders_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION set_return_orders_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER set_return_orders_updated_at
      BEFORE UPDATE ON return_orders
      FOR EACH ROW
      EXECUTE FUNCTION set_return_orders_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_return_order_line_items_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION set_return_order_line_items_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER set_return_order_line_items_updated_at
      BEFORE UPDATE ON return_order_line_items
      FOR EACH ROW
      EXECUTE FUNCTION set_return_order_line_items_updated_at();
  END IF;
END $$;

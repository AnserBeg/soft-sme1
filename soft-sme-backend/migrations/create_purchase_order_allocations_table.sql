-- Create purchase_order_allocations table to store allocation commitments
-- These are just plans/commitments until the purchase order is actually received and closed

CREATE TABLE IF NOT EXISTS purchase_order_allocations (
    allocation_id SERIAL PRIMARY KEY,
    purchase_id INTEGER NOT NULL REFERENCES purchasehistory(purchase_id) ON DELETE CASCADE,
    sales_order_id INTEGER NOT NULL REFERENCES salesorderhistory(sales_order_id) ON DELETE CASCADE,
    part_number VARCHAR(100) NOT NULL,
    part_description TEXT,
    allocate_qty DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure unique allocation per purchase order, sales order, and part
    UNIQUE(purchase_id, sales_order_id, part_number)
);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_purchase_order_allocations_purchase_id ON purchase_order_allocations(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_allocations_sales_order_id ON purchase_order_allocations(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_allocations_part_number ON purchase_order_allocations(part_number);

-- Add comment to explain the table's purpose
COMMENT ON TABLE purchase_order_allocations IS 'Stores allocation commitments for purchase orders before they are closed. These are just plans until the PO is received.'; 
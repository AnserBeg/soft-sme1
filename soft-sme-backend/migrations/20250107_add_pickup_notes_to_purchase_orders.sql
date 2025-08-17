-- Add pickup notes fields to purchase orders
-- This allows AI agents and users to specify pickup details for drivers

-- Add pickup notes to purchasehistory table
ALTER TABLE purchasehistory 
ADD COLUMN IF NOT EXISTS pickup_notes TEXT,
ADD COLUMN IF NOT EXISTS pickup_time VARCHAR(100),
ADD COLUMN IF NOT EXISTS pickup_location VARCHAR(255),
ADD COLUMN IF NOT EXISTS pickup_contact_person VARCHAR(100),
ADD COLUMN IF NOT EXISTS pickup_phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS pickup_instructions TEXT;

-- Add order placement tracking fields
ALTER TABLE purchasehistory 
ADD COLUMN IF NOT EXISTS order_placed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS order_placed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS order_placed_by INTEGER,
ADD COLUMN IF NOT EXISTS order_placed_method VARCHAR(50), -- 'manual', 'ai_call', 'ai_email'
ADD COLUMN IF NOT EXISTS vendor_confirmation_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'confirmed', 'partial', 'unavailable'
ADD COLUMN IF NOT EXISTS vendor_confirmation_notes TEXT,
ADD COLUMN IF NOT EXISTS vendor_confirmation_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS pricing_updated BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS pricing_updated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS pricing_updated_by INTEGER,
ADD COLUMN IF NOT EXISTS pricing_updated_method VARCHAR(50), -- 'manual', 'ai_call', 'ai_email'
ADD COLUMN IF NOT EXISTS quantity_adjusted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS quantity_adjusted_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS quantity_adjusted_by INTEGER,
ADD COLUMN IF NOT EXISTS quantity_adjusted_method VARCHAR(50), -- 'manual', 'ai_call', 'ai_email'
ADD COLUMN IF NOT EXISTS original_quantities JSONB, -- Store original quantities before adjustments
ADD COLUMN IF NOT EXISTS adjusted_quantities JSONB, -- Store adjusted quantities after vendor confirmation
ADD COLUMN IF NOT EXISTS vendor_pricing_notes TEXT; -- Notes about pricing structure (e.g., "sold by 10ft packs")

-- Add pickup notes to purchase_orders table (if it exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'purchase_orders') THEN
        ALTER TABLE purchase_orders 
        ADD COLUMN IF NOT EXISTS pickup_notes TEXT,
        ADD COLUMN IF NOT EXISTS pickup_time VARCHAR(100),
        ADD COLUMN IF NOT EXISTS pickup_location VARCHAR(255),
        ADD COLUMN IF NOT EXISTS pickup_contact_person VARCHAR(100),
        ADD COLUMN IF NOT EXISTS pickup_phone VARCHAR(50),
        ADD COLUMN IF NOT EXISTS pickup_instructions TEXT,
        ADD COLUMN IF NOT EXISTS order_placed BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS order_placed_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS order_placed_by INTEGER,
        ADD COLUMN IF NOT EXISTS order_placed_method VARCHAR(50),
        ADD COLUMN IF NOT EXISTS vendor_confirmation_status VARCHAR(50) DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS vendor_confirmation_notes TEXT,
        ADD COLUMN IF NOT EXISTS vendor_confirmation_date TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS pricing_updated BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS pricing_updated_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS pricing_updated_by INTEGER,
        ADD COLUMN IF NOT EXISTS pricing_updated_method VARCHAR(50),
        ADD COLUMN IF NOT EXISTS quantity_adjusted BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS quantity_adjusted_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS quantity_adjusted_by INTEGER,
        ADD COLUMN IF NOT EXISTS quantity_adjusted_method VARCHAR(50),
        ADD COLUMN IF NOT EXISTS original_quantities JSONB,
        ADD COLUMN IF NOT EXISTS adjusted_quantities JSONB,
        ADD COLUMN IF NOT EXISTS vendor_pricing_notes TEXT;
    END IF;
END $$;

-- Add pickup notes to purchaseorder table (if it exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'purchaseorder') THEN
        ALTER TABLE purchaseorder 
        ADD COLUMN IF NOT EXISTS pickup_notes TEXT,
        ADD COLUMN IF NOT EXISTS pickup_time VARCHAR(100),
        ADD COLUMN IF NOT EXISTS pickup_location VARCHAR(255),
        ADD COLUMN IF NOT EXISTS pickup_contact_person VARCHAR(100),
        ADD COLUMN IF NOT EXISTS pickup_phone VARCHAR(50),
        ADD COLUMN IF NOT EXISTS pickup_instructions TEXT,
        ADD COLUMN IF NOT EXISTS order_placed BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS order_placed_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS order_placed_by INTEGER,
        ADD COLUMN IF NOT EXISTS order_placed_method VARCHAR(50),
        ADD COLUMN IF NOT EXISTS vendor_confirmation_status VARCHAR(50) DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS vendor_confirmation_notes TEXT,
        ADD COLUMN IF NOT EXISTS vendor_confirmation_date TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS pricing_updated BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS pricing_updated_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS pricing_updated_by INTEGER,
        ADD COLUMN IF NOT EXISTS pricing_updated_method VARCHAR(50),
        ADD COLUMN IF NOT EXISTS quantity_adjusted BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS quantity_adjusted_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS quantity_adjusted_by INTEGER,
        ADD COLUMN IF NOT EXISTS quantity_adjusted_method VARCHAR(50),
        ADD COLUMN IF NOT EXISTS original_quantities JSONB,
        ADD COLUMN IF NOT EXISTS adjusted_quantities JSONB,
        ADD COLUMN IF NOT EXISTS vendor_pricing_notes TEXT;
    END IF;
END $$;

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_purchasehistory_pickup_time ON purchasehistory(pickup_time);
CREATE INDEX IF NOT EXISTS idx_purchasehistory_pickup_location ON purchasehistory(pickup_location);
CREATE INDEX IF NOT EXISTS idx_purchasehistory_order_placed ON purchasehistory(order_placed);
CREATE INDEX IF NOT EXISTS idx_purchasehistory_vendor_confirmation_status ON purchasehistory(vendor_confirmation_status);
CREATE INDEX IF NOT EXISTS idx_purchasehistory_pricing_updated ON purchasehistory(pricing_updated);
CREATE INDEX IF NOT EXISTS idx_purchasehistory_quantity_adjusted ON purchasehistory(quantity_adjusted);

-- Add comments for documentation
COMMENT ON COLUMN purchasehistory.pickup_notes IS 'General notes about pickup for drivers';
COMMENT ON COLUMN purchasehistory.pickup_time IS 'When to pick up the order (e.g., "tomorrow at 2 PM", "Friday morning")';
COMMENT ON COLUMN purchasehistory.pickup_location IS 'Where to pick up the order (address, building, etc.)';
COMMENT ON COLUMN purchasehistory.pickup_contact_person IS 'Name of person to contact at pickup location';
COMMENT ON COLUMN purchasehistory.pickup_phone IS 'Phone number for pickup contact person';
COMMENT ON COLUMN purchasehistory.pickup_instructions IS 'Special instructions for pickup (parking, loading dock, etc.)';

COMMENT ON COLUMN purchasehistory.order_placed IS 'Whether the order has been placed with the vendor';
COMMENT ON COLUMN purchasehistory.order_placed_at IS 'When the order was placed';
COMMENT ON COLUMN purchasehistory.order_placed_by IS 'User ID who placed the order';
COMMENT ON COLUMN purchasehistory.order_placed_method IS 'How the order was placed (manual, ai_call, ai_email)';
COMMENT ON COLUMN purchasehistory.vendor_confirmation_status IS 'Vendor confirmation status (pending, confirmed, partial, unavailable)';
COMMENT ON COLUMN purchasehistory.vendor_confirmation_notes IS 'Notes from vendor about order confirmation';
COMMENT ON COLUMN purchasehistory.vendor_confirmation_date IS 'When vendor confirmed the order';
COMMENT ON COLUMN purchasehistory.pricing_updated IS 'Whether pricing has been updated based on vendor confirmation';
COMMENT ON COLUMN purchasehistory.pricing_updated_at IS 'When pricing was updated';
COMMENT ON COLUMN purchasehistory.pricing_updated_by IS 'User ID who updated pricing';
COMMENT ON COLUMN purchasehistory.pricing_updated_method IS 'How pricing was updated (manual, ai_call, ai_email)';
COMMENT ON COLUMN purchasehistory.quantity_adjusted IS 'Whether quantities have been adjusted based on vendor confirmation';
COMMENT ON COLUMN purchasehistory.quantity_adjusted_at IS 'When quantities were adjusted';
COMMENT ON COLUMN purchasehistory.quantity_adjusted_by IS 'User ID who adjusted quantities';
COMMENT ON COLUMN purchasehistory.quantity_adjusted_method IS 'How quantities were adjusted (manual, ai_call, ai_email)';
COMMENT ON COLUMN purchasehistory.original_quantities IS 'Original quantities before vendor confirmation';
COMMENT ON COLUMN purchasehistory.adjusted_quantities IS 'Adjusted quantities after vendor confirmation';
COMMENT ON COLUMN purchasehistory.vendor_pricing_notes IS 'Notes about vendor pricing structure (e.g., "sold by 10ft packs")';

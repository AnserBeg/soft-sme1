-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS labour_line_items CASCADE;
DROP TABLE IF EXISTS time_entries CASCADE;
DROP TABLE IF EXISTS salesorderlineitems CASCADE;
DROP TABLE IF EXISTS salesorderhistory CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create salesorderhistory table
CREATE TABLE IF NOT EXISTS salesorderhistory (
  sales_order_id SERIAL PRIMARY KEY,
  sales_order_number VARCHAR(255) UNIQUE NOT NULL,
  customer_id INTEGER, -- Assuming customer_id might reference a customer table
  sales_date DATE,
  product_name VARCHAR(255),
  product_description TEXT,
  subtotal DECIMAL(10,2),
  total_gst_amount DECIMAL(10,2),
  total_amount DECIMAL(10,2),
  status VARCHAR(50) DEFAULT 'Open',
  estimated_cost DECIMAL(10,2),
  default_hourly_rate DECIMAL(10,2) DEFAULT 0.00,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create salesorderlineitems table with quantity_sold as DECIMAL
CREATE TABLE IF NOT EXISTS salesorderlineitems (
  sales_order_line_item_id SERIAL PRIMARY KEY,
  sales_order_id INTEGER NOT NULL REFERENCES salesorderhistory(sales_order_id),
  part_number VARCHAR(255) NOT NULL,
  part_description TEXT,
  quantity_sold DECIMAL(10,2) NOT NULL, -- Changed to DECIMAL
  unit VARCHAR(50),
  unit_price DECIMAL(10,2),
  line_amount DECIMAL(10,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create time_entries table
CREATE TABLE IF NOT EXISTS time_entries (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id),
  sales_order_id INTEGER NOT NULL REFERENCES salesorderhistory(sales_order_id),
  clock_in TIMESTAMP WITH TIME ZONE NOT NULL,
  clock_out TIMESTAMP WITH TIME ZONE,
  duration DECIMAL(10,2),
  unit_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create labour_line_items table
CREATE TABLE IF NOT EXISTS labour_line_items (
  id SERIAL PRIMARY KEY,
  sales_order_id INTEGER NOT NULL REFERENCES salesorderhistory(sales_order_id),
  date DATE NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'Labour',
  units VARCHAR(50) NOT NULL DEFAULT 'Hours',
  quantity DECIMAL(10,2) NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_time_entries_profile_id ON time_entries(profile_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_sales_order_id ON time_entries(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_clock_in ON time_entries(clock_in);
CREATE INDEX IF NOT EXISTS idx_labour_line_items_sales_order_id ON labour_line_items(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_labour_line_items_date ON labour_line_items(date);
CREATE INDEX IF NOT EXISTS idx_salesorderlineitems_sales_order_id ON salesorderlineitems(sales_order_id); 
const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function resetTables() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Drop existing tables in reverse order of dependencies
    await client.query(`
      DROP TABLE IF EXISTS user_sessions CASCADE;
      DROP TABLE IF EXISTS time_entries CASCADE;
      DROP TABLE IF EXISTS labour_line_items CASCADE;
      DROP TABLE IF EXISTS salesorderlineitems CASCADE;
      DROP TABLE IF EXISTS salesorderhistory CASCADE;
      DROP TABLE IF EXISTS marginschedule CASCADE;
      DROP TABLE IF EXISTS quotes CASCADE;
      DROP TABLE IF EXISTS purchaselineitems CASCADE;
      DROP TABLE IF EXISTS purchasehistory CASCADE;
      DROP TABLE IF EXISTS vendormaster CASCADE;
      DROP TABLE IF EXISTS customermaster CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS companies CASCADE;
      DROP TABLE IF EXISTS business_profile CASCADE;
      DROP TABLE IF EXISTS migrations CASCADE;
    `);

    // Create tables in correct order
    await client.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        max_concurrent_sessions INTEGER DEFAULT 5,
        session_timeout_hours INTEGER DEFAULT 24,
        refresh_token_days INTEGER DEFAULT 30,
        allow_multiple_devices BOOLEAN DEFAULT TRUE
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        role VARCHAR(50) NOT NULL DEFAULT 'employee',
        force_password_change BOOLEAN NOT NULL DEFAULT TRUE,
        access_role VARCHAR(50) DEFAULT 'Employee',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS business_profile (
        id SERIAL PRIMARY KEY,
        business_name VARCHAR(255) NOT NULL,
        street_address VARCHAR(255) NOT NULL,
        city VARCHAR(100) NOT NULL,
        province VARCHAR(100) NOT NULL,
        country VARCHAR(100) NOT NULL,
        telephone_number VARCHAR(50) NOT NULL,
        email VARCHAR(255) NOT NULL,
        business_number VARCHAR(50) NOT NULL,
        logo_url VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS vendormaster (
        vendor_id SERIAL PRIMARY KEY,
        vendor_name VARCHAR(255) NOT NULL,
        street_address VARCHAR(255),
        city VARCHAR(100),
        province VARCHAR(100),
        country VARCHAR(100),
        contact_person VARCHAR(255),
        telephone_number VARCHAR(50),
        email VARCHAR(255),
        website VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS customermaster (
        customer_id SERIAL PRIMARY KEY,
        customer_name VARCHAR(255) NOT NULL,
        street_address VARCHAR(255),
        city VARCHAR(100),
        province VARCHAR(100),
        country VARCHAR(100),
        contact_person VARCHAR(255),
        telephone_number VARCHAR(50),
        email VARCHAR(255),
        website VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
        product_id SERIAL PRIMARY KEY,
        product_name VARCHAR(255) NOT NULL,
        product_description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS marginschedule (
        margin_id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        cost_lower_bound NUMERIC(12, 2) NOT NULL,
        cost_upper_bound NUMERIC(12, 2) NOT NULL,
        margin_factor NUMERIC(6, 4) NOT NULL
      );

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

      CREATE TABLE IF NOT EXISTS quotes (
        quote_id SERIAL PRIMARY KEY,
        quote_number VARCHAR(255) UNIQUE NOT NULL,
        customer_id INTEGER,
        quote_date DATE,
        valid_until DATE,
        product_name VARCHAR(255),
        product_description TEXT,
        estimated_cost DECIMAL(12, 2),
        status VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        sequence_number VARCHAR(16)
      );

      CREATE TABLE IF NOT EXISTS salesorderhistory (
        sales_order_id SERIAL PRIMARY KEY,
        sales_order_number VARCHAR(255) UNIQUE NOT NULL,
        customer_id INTEGER,
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
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        quote_id INTEGER,
        sequence_number VARCHAR(16)
      );

      CREATE TABLE IF NOT EXISTS salesorderlineitems (
        sales_order_line_item_id SERIAL PRIMARY KEY,
        sales_order_id INTEGER NOT NULL REFERENCES salesorderhistory(sales_order_id),
        part_number VARCHAR(255) NOT NULL,
        part_description TEXT,
        quantity_sold DECIMAL(10,2) NOT NULL,
        unit VARCHAR(50),
        unit_price DECIMAL(10,2),
        line_amount DECIMAL(10,2),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS time_entries (
        id SERIAL PRIMARY KEY,
        profile_id INTEGER NOT NULL,
        sales_order_id INTEGER NOT NULL,
        clock_in TIMESTAMP WITH TIME ZONE NOT NULL,
        clock_out TIMESTAMP WITH TIME ZONE,
        duration DECIMAL(10,2),
        unit_price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS labour_line_items (
        id SERIAL PRIMARY KEY,
        sales_order_id INTEGER NOT NULL,
        date DATE NOT NULL,
        title VARCHAR(255) NOT NULL DEFAULT 'Labour',
        units VARCHAR(50) NOT NULL DEFAULT 'Hours',
        quantity DECIMAL(10,2) NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        total DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_token VARCHAR(255) NOT NULL UNIQUE,
        refresh_token VARCHAR(255) NOT NULL UNIQUE,
        device_info JSONB,
        ip_address INET,
        user_agent TEXT,
        location_info JSONB,
        is_active BOOLEAN DEFAULT TRUE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        refresh_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query('COMMIT');
    console.log('All tables reset and recreated successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error resetting tables:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

resetTables(); 
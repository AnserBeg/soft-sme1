const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function createTimeTrackingTables() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create profiles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add default_hourly_rate to salesorderhistory table if it doesn't exist
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'salesorderhistory' 
          AND column_name = 'default_hourly_rate'
        ) THEN
          ALTER TABLE salesorderhistory 
          ADD COLUMN default_hourly_rate DECIMAL(10,2) DEFAULT 0.00;
        END IF;
      END $$;
    `);

    // Create time_entries table
    await client.query(`
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
    `);

    // Create labour_line_items table
    await client.query(`
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
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_time_entries_profile_id ON time_entries(profile_id);
      CREATE INDEX IF NOT EXISTS idx_time_entries_sales_order_id ON time_entries(sales_order_id);
      CREATE INDEX IF NOT EXISTS idx_time_entries_clock_in ON time_entries(clock_in);
      CREATE INDEX IF NOT EXISTS idx_labour_line_items_sales_order_id ON labour_line_items(sales_order_id);
      CREATE INDEX IF NOT EXISTS idx_labour_line_items_date ON labour_line_items(date);
    `);

    await client.query('COMMIT');
    console.log('Time tracking tables created successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating time tracking tables:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the migration
createTimeTrackingTables()
  .then(() => {
    console.log('Migration completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  }); 
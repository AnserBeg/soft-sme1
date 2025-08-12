const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'soft_sme_db',
  password: process.env.DB_PASSWORD || '123',
  port: process.env.DB_PORT || 5432,
});

async function runSalesOrderPartsMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, 'migrations', 'create_sales_order_parts_to_order_table.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute the migration
    await client.query(migrationSQL);
    
    // Verify the table was created
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'sales_order_parts_to_order'
      );
    `);
    
    if (tableExists.rows[0].exists) {
      console.log('✅ sales_order_parts_to_order table created successfully');
    } else {
      throw new Error('Table was not created');
    }
    
    await client.query('COMMIT');
    console.log('Migration completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the migration
runSalesOrderPartsMigration()
  .then(() => {
    console.log('Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration script failed:', error);
    process.exit(1);
  }); 
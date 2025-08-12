const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'soft_sme_db',
  password: process.env.DB_PASSWORD || '123',
  port: parseInt(process.env.DB_PORT || '5432', 10),
});

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Running aggregated parts to order migration...');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, 'migrations', 'create_aggregated_parts_to_order_table.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute the migration
    await client.query(migrationSQL);
    
    console.log('Migration completed successfully!');
    
    // Verify the table was created
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'aggregated_parts_to_order'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ aggregated_parts_to_order table created successfully');
    } else {
      console.log('❌ Table creation failed');
    }
    
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration(); 
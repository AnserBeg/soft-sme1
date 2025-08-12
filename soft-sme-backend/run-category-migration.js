const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('Starting category migration...');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, 'migrations', 'add_category_to_inventory.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute the migration
    await client.query(migrationSQL);
    
    console.log('Category migration completed successfully!');
    
    // Verify the changes
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'inventory' AND column_name = 'category'
    `);
    
    if (result.rows.length > 0) {
      console.log('Category column verification:', result.rows[0]);
    }
    
    // Check if part_categories table exists
    const categoriesResult = await client.query(`
      SELECT COUNT(*) as count FROM part_categories
    `);
    
    console.log(`Part categories table has ${categoriesResult.rows[0].count} categories`);
    
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration()
  .then(() => {
    console.log('Migration script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });

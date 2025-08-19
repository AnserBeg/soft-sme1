const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function populatePartIds() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Populating part_id values in inventory_vendors table...\n');
    
    // Check current state
    const beforeCount = await client.query(`
      SELECT 
        COUNT(*) as total_vendor_mappings,
        COUNT(part_id) as mappings_with_part_id,
        COUNT(*) - COUNT(part_id) as mappings_without_part_id
      FROM inventory_vendors
    `);
    
    console.log('📊 Before update:');
    console.log(beforeCount.rows[0]);
    
    // Update part_id values
    const updateResult = await client.query(`
      UPDATE inventory_vendors 
      SET part_id = i.part_id
      FROM inventory i
      WHERE inventory_vendors.part_number = i.part_number
      AND inventory_vendors.part_id IS NULL
    `);
    
    console.log(`\n✅ Updated ${updateResult.rowCount} records`);
    
    // Check after state
    const afterCount = await client.query(`
      SELECT 
        COUNT(*) as total_vendor_mappings,
        COUNT(part_id) as mappings_with_part_id,
        COUNT(*) - COUNT(part_id) as mappings_without_part_id
      FROM inventory_vendors
    `);
    
    console.log('\n📊 After update:');
    console.log(afterCount.rows[0]);
    
    // Show a sample record
    const sample = await client.query('SELECT * FROM inventory_vendors LIMIT 1');
    if (sample.rows.length > 0) {
      console.log('\n📋 Sample record after update:');
      console.log(sample.rows[0]);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

populatePartIds();

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function testPartNumberUpdate() {
  const client = await pool.connect();
  
  try {
    console.log('🧪 Testing part number update function...');
    
    // First, let's check what vendors exist for the part
    const vendorsBefore = await client.query(`
      SELECT iv.*, vm.vendor_name 
      FROM inventory_vendors iv 
      JOIN vendormaster vm ON iv.vendor_id = vm.vendor_id 
      WHERE iv.part_number = '6X2X125'
    `);
    
    console.log('📋 Vendors before update:', vendorsBefore.rows);
    
    // Test the function
    const result = await client.query('SELECT update_part_number($1, $2)', ['6X2X125', '6X2X.125']);
    
    console.log('✅ Function result:', result.rows[0]);
    
    // Check vendors after update
    const vendorsAfter = await client.query(`
      SELECT iv.*, vm.vendor_name 
      FROM inventory_vendors iv 
      JOIN vendormaster vm ON iv.vendor_id = vm.vendor_id 
      WHERE iv.part_number = '6X2X.125'
    `);
    
    console.log('📋 Vendors after update:', vendorsAfter.rows);
    
    // Revert the change
    const revertResult = await client.query('SELECT update_part_number($1, $2)', ['6X2X.125', '6X2X125']);
    console.log('🔄 Revert result:', revertResult.rows[0]);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

testPartNumberUpdate();

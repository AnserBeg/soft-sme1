const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function testInventoryResponse() {
  const client = await pool.connect();

  try {
    console.log('🔍 Testing inventory API response...\n');

    // Test the exact query that the API uses
    const query = 'SELECT part_id, part_number, part_description, unit, last_unit_cost, quantity_on_hand, reorder_point, part_type, category, created_at, updated_at FROM inventory WHERE part_type = $1 ORDER BY part_number ASC';
    
    const result = await client.query(query, ['stock']);
    
    console.log(`📊 Found ${result.rows.length} stock items`);
    
    if (result.rows.length > 0) {
      console.log('\n📋 Sample inventory item:');
      console.log(JSON.stringify(result.rows[0], null, 2));
      
      // Check if part_id exists
      if (result.rows[0].part_id !== undefined) {
        console.log('\n✅ part_id is present in the response');
      } else {
        console.log('\n❌ part_id is missing from the response');
      }
    }

    // Also test the specific part that's causing issues
    const specificPart = await client.query(
      'SELECT part_id, part_number FROM inventory WHERE part_number = $1',
      ['1X1X125']
    );
    
    if (specificPart.rows.length > 0) {
      console.log('\n🎯 Found the specific part:');
      console.log(JSON.stringify(specificPart.rows[0], null, 2));
    } else {
      console.log('\n❌ Part 1X1X125 not found in database');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

testInventoryResponse();

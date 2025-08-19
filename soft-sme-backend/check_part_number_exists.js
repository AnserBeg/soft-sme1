const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function checkPartNumberExists() {
  const client = await pool.connect();
  
  try {
    const partNumber = '1X1X.125';
    
    console.log(`🔍 Checking if part number "${partNumber}" exists...\n`);
    
    // Check if the part exists
    const partQuery = await client.query(
      'SELECT part_id, part_number, part_description FROM inventory WHERE part_number = $1',
      [partNumber]
    );
    
    if (partQuery.rows.length === 0) {
      console.log(`❌ Part number "${partNumber}" does not exist in inventory table`);
      
      // Show some existing part numbers
      const existingParts = await client.query(
        'SELECT part_id, part_number, part_description FROM inventory ORDER BY part_number LIMIT 10'
      );
      
      console.log('\n📋 Sample existing part numbers:');
      existingParts.rows.forEach(part => {
        console.log(`  - ${part.part_number} (ID: ${part.part_id}) - ${part.part_description || 'No description'}`);
      });
      
      // Check if there are any similar part numbers
      const similarParts = await client.query(
        'SELECT part_id, part_number, part_description FROM inventory WHERE part_number LIKE $1 ORDER BY part_number',
        [`%${partNumber.replace(/[^A-Z0-9]/g, '')}%`]
      );
      
      if (similarParts.rows.length > 0) {
        console.log('\n🔍 Similar part numbers found:');
        similarParts.rows.forEach(part => {
          console.log(`  - ${part.part_number} (ID: ${part.part_id}) - ${part.part_description || 'No description'}`);
        });
      }
      
    } else {
      console.log(`✅ Part number "${partNumber}" exists:`);
      console.log(partQuery.rows[0]);
      
      // Check if it has vendor mappings
      const vendorQuery = await client.query(
        'SELECT COUNT(*) as vendor_count FROM inventory_vendors WHERE part_number = $1',
        [partNumber]
      );
      
      console.log(`\n📊 Vendor mappings: ${vendorQuery.rows[0].vendor_count}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkPartNumberExists();

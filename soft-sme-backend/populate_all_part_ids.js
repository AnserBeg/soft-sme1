const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function populateAllPartIds() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Populating part_id values in all part-related tables...\n');
    
    const tablesToUpdate = [
      'salesorderlineitems',
      'purchaselineitems', 
      'sales_order_parts_to_order',
      'aggregated_parts_to_order',
      'inventory_vendors'
    ];
    
    for (const tableName of tablesToUpdate) {
      console.log(`\n📊 Processing ${tableName}...`);
      
      // Check current state
      const beforeCount = await client.query(`
        SELECT
          COUNT(*) as total_records,
          COUNT(part_id) as records_with_part_id,
          COUNT(*) - COUNT(part_id) as records_without_part_id
        FROM ${tableName}
      `);
      
      console.log('  Before update:', beforeCount.rows[0]);
      
      if (beforeCount.rows[0].records_without_part_id > 0) {
        // Update part_id values
        const updateResult = await client.query(`
          UPDATE ${tableName}
          SET part_id = i.part_id
          FROM inventory i
          WHERE ${tableName}.part_number = i.part_number
          AND ${tableName}.part_id IS NULL
        `);
        
        console.log(`  ✅ Updated ${updateResult.rowCount} records`);
        
        // Check after state
        const afterCount = await client.query(`
          SELECT
            COUNT(*) as total_records,
            COUNT(part_id) as records_with_part_id,
            COUNT(*) - COUNT(part_id) as records_without_part_id
          FROM ${tableName}
        `);
        
        console.log('  After update:', afterCount.rows[0]);
        
        // Show a sample record
        const sample = await client.query(`SELECT part_number, part_id FROM ${tableName} WHERE part_id IS NOT NULL LIMIT 1`);
        if (sample.rows.length > 0) {
          console.log(`  📋 Sample record: ${JSON.stringify(sample.rows[0])}`);
        }
      } else {
        console.log('  ✅ All records already have part_id values');
      }
    }
    
    console.log('\n🎉 Part ID population complete!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

populateAllPartIds();

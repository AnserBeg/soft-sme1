const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkInventoryData() {
  try {
    console.log('Checking inventory data...');
    
    // Check a few inventory items
    const result = await pool.query(`
      SELECT 
        part_number, 
        part_description, 
        last_unit_cost, 
        quantity_on_hand,
        part_type,
        created_at,
        updated_at
      FROM inventory 
      WHERE part_type = 'stock' 
      ORDER BY part_number 
      LIMIT 5
    `);
    
    console.log(`Found ${result.rows.length} inventory items:`);
    result.rows.forEach((row, index) => {
      console.log(`\nItem ${index + 1}:`);
      console.log(`  Part Number: ${row.part_number}`);
      console.log(`  Description: ${row.part_description}`);
      console.log(`  Last Unit Cost: ${row.last_unit_cost} (type: ${typeof row.last_unit_cost})`);
      console.log(`  Quantity on Hand: ${row.quantity_on_hand} (type: ${typeof row.quantity_on_hand})`);
      console.log(`  Part Type: ${row.part_type}`);
      console.log(`  Created: ${row.created_at}`);
      console.log(`  Updated: ${row.updated_at}`);
    });
    
    // Check if there are any items with non-zero last_unit_cost
    const nonZeroCostResult = await pool.query(`
      SELECT COUNT(*) as count, 
             COUNT(CASE WHEN last_unit_cost > 0 THEN 1 END) as non_zero_count,
             COUNT(CASE WHEN last_unit_cost = 0 THEN 1 END) as zero_count,
             COUNT(CASE WHEN last_unit_cost IS NULL THEN 1 END) as null_count
      FROM inventory 
      WHERE part_type = 'stock'
    `);
    
    console.log('\nCost Statistics:');
    console.log(`  Total items: ${nonZeroCostResult.rows[0].count}`);
    console.log(`  Non-zero cost: ${nonZeroCostResult.rows[0].non_zero_count}`);
    console.log(`  Zero cost: ${nonZeroCostResult.rows[0].zero_count}`);
    console.log(`  Null cost: ${nonZeroCostResult.rows[0].null_count}`);
    
  } catch (error) {
    console.error('Error checking inventory data:', error);
  } finally {
    await pool.end();
  }
}

checkInventoryData(); 
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_DATABASE || 'soft_sme_db',
  password: process.env.DB_PASSWORD || '123',
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function cleanupInventorySpaces() {
  const client = await pool.connect();
  
  try {
    console.log('Starting inventory space cleanup...');
    
    // Get all inventory items
    const result = await client.query('SELECT * FROM inventory');
    const items = result.rows;
    
    console.log(`Found ${items.length} inventory items to process`);
    
    let updatedCount = 0;
    let errorCount = 0;
    
    for (const item of items) {
      try {
        // Check if any fields need trimming
        const needsUpdate = 
          item.part_number !== item.part_number.trim() ||
          item.part_description !== item.part_description.trim() ||
          item.unit !== item.unit.trim() ||
          item.part_type !== item.part_type.trim();
        
        if (needsUpdate) {
          // Update with trimmed values
          await client.query(`
            UPDATE inventory 
            SET 
              part_number = $1,
              part_description = $2,
              unit = $3,
              part_type = $4,
              updated_at = CURRENT_TIMESTAMP
            WHERE part_number = $5
          `, [
            item.part_number.trim().toUpperCase(),
            item.part_description.trim(),
            item.unit.trim(),
            item.part_type.trim(),
            item.part_number // Use original for WHERE clause
          ]);
          
          updatedCount++;
          console.log(`Updated item: ${item.part_number} -> "${item.part_number.trim().toUpperCase()}"`);
        }
      } catch (error) {
        errorCount++;
        console.error(`Error updating item ${item.part_number}:`, error.message);
      }
    }
    
    console.log(`\nCleanup completed:`);
    console.log(`- Total items processed: ${items.length}`);
    console.log(`- Items updated: ${updatedCount}`);
    console.log(`- Errors: ${errorCount}`);
    
  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the cleanup
cleanupInventorySpaces().catch(console.error); 
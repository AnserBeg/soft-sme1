const { Pool } = require('pg');
require('dotenv').config();

// Database connection - using individual environment variables like the main app
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_DATABASE || 'soft_sme_db',
  password: process.env.DB_PASSWORD || '123',
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function fixAllSequences() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Starting comprehensive sequence fix for all tables...\n');
    
    // Define tables and their sequence names
    const tablesToFix = [
      { table: 'customermaster', idColumn: 'customer_id', sequence: 'customermaster_customer_id_seq' },
      { table: 'products', idColumn: 'product_id', sequence: 'products_product_id_seq' },
      { table: 'salesorderhistory', idColumn: 'sales_order_id', sequence: 'salesorderhistory_sales_order_id_seq' },
      { table: 'purchaseorderhistory', idColumn: 'purchase_order_id', sequence: 'purchaseorderhistory_purchase_order_id_seq' },
      { table: 'quotes', idColumn: 'quote_id', sequence: 'quotes_quote_id_seq' },
      { table: 'inventory', idColumn: 'inventory_id', sequence: 'inventory_inventory_id_seq' },
      { table: 'supplies', idColumn: 'supply_id', sequence: 'supplies_supply_id_seq' }
    ];
    
    for (const tableInfo of tablesToFix) {
      console.log(`📊 Checking ${tableInfo.table} table...`);
      
      try {
        // Get the current maximum ID
        const maxIdResult = await client.query(`SELECT MAX(${tableInfo.idColumn}) as max_id FROM ${tableInfo.table}`);
        const maxId = parseInt(maxIdResult.rows[0].max_id) || 0;
        
        // Get the current sequence value
        const sequenceResult = await client.query(`SELECT last_value FROM ${tableInfo.sequence}`);
        const currentSequence = parseInt(sequenceResult.rows[0].last_value);
        
        console.log(`   Current max ID: ${maxId}, Sequence: ${currentSequence}`);
        
        if (currentSequence <= maxId) {
          console.log(`   ⚠️  Sequence out of sync! Resetting...`);
          
          // Reset the sequence to the next available ID
          const nextId = maxId + 1;
          await client.query(`ALTER SEQUENCE ${tableInfo.sequence} RESTART WITH ${nextId}`);
          
          // Verify the fix
          const newSequenceResult = await client.query(`SELECT last_value FROM ${tableInfo.sequence}`);
          const newSequence = parseInt(newSequenceResult.rows[0].last_value);
          
          console.log(`   ✅ Sequence reset to: ${newSequence}`);
          console.log(`   ✅ Next ${tableInfo.idColumn} will be: ${newSequence + 1}`);
        } else {
          console.log(`   ✅ Sequence is in sync`);
        }
        
        // Check for duplicate IDs
        const duplicateResult = await client.query(`
          SELECT ${tableInfo.idColumn}, COUNT(*) as count 
          FROM ${tableInfo.table} 
          GROUP BY ${tableInfo.idColumn} 
          HAVING COUNT(*) > 1
        `);
        
        if (duplicateResult.rows.length > 0) {
          console.log(`   ⚠️  Found duplicate IDs:`);
          duplicateResult.rows.forEach(row => {
            console.log(`      - ID ${row[tableInfo.idColumn]}: ${row.count} occurrences`);
          });
        } else {
          console.log(`   ✅ No duplicate IDs found`);
        }
        
      } catch (error) {
        console.log(`   ❌ Error checking ${tableInfo.table}: ${error.message}`);
      }
      
      console.log(''); // Empty line for readability
    }
    
    console.log('🎉 All sequence fixes completed!');
    console.log('\n📋 Summary of what was fixed:');
    console.log('- Customer ID sequences');
    console.log('- Product ID sequences');
    console.log('- Sales Order ID sequences');
    console.log('- Purchase Order ID sequences');
    console.log('- Quote ID sequences');
    console.log('- Inventory ID sequences');
    console.log('- Supply ID sequences');
    
  } catch (error) {
    console.error('❌ Error in sequence fix process:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

fixAllSequences();


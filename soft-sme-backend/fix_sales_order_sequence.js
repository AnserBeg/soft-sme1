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

async function fixSalesOrderSequence() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Starting to fix sales order sequence...');
    
    // Get the current maximum sales_order_id
    const maxIdResult = await client.query('SELECT MAX(sales_order_id) as max_id FROM salesorderhistory');
    const maxId = parseInt(maxIdResult.rows[0].max_id) || 0;
    
    console.log(`📊 Current maximum sales_order_id: ${maxId}`);
    
    // Get the current sequence value
    const sequenceResult = await client.query("SELECT last_value FROM salesorderhistory_sales_order_id_seq");
    const currentSequence = parseInt(sequenceResult.rows[0].last_value);
    
    console.log(`📊 Current sequence value: ${currentSequence}`);
    
    if (currentSequence <= maxId) {
      console.log('⚠️  Sequence is out of sync! Resetting...');
      
      // Reset the sequence to the next available ID
      const nextId = maxId + 1;
      await client.query(`ALTER SEQUENCE salesorderhistory_sales_order_id_seq RESTART WITH ${nextId}`);
      
      // Verify the fix
      const newSequenceResult = await client.query("SELECT last_value FROM salesorderhistory_sales_order_id_seq");
      const newSequence = parseInt(newSequenceResult.rows[0].last_value);
      
      console.log(`✅ Sequence reset to: ${newSequence}`);
      console.log(`✅ Next sales order will get ID: ${newSequence + 1}`);
    } else {
      console.log('✅ Sequence is already in sync');
    }
    
    // Check for any duplicate sales order IDs
    const duplicateResult = await client.query(`
      SELECT sales_order_id, COUNT(*) as count 
      FROM salesorderhistory 
      GROUP BY sales_order_id 
      HAVING COUNT(*) > 1
    `);
    
    if (duplicateResult.rows.length > 0) {
      console.log('⚠️  Found duplicate sales order IDs:');
      duplicateResult.rows.forEach(row => {
        console.log(`   - ID ${row.sales_order_id}: ${row.count} occurrences`);
      });
    } else {
      console.log('✅ No duplicate sales order IDs found');
    }
    
    console.log('🎉 Sales order sequence fix completed!');
    
  } catch (error) {
    console.error('❌ Error fixing sales order sequence:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

fixSalesOrderSequence();


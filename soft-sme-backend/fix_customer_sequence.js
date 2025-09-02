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

async function fixCustomerSequence() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Starting to fix customer sequence...');
    
    // Get the current maximum customer_id
    const maxIdResult = await client.query('SELECT MAX(customer_id) as max_id FROM customermaster');
    const maxId = parseInt(maxIdResult.rows[0].max_id) || 0;
    
    console.log(`📊 Current maximum customer_id: ${maxId}`);
    
    // Get the current sequence value
    const sequenceResult = await client.query("SELECT last_value FROM customermaster_customer_id_seq");
    const currentSequence = parseInt(sequenceResult.rows[0].last_value) || 0;
    
    console.log(`📊 Current sequence value: ${currentSequence}`);
    
    if (currentSequence <= maxId) {
      // Reset sequence to the next value after the maximum ID
      const nextSequenceValue = maxId + 1;
      await client.query(`SELECT setval('customermaster_customer_id_seq', $1, true)`, [nextSequenceValue]);
      
      console.log(`✅ Sequence reset to: ${nextSequenceValue}`);
    } else {
      console.log(`✅ Sequence is already correct (${currentSequence} > ${maxId})`);
    }
    
    // Verify the fix
    const newSequenceResult = await client.query("SELECT last_value FROM customermaster_customer_id_seq");
    const newSequence = parseInt(newSequenceResult.rows[0].last_value) || 0;
    
    console.log(`🔍 New sequence value: ${newSequence}`);
    console.log(`🎉 Customer sequence fix completed!`);
    
    // Also check for any duplicate customer names that might be causing issues
    console.log('\n🔍 Checking for potential duplicate customer names...');
    const duplicateNamesResult = await client.query(`
      SELECT customer_name, COUNT(*) as count
      FROM customermaster 
      GROUP BY customer_name 
      HAVING COUNT(*) > 1
    `);
    
    if (duplicateNamesResult.rows.length > 0) {
      console.log('⚠️  Found duplicate customer names:');
      duplicateNamesResult.rows.forEach(row => {
        console.log(`   - "${row.customer_name}": ${row.count} occurrences`);
      });
    } else {
      console.log('✅ No duplicate customer names found');
    }
    
  } catch (error) {
    console.error('❌ Error fixing sequence:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the fix
fixCustomerSequence()
  .then(() => {
    console.log('🎯 Customer sequence fix process completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Customer sequence fix failed:', error);
    process.exit(1);
  });

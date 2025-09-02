import { Pool } from 'pg';
import { config } from 'dotenv';

// Load environment variables
config();

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function fixPurchaseOrderSequence() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Starting to fix purchase order sequence...');
    
    // Get the current maximum purchase_id
    const maxIdResult = await client.query('SELECT MAX(purchase_id) as max_id FROM purchasehistory');
    const maxId = parseInt(maxIdResult.rows[0].max_id) || 0;
    
    console.log(`📊 Current maximum purchase_id: ${maxId}`);
    
    // Get the current sequence value
    const sequenceResult = await client.query("SELECT last_value FROM purchasehistory_purchase_id_seq");
    const currentSequence = parseInt(sequenceResult.rows[0].last_value) || 0;
    
    console.log(`📊 Current sequence value: ${currentSequence}`);
    
    if (currentSequence <= maxId) {
      // Reset sequence to the next value after the maximum ID
      const nextSequenceValue = maxId + 1;
      await client.query(`SELECT setval('purchasehistory_purchase_id_seq', $1, true)`, [nextSequenceValue]);
      
      console.log(`✅ Sequence reset to: ${nextSequenceValue}`);
    } else {
      console.log(`✅ Sequence is already correct (${currentSequence} > ${maxId})`);
    }
    
    // Verify the fix
    const newSequenceResult = await client.query("SELECT last_value FROM purchasehistory_purchase_id_seq");
    const newSequence = parseInt(newSequenceResult.rows[0].last_value) || 0;
    
    console.log(`🔍 New sequence value: ${newSequence}`);
    console.log(`🎉 Sequence fix completed!`);
    
  } catch (error) {
    console.error('❌ Error fixing sequence:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the fix
fixPurchaseOrderSequence()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });

export { fixPurchaseOrderSequence };

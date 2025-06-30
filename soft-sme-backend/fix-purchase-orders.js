const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function fixPurchaseOrders() {
  const client = await pool.connect();
  try {
    console.log('Starting purchase order number fix...\n');
    
    await client.query('BEGIN');
    
    // Get all purchase orders for 2025
    const result = await client.query(`
      SELECT purchase_id, purchase_number, created_at 
      FROM purchasehistory 
      WHERE purchase_number LIKE 'PO-2025-%'
      ORDER BY purchase_number
    `);
    
    console.log(`Found ${result.rows.length} purchase orders for 2025\n`);
    
    if (result.rows.length === 0) {
      console.log('No purchase orders to fix.');
      await client.query('COMMIT');
      return;
    }
    
    // Check for duplicates
    const duplicateResult = await client.query(`
      SELECT purchase_number, COUNT(*) as count
      FROM purchasehistory 
      WHERE purchase_number LIKE 'PO-2025-%'
      GROUP BY purchase_number 
      HAVING COUNT(*) > 1
    `);
    
    if (duplicateResult.rows.length > 0) {
      console.log('⚠️  Found duplicate purchase order numbers:');
      duplicateResult.rows.forEach(row => {
        console.log(`   ${row.purchase_number} appears ${row.count} times`);
      });
      console.log('\nFixing duplicates...\n');
      
      // Fix duplicates by updating them with new numbers
      for (const duplicate of duplicateResult.rows) {
        const duplicates = await client.query(
          'SELECT purchase_id FROM purchasehistory WHERE purchase_number = $1 ORDER BY created_at',
          [duplicate.purchase_number]
        );
        
        // Keep the first one, update the rest
        for (let i = 1; i < duplicates.rows.length; i++) {
          const timestamp = Date.now() + i;
          const newNumber = `PO-2025-${(timestamp % 100000).toString().padStart(5, '0')}`;
          
          await client.query(
            'UPDATE purchasehistory SET purchase_number = $1 WHERE purchase_id = $2',
            [newNumber, duplicates.rows[i].purchase_id]
          );
          
          console.log(`   Fixed duplicate: ${duplicate.purchase_number} -> ${newNumber}`);
        }
      }
    }
    
    // Check for gaps and fix them
    const allNumbers = result.rows.map(row => 
      parseInt(row.purchase_number.substring(8))
    ).sort((a, b) => a - b);
    
    console.log('\nChecking for gaps in sequence...');
    let expectedNumber = 1;
    let gapsFound = false;
    
    for (const num of allNumbers) {
      if (num !== expectedNumber) {
        console.log(`   Gap found: expected ${expectedNumber}, found ${num}`);
        gapsFound = true;
      }
      expectedNumber = num + 1;
    }
    
    if (!gapsFound) {
      console.log('   No gaps found in sequence.');
    }
    
    await client.query('COMMIT');
    console.log('\n✅ Purchase order number fix completed successfully!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error fixing purchase orders:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

fixPurchaseOrders(); 
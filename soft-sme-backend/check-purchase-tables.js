const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function checkPurchaseOrders() {
  try {
    console.log('Checking purchase order numbers in database...\n');
    
    // Get all purchase orders
    const result = await pool.query(`
      SELECT purchase_id, purchase_number, created_at 
      FROM purchasehistory 
      ORDER BY purchase_number
    `);
    
    console.log(`Total purchase orders found: ${result.rows.length}\n`);
    
    if (result.rows.length > 0) {
      console.log('Existing purchase order numbers:');
      result.rows.forEach((row, index) => {
        console.log(`${index + 1}. ${row.purchase_number} (ID: ${row.purchase_id}, Created: ${row.created_at})`);
      });
    }
    
    // Check for duplicates
    const duplicateResult = await pool.query(`
      SELECT purchase_number, COUNT(*) as count
      FROM purchasehistory 
      GROUP BY purchase_number 
      HAVING COUNT(*) > 1
    `);
    
    if (duplicateResult.rows.length > 0) {
      console.log('\n⚠️  DUPLICATE PURCHASE ORDER NUMBERS FOUND:');
      duplicateResult.rows.forEach(row => {
        console.log(`   ${row.purchase_number} appears ${row.count} times`);
      });
    } else {
      console.log('\n✅ No duplicate purchase order numbers found');
    }
    
    // Check the latest PO number for 2025
    const latestResult = await pool.query(`
      SELECT MAX(CAST(SUBSTRING(purchase_number, 8, 5) AS INTEGER)) as max_seq
      FROM purchasehistory 
      WHERE purchase_number LIKE 'PO-2025-%'
    `);
    
    const maxSeq = latestResult.rows[0].max_seq || 0;
    console.log(`\nLatest sequence number for 2025: ${maxSeq}`);
    console.log(`Next PO number would be: PO-2025-${(maxSeq + 1).toString().padStart(5, '0')}`);
    
  } catch (error) {
    console.error('Error checking purchase orders:', error);
  } finally {
    await pool.end();
  }
}

checkPurchaseOrders(); 
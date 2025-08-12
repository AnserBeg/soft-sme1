const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/soft_sme_db'
});

async function checkPurchaseOrderIssue() {
  try {
    console.log('🔍 Checking Purchase Order Issue...\n');

    // Check if purchasehistory table exists and its structure
    console.log('1. Checking purchasehistory table structure:');
    const tableStructureResult = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'purchasehistory' 
      ORDER BY ordinal_position
    `);
    console.log(`   Found ${tableStructureResult.rows.length} columns in purchasehistory table:`);
    tableStructureResult.rows.forEach(col => {
      console.log(`   - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });

    // Check if QBO export columns exist
    console.log('\n2. Checking for QBO export columns:');
    const qboColumns = tableStructureResult.rows.filter(col => 
      col.column_name.includes('qbo') || col.column_name.includes('export')
    );
    if (qboColumns.length > 0) {
      qboColumns.forEach(col => {
        console.log(`   ✅ Found: ${col.column_name}`);
      });
    } else {
      console.log('   ❌ No QBO export columns found');
    }

    // Check if purchase order ID 3 exists
    console.log('\n3. Checking if purchase order ID 3 exists:');
    const poResult = await pool.query('SELECT purchase_id, purchase_number, status FROM purchasehistory WHERE purchase_id = $1', [3]);
    if (poResult.rows.length > 0) {
      console.log(`   ✅ Found purchase order:`, poResult.rows[0]);
    } else {
      console.log('   ❌ Purchase order ID 3 not found');
    }

    // Check if purchaselineitems table exists
    console.log('\n4. Checking purchaselineitems table:');
    const lineItemsStructureResult = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'purchaselineitems' 
      ORDER BY ordinal_position
    `);
    console.log(`   Found ${lineItemsStructureResult.rows.length} columns in purchaselineitems table`);

    // Check if there are any purchase orders at all
    console.log('\n5. Checking total purchase orders:');
    const totalPOResult = await pool.query('SELECT COUNT(*) as total FROM purchasehistory');
    console.log(`   Total purchase orders: ${totalPOResult.rows[0].total}`);

    // Check recent purchase orders
    console.log('\n6. Recent purchase orders:');
    const recentPOResult = await pool.query('SELECT purchase_id, purchase_number, status FROM purchasehistory ORDER BY purchase_id DESC LIMIT 5');
    recentPOResult.rows.forEach(po => {
      console.log(`   - ID: ${po.purchase_id}, Number: ${po.purchase_number}, Status: ${po.status}`);
    });

    console.log('\n✅ Purchase order check completed!');

  } catch (error) {
    console.error('❌ Error checking purchase order:', error);
  } finally {
    await pool.end();
  }
}

checkPurchaseOrderIssue(); 
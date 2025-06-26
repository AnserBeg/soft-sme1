const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function checkPurchaseTables() {
  const client = await pool.connect();
  try {
    // Check if purchasehistory table exists
    const purchaseHistoryExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'purchasehistory'
      );
    `);
    console.log('purchasehistory table exists:', purchaseHistoryExists.rows[0].exists);

    if (purchaseHistoryExists.rows[0].exists) {
      // Get table structure
      const tableStructure = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'purchasehistory'
        ORDER BY ordinal_position;
      `);
      console.log('purchasehistory table structure:', tableStructure.rows);

      // Get sample data
      const sampleData = await client.query(`
        SELECT * FROM "purchasehistory" LIMIT 5;
      `);
      console.log('Sample purchasehistory data:', sampleData.rows);
    }

    // Check if purchaselineitems table exists
    const lineItemsExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'purchaselineitems'
      );
    `);
    console.log('purchaselineitems table exists:', lineItemsExists.rows[0].exists);

    if (lineItemsExists.rows[0].exists) {
      // Get table structure
      const lineItemsStructure = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'purchaselineitems'
        ORDER BY ordinal_position;
      `);
      console.log('purchaselineitems table structure:', lineItemsStructure.rows);

      // Get sample data
      const sampleLineItems = await client.query(`
        SELECT * FROM purchaselineitems LIMIT 5;
      `);
      console.log('Sample purchaselineitems data:', sampleLineItems.rows);
    }

    // Check if vendormaster table exists
    const vendorMasterExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'vendormaster'
      );
    `);
    console.log('vendormaster table exists:', vendorMasterExists.rows[0].exists);

    if (vendorMasterExists.rows[0].exists) {
      // Get sample vendor data
      const sampleVendors = await client.query(`
        SELECT * FROM "vendormaster" LIMIT 5;
      `);
      console.log('Sample vendormaster data:', sampleVendors.rows);
    }

  } catch (err) {
    console.error('Error checking purchase tables:', err);
  } finally {
    client.release();
    pool.end();
  }
}

checkPurchaseTables(); 
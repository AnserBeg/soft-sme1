const { Pool } = require('pg');
require('dotenv').config();
const path = require('path');

// Load environment variables from the correct path
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_DATABASE || 'soft_sme_db',
  password: process.env.DB_PASSWORD || '123',
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function checkPartsToOrderStatus() {
  try {
    console.log('=== CHECKING PARTS TO ORDER STATUS ===\n');
    
    // Check if there are any sales orders at all
    console.log('1. All Sales Orders:');
    const allSalesOrdersResult = await pool.query(`
      SELECT sales_order_id, sales_order_number, status, created_at
      FROM salesorderhistory
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    if (allSalesOrdersResult.rows.length === 0) {
      console.log('   No sales orders found in the database');
    } else {
      allSalesOrdersResult.rows.forEach(row => {
        console.log(`   SO: ${row.sales_order_number} (${row.status}) - Created: ${row.created_at}`);
      });
    }
    
    // Check if there are any purchase orders at all
    console.log('\n2. All Purchase Orders:');
    const allPurchaseOrdersResult = await pool.query(`
      SELECT purchase_id, purchase_number, status, created_at
      FROM purchasehistory
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    if (allPurchaseOrdersResult.rows.length === 0) {
      console.log('   No purchase orders found in the database');
    } else {
      allPurchaseOrdersResult.rows.forEach(row => {
        console.log(`   PO: ${row.purchase_number} (${row.status}) - Created: ${row.created_at}`);
      });
    }
    
    // Check if there are any line items at all
    console.log('\n3. All Sales Order Line Items:');
    const allLineItemsResult = await pool.query(`
      SELECT soli.*, soh.sales_order_number, soh.status as so_status
      FROM salesorderlineitems soli
      JOIN salesorderhistory soh ON soli.sales_order_id = soh.sales_order_id
      ORDER BY soli.created_at DESC
      LIMIT 10
    `);
    
    if (allLineItemsResult.rows.length === 0) {
      console.log('   No sales order line items found in the database');
    } else {
      allLineItemsResult.rows.forEach(row => {
        console.log(`   SO: ${row.sales_order_number} (${row.so_status}), Part: ${row.part_number}, Qty Sold: ${row.quantity_sold}`);
      });
    }
    
    // Check if there are any inventory items at all
    console.log('\n4. Sample Inventory Items:');
    const sampleInventoryResult = await pool.query(`
      SELECT part_number, quantity_on_hand, last_unit_cost
      FROM inventory
      ORDER BY part_number
      LIMIT 10
    `);
    
    if (sampleInventoryResult.rows.length === 0) {
      console.log('   No inventory items found in the database');
    } else {
      sampleInventoryResult.rows.forEach(row => {
        console.log(`   Part: ${row.part_number}, Qty On Hand: ${row.quantity_on_hand}, Unit Cost: ${row.last_unit_cost}`);
      });
    }
    
    // Check sales_order_parts_to_order
    console.log('\n5. Sales Order Parts to Order:');
    const salesOrderPartsResult = await pool.query(`
      SELECT sopt.*, soh.sales_order_number, soh.status as so_status
      FROM sales_order_parts_to_order sopt
      JOIN salesorderhistory soh ON sopt.sales_order_id = soh.sales_order_id
      ORDER BY sopt.sales_order_id, sopt.part_number
    `);
    
    if (salesOrderPartsResult.rows.length === 0) {
      console.log('   No entries found in sales_order_parts_to_order');
    } else {
      salesOrderPartsResult.rows.forEach(row => {
        console.log(`   SO: ${row.sales_order_number} (${row.so_status}), Part: ${row.part_number}, Qty Needed: ${row.quantity_needed}`);
      });
    }
    
    // Check aggregated_parts_to_order
    console.log('\n6. Aggregated Parts to Order:');
    const aggregatedResult = await pool.query(`
      SELECT * FROM aggregated_parts_to_order
      ORDER BY part_number
    `);
    
    if (aggregatedResult.rows.length === 0) {
      console.log('   No entries found in aggregated_parts_to_order');
    } else {
      aggregatedResult.rows.forEach(row => {
        console.log(`   Part: ${row.part_number}, Total Qty Needed: ${row.total_quantity_needed}`);
      });
    }
    
  } catch (error) {
    console.error('Error checking parts to order status:', error);
  } finally {
    await pool.end();
  }
}

checkPartsToOrderStatus(); 
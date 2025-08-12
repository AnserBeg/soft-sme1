#!/usr/bin/env node
/**
 * Test script to verify AI assistant database connection from backend
 */

const { Pool } = require('pg');
require('dotenv').config({ path: './.env' });

// Database connection for AI assistant
const aiDbPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'soft_sme_db',
  user: 'ai_assistant',
  password: 'ai_secure_password_2024',
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

async function testConnection() {
  console.log('🔍 Testing AI Assistant Database Connection...');
  console.log('Database:', process.env.DB_NAME || 'soft_sme_db');
  console.log('Host:', process.env.DB_HOST || 'localhost');
  console.log('Port:', process.env.DB_PORT || '5432');
  console.log('User: ai_assistant');
  
  try {
    // Test basic connection
    const client = await aiDbPool.connect();
    console.log('✅ Database connection successful!');
    
    // Test business overview
    console.log('\n📊 Testing business overview...');
    const tables = ['customermaster', 'vendormaster', 'products', 'inventory', 
                   'salesorderhistory', 'purchasehistory', 'quotes', 'time_entries'];
    
    for (const table of tables) {
      try {
        const result = await client.query(`SELECT COUNT(*) FROM ${table}`);
        const count = parseInt(result.rows[0].count);
        console.log(`  ${table}: ${count} records`);
      } catch (e) {
        console.log(`  ${table}: ❌ Error - ${e.message}`);
      }
    }
    
    // Test customers query
    console.log('\n👥 Testing customers query...');
    const customersResult = await client.query(`
      SELECT customer_id, customer_name, contact_person, email
      FROM customermaster 
      ORDER BY customer_name
      LIMIT 3
    `);
    console.log(`  Found ${customersResult.rows.length} customers`);
    customersResult.rows.forEach(customer => {
      console.log(`    - ${customer.customer_name} (${customer.contact_person || 'No contact'})`);
    });
    
    // Test vendors query
    console.log('\n🏢 Testing vendors query...');
    const vendorsResult = await client.query(`
      SELECT vendor_id, vendor_name, contact_person, email
      FROM vendormaster 
      ORDER BY vendor_name
      LIMIT 3
    `);
    console.log(`  Found ${vendorsResult.rows.length} vendors`);
    vendorsResult.rows.forEach(vendor => {
      console.log(`    - ${vendor.vendor_name} (${vendor.contact_person || 'No contact'})`);
    });
    
    // Test inventory query
    console.log('\n📦 Testing inventory query...');
    const inventoryResult = await client.query(`
      SELECT part_type, COUNT(*) as count, 
             SUM(CASE WHEN part_type = 'stock' AND quantity_on_hand ~ '^[0-9]+\.?[0-9]*$' AND quantity_on_hand::numeric > 0 THEN 1 ELSE 0 END) as in_stock,
             SUM(CASE WHEN part_type = 'supply' THEN 1 ELSE 0 END) as supply_items
      FROM inventory 
      GROUP BY part_type
    `);
    console.log('  Inventory summary:');
    inventoryResult.rows.forEach(row => {
      if (row.part_type === 'supply') {
        console.log(`    - ${row.part_type}: ${row.count} items (supply items - ordered as needed)`);
      } else {
        console.log(`    - ${row.part_type}: ${row.count} items (${row.in_stock} in stock)`);
      }
    });
    
    // Test sales query
    console.log('\n💰 Testing sales query...');
    const salesResult = await client.query(`
      SELECT status, COUNT(*) as count, SUM(total_amount) as total_value
      FROM salesorderhistory 
      GROUP BY status
    `);
    console.log('  Sales summary:');
    salesResult.rows.forEach(row => {
      console.log(`    - ${row.status}: ${row.count} orders ($${row.total_value || 0})`);
    });
    
    // Test purchase query
    console.log('\n🛒 Testing purchase query...');
    const purchaseResult = await client.query(`
      SELECT status, COUNT(*) as count, SUM(total_amount) as total_value
      FROM purchasehistory 
      GROUP BY status
    `);
    console.log('  Purchase summary:');
    purchaseResult.rows.forEach(row => {
      console.log(`    - ${row.status}: ${row.count} orders ($${row.total_value || 0})`);
    });
    
    // Test parts to order query (if table exists)
    console.log('\n🔧 Testing parts to order query...');
    try {
      const partsResult = await client.query(`
        SELECT COUNT(*) as total_parts, 
               SUM(total_quantity_needed) as total_quantity,
               SUM(total_line_amount) as total_value
        FROM aggregated_parts_to_order 
        WHERE total_quantity_needed > 0
      `);
      const summary = partsResult.rows[0];
      console.log(`  Parts to order: ${summary.total_parts || 0} parts, ${summary.total_quantity || 0} quantity, $${summary.total_value || 0} value`);
    } catch (e) {
      console.log(`  Parts to order: ❌ Table not found - ${e.message}`);
    }
    
    client.release();
    console.log('\n🎉 All database tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    console.log('\n💡 Make sure to run the setup script first:');
    console.log('   psql -U postgres -d soft_sme_db -f setup_ai_database_access.sql');
  } finally {
    await aiDbPool.end();
  }
}

// Run the test
testConnection().catch(console.error); 
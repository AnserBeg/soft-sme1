const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme',
  password: '123',
  port: 5432,
});

async function runMigrations() {
  const client = await pool.connect();
  
  try {
    console.log('Starting migrations...');
    
    // Migration 1: Add fields to quotes table
    console.log('Running migration: add_customer_po_and_vin_to_quotes.sql');
    const quotesMigration = fs.readFileSync(
      path.join(__dirname, 'migrations/add_customer_po_and_vin_to_quotes.sql'), 
      'utf8'
    );
    await client.query(quotesMigration);
    console.log('✓ Added customer_po_number and vin_number to quotes table');
    
    // Migration 2: Add fields to salesorderhistory table
    console.log('Running migration: add_customer_po_and_vin_to_salesorderhistory.sql');
    const salesOrderMigration = fs.readFileSync(
      path.join(__dirname, 'migrations/add_customer_po_and_vin_to_salesorderhistory.sql'), 
      'utf8'
    );
    await client.query(salesOrderMigration);
    console.log('✓ Added customer_po_number and vin_number to salesorderhistory table');
    
    console.log('All migrations completed successfully!');
    
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch(console.error); 
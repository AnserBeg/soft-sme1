const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function checkInventoryVendorsStructure() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Checking inventory_vendors table structure...\n');
    
    // Check inventory_vendors table columns
    const columns = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'inventory_vendors' 
      ORDER BY ordinal_position
    `);
    
    console.log('📋 inventory_vendors table columns:');
    columns.rows.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
    });
    
    // Check foreign key constraints
    const fks = await client.query(`
      SELECT 
        tc.constraint_name,
        kcu.column_name as referencing_column,
        ccu.table_name as referenced_table,
        ccu.column_name as referenced_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'inventory_vendors' AND tc.constraint_type = 'FOREIGN KEY'
    `);
    
    console.log('\n🔗 Foreign key constraints:');
    fks.rows.forEach(fk => {
      console.log(`  - ${fk.constraint_name}: ${fk.referencing_column} → ${fk.referenced_table}.${fk.referenced_column}`);
    });
    
    // Check a sample record
    const sample = await client.query('SELECT * FROM inventory_vendors LIMIT 1');
    if (sample.rows.length > 0) {
      console.log('\n📋 Sample record:');
      console.log(sample.rows[0]);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkInventoryVendorsStructure();

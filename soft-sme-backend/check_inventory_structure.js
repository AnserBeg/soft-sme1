const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function checkInventoryStructure() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Checking inventory table structure...\n');
    
    // Check inventory table columns
    const columns = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'inventory' 
      ORDER BY ordinal_position
    `);
    
    console.log('📋 Inventory table columns:');
    columns.rows.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
    });
    
    // Check primary key
    const pk = await client.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'inventory' AND tc.constraint_type = 'PRIMARY KEY'
    `);
    
    console.log(`\n🔑 Primary Key: ${pk.rows[0]?.column_name || 'None found'}`);
    
    // Check foreign key references to inventory
    const fks = await client.query(`
      SELECT 
        tc.table_name as referencing_table,
        kcu.column_name as referencing_column,
        ccu.column_name as referenced_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' 
      AND ccu.table_name = 'inventory'
    `);
    
    console.log('\n🔗 Foreign key references to inventory:');
    fks.rows.forEach(fk => {
      console.log(`  - ${fk.referencing_table}.${fk.referencing_column} → inventory.${fk.referenced_column}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkInventoryStructure();

const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function checkTableStructure() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Checking table structure...\n');
    
    const tables = [
      'salesorderlineitems',
      'purchaselineitems', 
      'sales_order_parts_to_order',
      'aggregated_parts_to_order',
      'inventory_vendors'
    ];
    
    for (const tableName of tables) {
      console.log(`\n📋 Table: ${tableName}`);
      
      // Get column information
      const columns = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_name = $1 
        ORDER BY ordinal_position
      `, [tableName]);
      
      console.log('   Columns:');
      columns.rows.forEach(col => {
        console.log(`      - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
      });
      
      // Get primary key
      const pk = await client.query(`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
      `, [tableName]);
      
      if (pk.rows.length > 0) {
        console.log(`   Primary Key: ${pk.rows[0].column_name}`);
      } else {
        console.log(`   Primary Key: None found`);
      }
      
      // Check if part_id column exists
      const partIdExists = columns.rows.some(col => col.column_name === 'part_id');
      console.log(`   Has part_id: ${partIdExists ? '✅' : '❌'}`);
    }
    
  } catch (error) {
    console.error('❌ Check failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the check
checkTableStructure().catch(console.error);

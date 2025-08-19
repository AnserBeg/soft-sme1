const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function checkAllPartReferences() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Checking all tables that reference parts...\n');
    
    // Check all foreign key references to inventory table
    const fks = await client.query(`
      SELECT 
        tc.table_name as referencing_table,
        kcu.column_name as referencing_column,
        ccu.column_name as referenced_column,
        tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' 
      AND ccu.table_name = 'inventory'
      ORDER BY tc.table_name, kcu.column_name
    `);
    
    console.log('🔗 Foreign key references to inventory:');
    fks.rows.forEach(fk => {
      console.log(`  - ${fk.referencing_table}.${fk.referencing_column} → inventory.${fk.referenced_column} (${fk.constraint_name})`);
    });
    
    // Check tables that might reference parts but don't have foreign keys
    const tablesToCheck = [
      'salesorderlineitems',
      'purchaselineitems', 
      'sales_order_parts_to_order',
      'aggregated_parts_to_order',
      'inventory_vendors'
    ];
    
    console.log('\n📋 Checking part_number columns in key tables:');
    
    for (const tableName of tablesToCheck) {
      const columns = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_name = $1 
        AND column_name IN ('part_number', 'part_id')
        ORDER BY ordinal_position
      `, [tableName]);
      
      if (columns.rows.length > 0) {
        console.log(`\n  📊 ${tableName}:`);
        columns.rows.forEach(col => {
          console.log(`    - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
        });
        
        // Check sample data
        const sample = await client.query(`SELECT part_number, part_id FROM ${tableName} LIMIT 1`);
        if (sample.rows.length > 0) {
          console.log(`    📋 Sample: ${JSON.stringify(sample.rows[0])}`);
        }
      }
    }
    
    // Check if any tables are missing part_id columns
    console.log('\n🔍 Checking for tables that might need part_id columns:');
    
    for (const tableName of tablesToCheck) {
      const hasPartId = await client.query(`
        SELECT COUNT(*) as count
        FROM information_schema.columns 
        WHERE table_name = $1 AND column_name = 'part_id'
      `, [tableName]);
      
      const hasPartNumber = await client.query(`
        SELECT COUNT(*) as count
        FROM information_schema.columns 
        WHERE table_name = $1 AND column_name = 'part_number'
      `, [tableName]);
      
      if (hasPartNumber.rows[0].count > 0 && hasPartId.rows[0].count === 0) {
        console.log(`  ⚠️  ${tableName}: Has part_number but NO part_id column`);
      } else if (hasPartNumber.rows[0].count > 0 && hasPartId.rows[0].count > 0) {
        console.log(`  ✅ ${tableName}: Has both part_number and part_id`);
      } else if (hasPartNumber.rows[0].count === 0) {
        console.log(`  ℹ️  ${tableName}: No part_number column`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkAllPartReferences();

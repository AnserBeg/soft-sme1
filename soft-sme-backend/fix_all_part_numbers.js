const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function fixAllPartNumbers() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Fixing invalid part numbers across ALL related tables...\n');
    
    // Define all tables that reference part_number with correct column names
    const tablesToFix = [
      { name: 'salesorderlineitems', idColumn: 'sales_order_line_item_id', displayName: 'Sales Order Line Items' },
      { name: 'purchaselineitems', idColumn: 'line_item_id', displayName: 'Purchase Order Line Items' },
      { name: 'sales_order_parts_to_order', idColumn: 'id', displayName: 'Sales Order Parts to Order' },
      { name: 'aggregated_parts_to_order', idColumn: 'id', displayName: 'Aggregated Parts to Order' },
      { name: 'inventory_vendors', idColumn: 'id', displayName: 'Inventory Vendors' }
    ];
    
    // Step 1: Find all invalid part numbers across all tables
    console.log('1. Scanning all tables for invalid part numbers...');
    
    let totalInvalid = 0;
    const allInvalidParts = new Set();
    
    for (const table of tablesToFix) {
      const invalidParts = await client.query(`
        SELECT DISTINCT t.part_number, t.${table.idColumn} as item_id
        FROM ${table.name} t
        LEFT JOIN inventory inv ON t.part_number = inv.part_number
        WHERE inv.part_number IS NULL
        AND t.part_number IS NOT NULL
        ORDER BY t.part_number
      `);
      
      console.log(`   ${table.displayName}: ${invalidParts.rows.length} invalid part numbers`);
      invalidParts.rows.forEach(row => {
        allInvalidParts.add(row.part_number);
      });
      totalInvalid += invalidParts.rows.length;
    }
    
    console.log(`\n   Total invalid part numbers found: ${totalInvalid}`);
    console.log(`   Unique invalid part numbers: ${allInvalidParts.size}`);
    
    if (totalInvalid === 0) {
      console.log('   ✅ No invalid part numbers found in any table!');
      return;
    }
    
    // Step 2: Show sample cleaned inventory part numbers
    console.log('\n2. Sample cleaned inventory part numbers:');
    const sampleParts = await client.query(`
      SELECT part_number, part_description 
      FROM inventory 
      WHERE part_number LIKE '%X%X%' 
      ORDER BY part_number 
      LIMIT 10
    `);
    
    sampleParts.rows.forEach(row => {
      console.log(`      - "${row.part_number}" (${row.part_description})`);
    });
    
    // Step 3: Fix each unique invalid part number
    console.log('\n3. Fixing invalid part numbers...');
    
    for (const invalidPartNumber of allInvalidParts) {
      console.log(`\n   Processing: "${invalidPartNumber}"`);
      
      // Try to find similar part numbers
      const possibleMatches = await client.query(`
        SELECT part_number, part_description
        FROM inventory 
        WHERE part_number ILIKE $1 
           OR part_number ILIKE $2
           OR part_number ILIKE $3
           OR part_number ILIKE $4
        ORDER BY part_number
        LIMIT 5
      `, [
        `%${invalidPartNumber.replace(/[^A-Z0-9]/gi, '')}%`,
        `%${invalidPartNumber.replace(/[^A-Z0-9]/gi, '').toLowerCase()}%`,
        `%${invalidPartNumber.replace(/[^A-Z0-9]/gi, '').toUpperCase()}%`,
        `%${invalidPartNumber.replace(/[^A-Z0-9]/gi, '')}%`
      ]);
      
      if (possibleMatches.rows.length > 0) {
        const bestMatch = possibleMatches.rows[0];
        console.log(`      → Auto-replacing with: "${bestMatch.part_number}"`);
        
        // Update all tables that reference this part number
        for (const table of tablesToFix) {
          try {
            const result = await client.query(`
              UPDATE ${table.name} 
              SET part_number = $1, part_id = NULL
              WHERE part_number = $2
            `, [bestMatch.part_number, invalidPartNumber]);
            
            if (result.rowCount > 0) {
              console.log(`         ✅ Updated ${result.rowCount} rows in ${table.displayName}`);
            }
          } catch (error) {
            console.log(`         ❌ Error updating ${table.displayName}: ${error.message}`);
          }
        }
        
        // Update part_id for all affected rows
        for (const table of tablesToFix) {
          try {
            await client.query(`
              UPDATE ${table.name} 
              SET part_id = inv.part_id
              FROM inventory inv
              WHERE ${table.name}.part_number = inv.part_number
              AND ${table.name}.part_number = $1
            `, [bestMatch.part_number]);
          } catch (error) {
            // Ignore errors for part_id updates
          }
        }
        
      } else {
        console.log(`      ❌ No matches found for "${invalidPartNumber}"`);
        console.log(`      ⚠️  This will need manual attention`);
      }
    }
    
    // Step 4: Verify the fix
    console.log('\n4. Verifying the fix...');
    
    let remainingInvalid = 0;
    for (const table of tablesToFix) {
      const invalidCount = await client.query(`
        SELECT COUNT(*) as count
        FROM ${table.name} t
        LEFT JOIN inventory inv ON t.part_number = inv.part_number
        WHERE inv.part_number IS NULL
        AND t.part_number IS NOT NULL
      `);
      
      const count = parseInt(invalidCount.rows[0].count);
      remainingInvalid += count;
      console.log(`   ${table.displayName}: ${count} remaining invalid`);
    }
    
    console.log(`\n   Total remaining invalid: ${remainingInvalid}`);
    
    if (remainingInvalid === 0) {
      console.log('   ✅ All part numbers are now valid across all tables!');
    } else {
      console.log('   ⚠️  Some part numbers still need manual attention.');
    }
    
    // Step 5: Show summary
    console.log('\n5. Summary of changes:');
    for (const table of tablesToFix) {
      const summary = await client.query(`
        SELECT COUNT(*) as total_rows, 
               COUNT(CASE WHEN part_id IS NOT NULL THEN 1 END) as with_part_id
        FROM ${table.name}
      `);
      
      const row = summary.rows[0];
      console.log(`   ${table.displayName}: ${row.total_rows} total rows, ${row.with_part_id} with part_id`);
    }
    
    console.log('\n🎉 All tables part number fix complete!');
    console.log('\n📋 Next steps:');
    console.log('1. Try creating/saving sales orders and purchase orders again');
    console.log('2. The part_id solution will prevent this issue in the future');
    console.log('3. Use InventoryService.updatePartNumber() for future part number changes');
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the fix
fixAllPartNumbers().catch(console.error);

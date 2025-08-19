const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function fixPartNumberMapping() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Fixing part number mapping with intelligent matching...\n');
    
    // Define the mapping rules based on the patterns we see
    const partNumberMappings = {
      // Format: "1X1X3/16" -> "1X1X(3/16)"
      '1X1X3/16': '1X1X(3/16)',
      '2X2X1/4': '2X2X(1/4)',
      '2X2X3/16': '2X2X(3/16)',
      '5X3X1/4': '5X3X(1/4)',
      '5X10X1/4': '5X10X(1/4)',
      '1-1/4X1-1/4X1/8': '1(1/4)X1(1/4)X(1/8)',
      
      // Special cases
      'LABOUR': 'LABOUR',
      'OVERHEAD': 'OVERHEAD'
    };
    
    const tablesToFix = [
      'salesorderlineitems',
      'purchaselineitems', 
      'sales_order_parts_to_order',
      'aggregated_parts_to_order',
      'inventory_vendors'
    ];
    
    console.log('1. Applying intelligent part number mappings...');
    
    let totalUpdated = 0;
    
    for (const [oldPartNumber, newPartNumber] of Object.entries(partNumberMappings)) {
      console.log(`\n   Mapping: "${oldPartNumber}" → "${newPartNumber}"`);
      
      // Check if the new part number exists in inventory
      const inventoryCheck = await client.query(`
        SELECT part_id, part_description FROM inventory WHERE part_number = $1
      `, [newPartNumber]);
      
      if (inventoryCheck.rows.length === 0) {
        console.log(`      ⚠️  New part number "${newPartNumber}" not found in inventory`);
        continue;
      }
      
      // Update all tables that reference this part number
      for (const table of tablesToFix) {
        try {
          const result = await client.query(`
            UPDATE ${table.name} 
            SET part_number = $1, part_id = $2
            WHERE part_number = $3
          `, [newPartNumber, inventoryCheck.rows[0].part_id, oldPartNumber]);
          
          if (result.rowCount > 0) {
            console.log(`      ✅ Updated ${result.rowCount} rows in ${table}`);
            totalUpdated += result.rowCount;
          }
        } catch (error) {
          console.log(`      ❌ Error updating ${table}: ${error.message}`);
        }
      }
    }
    
    // Handle special cases for LABOUR and OVERHEAD
    console.log('\n2. Handling special cases (LABOUR, OVERHEAD)...');
    
    const specialCases = ['LABOUR', 'OVERHEAD'];
    for (const specialPart of specialCases) {
      console.log(`\n   Processing: "${specialPart}"`);
      
      // Check if this part exists in inventory
      const inventoryCheck = await client.query(`
        SELECT part_id FROM inventory WHERE part_number = $1
      `, [specialPart]);
      
      if (inventoryCheck.rows.length > 0) {
        console.log(`      ✅ "${specialPart}" found in inventory`);
        
        // Update all tables
        for (const table of tablesToFix) {
          try {
            const result = await client.query(`
              UPDATE ${table.name} 
              SET part_id = $1
              WHERE part_number = $2 AND part_id IS NULL
            `, [inventoryCheck.rows[0].part_id, specialPart]);
            
            if (result.rowCount > 0) {
              console.log(`         ✅ Updated ${result.rowCount} rows in ${table}`);
            }
          } catch (error) {
            console.log(`         ❌ Error updating ${table}: ${error.message}`);
          }
        }
      } else {
        console.log(`      ⚠️  "${specialPart}" not found in inventory - may need to be added`);
      }
    }
    
    // Try to find similar part numbers for remaining cases
    console.log('\n3. Attempting fuzzy matching for remaining cases...');
    
    const remainingInvalid = await client.query(`
      SELECT DISTINCT t.part_number
      FROM salesorderlineitems t
      LEFT JOIN inventory inv ON t.part_number = inv.part_number
      WHERE inv.part_number IS NULL
      AND t.part_number IS NOT NULL
      UNION
      SELECT DISTINCT t.part_number
      FROM purchaselineitems t
      LEFT JOIN inventory inv ON t.part_number = inv.part_number
      WHERE inv.part_number IS NULL
      AND t.part_number IS NOT NULL
      UNION
      SELECT DISTINCT t.part_number
      FROM sales_order_parts_to_order t
      LEFT JOIN inventory inv ON t.part_number = inv.part_number
      WHERE inv.part_number IS NULL
      AND t.part_number IS NOT NULL
      UNION
      SELECT DISTINCT t.part_number
      FROM aggregated_parts_to_order t
      LEFT JOIN inventory inv ON t.part_number = inv.part_number
      WHERE inv.part_number IS NULL
      AND t.part_number IS NOT NULL
    `);
    
    for (const row of remainingInvalid.rows) {
      const invalidPart = row.part_number;
      console.log(`\n   Trying fuzzy match for: "${invalidPart}"`);
      
      // Try different patterns
      const patterns = [
        invalidPart.replace(/[^A-Z0-9]/gi, ''),
        invalidPart.replace(/[^A-Z0-9]/gi, '').toLowerCase(),
        invalidPart.replace(/[^A-Z0-9]/gi, '').toUpperCase(),
        invalidPart.replace(/[^A-Z0-9]/gi, '')
      ];
      
      let found = false;
      for (const pattern of patterns) {
        const matches = await client.query(`
          SELECT part_number, part_description
          FROM inventory 
          WHERE part_number ILIKE $1
          ORDER BY part_number
          LIMIT 3
        `, [`%${pattern}%`]);
        
        if (matches.rows.length > 0) {
          console.log(`      Possible matches for "${invalidPart}":`);
          matches.rows.forEach(match => {
            console.log(`         - "${match.part_number}" (${match.part_description})`);
          });
          found = true;
          break;
        }
      }
      
      if (!found) {
        console.log(`      ❌ No matches found for "${invalidPart}"`);
      }
    }
    
    // Final verification
    console.log('\n4. Final verification...');
    
    let finalInvalid = 0;
    for (const table of tablesToFix) {
      const invalidCount = await client.query(`
        SELECT COUNT(*) as count
        FROM ${table} t
        LEFT JOIN inventory inv ON t.part_number = inv.part_number
        WHERE inv.part_number IS NULL
        AND t.part_number IS NOT NULL
      `);
      
      const count = parseInt(invalidCount.rows[0].count);
      finalInvalid += count;
      console.log(`   ${table}: ${count} remaining invalid`);
    }
    
    console.log(`\n   Total remaining invalid: ${finalInvalid}`);
    console.log(`   Total rows updated: ${totalUpdated}`);
    
    if (finalInvalid === 0) {
      console.log('\n🎉 All part numbers are now valid!');
    } else {
      console.log('\n⚠️  Some part numbers still need manual attention.');
      console.log('   You may need to:');
      console.log('   1. Add missing parts to inventory');
      console.log('   2. Update part numbers manually');
      console.log('   3. Remove invalid line items');
    }
    
    console.log('\n📋 Summary:');
    console.log('- Applied intelligent part number mappings');
    console.log('- Updated part_id references');
    console.log('- The part_id solution will prevent this in the future');
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the fix
fixPartNumberMapping().catch(console.error);

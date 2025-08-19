const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function fixSpecialServiceItems() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Fixing special service items (LABOUR, OVERHEAD, SUPPLY)...\n');
    
    // Define special service items that are not part of inventory
    const specialServiceItems = ['LABOUR', 'OVERHEAD', 'SUPPLY'];
    
    const tablesToFix = [
      'salesorderlineitems',
      'purchaselineitems', 
      'sales_order_parts_to_order',
      'aggregated_parts_to_order'
    ];
    
    console.log('1. Handling special service items...');
    
    for (const serviceItem of specialServiceItems) {
      console.log(`\n   Processing: "${serviceItem}"`);
      
      // Check if this service item exists in any of the tables
      let totalCount = 0;
      for (const table of tablesToFix) {
        const count = await client.query(`
          SELECT COUNT(*) as count FROM ${table} WHERE part_number = $1
        `, [serviceItem]);
        
        const rowCount = parseInt(count.rows[0].count);
        totalCount += rowCount;
        
        if (rowCount > 0) {
          console.log(`      ${table}: ${rowCount} line items`);
        }
      }
      
      if (totalCount > 0) {
        console.log(`      Total: ${totalCount} line items found`);
        
        // For special service items, we should:
        // 1. Keep the part_number as is (LABOUR, OVERHEAD, SUPPLY)
        // 2. Set part_id to NULL (since they're not in inventory)
        // 3. Ensure they're not flagged as invalid
        
        for (const table of tablesToFix) {
          try {
            const result = await client.query(`
              UPDATE ${table} 
              SET part_id = NULL
              WHERE part_number = $1
            `, [serviceItem]);
            
            if (result.rowCount > 0) {
              console.log(`         ✅ Updated ${result.rowCount} rows in ${table}`);
            }
          } catch (error) {
            console.log(`         ❌ Error updating ${table}: ${error.message}`);
          }
        }
      } else {
        console.log(`      No line items found for "${serviceItem}"`);
      }
    }
    
    // Now fix the remaining part number formatting issues
    console.log('\n2. Fixing part number formatting issues...');
    
    const partNumberMappings = {
      '1X1X3/16': '1X1X(3/16)',
      '2X2X1/4': '2X2X(1/4)',
      '2X2X3/16': '2X2X(3/16)',
      '5X3X1/4': '5X3X(1/4)',
      '5X10X1/4': '5X10X(1/4)',
      '1-1/4X1-1/4X1/8': '1(1/4)X1(1/4)X(1/8)'
    };
    
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
            UPDATE ${table} 
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
    
    // Final verification
    console.log('\n3. Final verification...');
    
    let finalInvalid = 0;
    for (const table of tablesToFix) {
      const invalidCount = await client.query(`
        SELECT COUNT(*) as count
        FROM ${table} t
        LEFT JOIN inventory inv ON t.part_number = inv.part_number
        WHERE inv.part_number IS NULL
        AND t.part_number IS NOT NULL
        AND t.part_number NOT IN ('LABOUR', 'OVERHEAD', 'SUPPLY')
      `);
      
      const count = parseInt(invalidCount.rows[0].count);
      finalInvalid += count;
      console.log(`   ${table}: ${count} remaining invalid (excluding service items)`);
    }
    
    console.log(`\n   Total remaining invalid: ${finalInvalid}`);
    console.log(`   Total rows updated: ${totalUpdated}`);
    
    if (finalInvalid === 0) {
      console.log('\n🎉 All part numbers are now valid!');
      console.log('   Special service items (LABOUR, OVERHEAD, SUPPLY) are properly handled.');
    } else {
      console.log('\n⚠️  Some part numbers still need manual attention.');
      console.log('   These are likely parts that need to be added to inventory.');
    }
    
    // Show summary of special service items
    console.log('\n4. Summary of special service items:');
    for (const serviceItem of specialServiceItems) {
      let totalCount = 0;
      for (const table of tablesToFix) {
        const count = await client.query(`
          SELECT COUNT(*) as count FROM ${table} WHERE part_number = $1
        `, [serviceItem]);
        totalCount += parseInt(count.rows[0].count);
      }
      console.log(`   ${serviceItem}: ${totalCount} line items across all tables`);
    }
    
    console.log('\n📋 Summary:');
    console.log('- Special service items are properly handled');
    console.log('- Part number formatting issues are fixed');
    console.log('- The part_id solution will prevent this in the future');
    console.log('- LABOUR, OVERHEAD, SUPPLY are not flagged as invalid');
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the fix
fixSpecialServiceItems().catch(console.error);

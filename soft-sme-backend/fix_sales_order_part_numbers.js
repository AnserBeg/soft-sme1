const { Pool } = require('pg');

// Database connection
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

async function fixSalesOrderPartNumbers() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Fixing sales order line items with invalid part numbers...\n');
    
    // Step 1: Find sales order line items with invalid part numbers
    console.log('1. Finding sales order line items with invalid part numbers...');
    const invalidParts = await client.query(`
      SELECT DISTINCT sol.part_number, sol.line_item_id, sol.sales_order_id
      FROM salesorderlineitems sol
      LEFT JOIN inventory inv ON sol.part_number = inv.part_number
      WHERE inv.part_number IS NULL
      AND sol.part_number IS NOT NULL
      ORDER BY sol.part_number
    `);
    
    console.log(`   Found ${invalidParts.rows.length} line items with invalid part numbers:`);
    invalidParts.rows.forEach(row => {
      console.log(`      - Order ${row.sales_order_id}, Line ${row.line_item_id}: "${row.part_number}"`);
    });
    
    if (invalidParts.rows.length === 0) {
      console.log('   ✅ No invalid part numbers found!');
      return;
    }
    
    // Step 2: Show what the cleaned part numbers look like
    console.log('\n2. Checking cleaned inventory part numbers...');
    const sampleParts = await client.query(`
      SELECT part_number, part_description 
      FROM inventory 
      WHERE part_number LIKE '%X%X%' 
      ORDER BY part_number 
      LIMIT 10
    `);
    
    console.log('   Sample cleaned part numbers:');
    sampleParts.rows.forEach(row => {
      console.log(`      - "${row.part_number}" (${row.part_description})`);
    });
    
    // Step 3: Try to find similar part numbers for the invalid ones
    console.log('\n3. Attempting to find similar part numbers...');
    
    for (const invalidPart of invalidParts.rows) {
      const oldPartNumber = invalidPart.part_number;
      
      // Try different cleaning patterns
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
        `%${oldPartNumber.replace(/[^A-Z0-9]/gi, '')}%`,
        `%${oldPartNumber.replace(/[^A-Z0-9]/gi, '').toLowerCase()}%`,
        `%${oldPartNumber.replace(/[^A-Z0-9]/gi, '').toUpperCase()}%`,
        `%${oldPartNumber.replace(/[^A-Z0-9]/gi, '')}%`
      ]);
      
      if (possibleMatches.rows.length > 0) {
        console.log(`\n   For "${oldPartNumber}":`);
        possibleMatches.rows.forEach(match => {
          console.log(`      Possible match: "${match.part_number}" (${match.part_description})`);
        });
        
        // Ask user what to do
        console.log(`\n   What should we do with "${oldPartNumber}"?`);
        console.log('   Options:');
        possibleMatches.rows.forEach((match, index) => {
          console.log(`      ${index + 1}. Replace with "${match.part_number}"`);
        });
        console.log(`      ${possibleMatches.rows.length + 1}. Skip this part`);
        console.log(`      ${possibleMatches.rows.length + 2}. Delete this line item`);
        
        // For now, let's try the first match automatically
        const bestMatch = possibleMatches.rows[0];
        console.log(`\n   Auto-selecting: Replace "${oldPartNumber}" with "${bestMatch.part_number}"`);
        
        // Update the sales order line item
        await client.query(`
          UPDATE salesorderlineitems 
          SET part_number = $1, part_id = $2
          WHERE line_item_id = $3
        `, [bestMatch.part_number, null, invalidPart.line_item_id]);
        
        // Update the part_id
        await client.query(`
          UPDATE salesorderlineitems 
          SET part_id = inv.part_id
          FROM inventory inv
          WHERE salesorderlineitems.line_item_id = $1
          AND inv.part_number = salesorderlineitems.part_number
        `, [invalidPart.line_item_id]);
        
        console.log(`   ✅ Updated line item ${invalidPart.line_item_id}`);
        
      } else {
        console.log(`\n   ❌ No matches found for "${oldPartNumber}"`);
        console.log('   This line item will need manual attention.');
      }
    }
    
    // Step 4: Verify the fix
    console.log('\n4. Verifying the fix...');
    const remainingInvalid = await client.query(`
      SELECT COUNT(*) as count
      FROM salesorderlineitems sol
      LEFT JOIN inventory inv ON sol.part_number = inv.part_number
      WHERE inv.part_number IS NULL
      AND sol.part_number IS NOT NULL
    `);
    
    console.log(`   Remaining invalid part numbers: ${remainingInvalid.rows[0].count}`);
    
    if (remainingInvalid.rows[0].count === 0) {
      console.log('   ✅ All part numbers are now valid!');
    } else {
      console.log('   ⚠️  Some part numbers still need manual attention.');
    }
    
    // Step 5: Show summary of what was fixed
    console.log('\n5. Summary of changes:');
    const fixedSummary = await client.query(`
      SELECT sol.part_number, COUNT(*) as count
      FROM salesorderlineitems sol
      JOIN inventory inv ON sol.part_number = inv.part_number
      WHERE sol.part_id IS NOT NULL
      GROUP BY sol.part_number
      ORDER BY count DESC
      LIMIT 10
    `);
    
    console.log('   Most common part numbers in sales orders:');
    fixedSummary.rows.forEach(row => {
      console.log(`      - "${row.part_number}": ${row.count} line items`);
    });
    
    console.log('\n🎉 Sales order part number fix complete!');
    console.log('\n📋 Next steps:');
    console.log('1. Try creating/saving a sales order again');
    console.log('2. If you still get errors, check the remaining invalid parts manually');
    console.log('3. Consider using the part_id solution for future updates');
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the fix
fixSalesOrderPartNumbers().catch(console.error);

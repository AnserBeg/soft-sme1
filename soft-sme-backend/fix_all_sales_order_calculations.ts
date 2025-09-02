import { Pool } from 'pg';
import { config } from 'dotenv';

// Load environment variables
config();

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function fixAllSalesOrderCalculations() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Starting to fix all sales order calculations...');
    
    // Get all sales orders that have labour or overhead line items
    const salesOrdersQuery = `
      SELECT DISTINCT soh.sales_order_id, soh.sales_order_number
      FROM salesorderhistory soh
      INNER JOIN salesorderlineitems soli ON soh.sales_order_id = soli.sales_order_id
      WHERE soli.part_number IN ('LABOUR', 'OVERHEAD')
      ORDER BY soh.sales_order_id
    `;
    
    const salesOrdersResult = await client.query(salesOrdersQuery);
    const salesOrders = salesOrdersResult.rows;
    
    console.log(`📊 Found ${salesOrders.length} sales orders with labour/overhead line items to fix`);
    
    let fixedCount = 0;
    let errorCount = 0;
    
    for (const salesOrder of salesOrders) {
      try {
        console.log(`\n🔄 Processing Sales Order ${salesOrder.sales_order_number} (ID: ${salesOrder.sales_order_id})`);
        
        // Get time entries for this sales order
        const timeEntriesQuery = `
          SELECT SUM(duration) as total_hours
          FROM time_entries 
          WHERE sales_order_id = $1 AND clock_out IS NOT NULL
        `;
        
        const timeEntriesResult = await client.query(timeEntriesQuery, [salesOrder.sales_order_id]);
        const timeData = timeEntriesResult.rows[0];
        
        const totalHours = parseFloat(timeData.total_hours) || 0;
        
        // Get global labour rate
        const labourRateResult = await client.query(
          "SELECT value FROM global_settings WHERE key = 'labour_rate'"
        );
        const avgRate = labourRateResult.rows.length > 0 ? 
          parseFloat(labourRateResult.rows[0].value) : 60;
        
        console.log(`  📅 Time entries: ${totalHours} hours, $${avgRate}/hour (global rate)`);
        
        if (totalHours > 0) {
          // Get global overhead rate
          const overheadRateResult = await client.query(
            "SELECT value FROM global_settings WHERE key = 'overhead_rate'"
          );
          const overheadRate = overheadRateResult.rows.length > 0 ? 
            parseFloat(overheadRateResult.rows[0].value) : 0;
          
          // Calculate correct amounts
          const labourAmount = totalHours * avgRate;
          const overheadAmount = totalHours * overheadRate;
          
          console.log(`  💰 Correct amounts: Labour = $${labourAmount.toFixed(2)}, Overhead = $${overheadAmount.toFixed(2)}`);
          
          // Update LABOUR line item
          await client.query(`
            UPDATE salesorderlineitems 
            SET line_amount = $1, unit_price = $2, quantity_sold = $3, updated_at = NOW()
            WHERE sales_order_id = $4 AND part_number = 'LABOUR'
          `, [labourAmount, avgRate, totalHours, salesOrder.sales_order_id]);
          
          // Update OVERHEAD line item
          await client.query(`
            UPDATE salesorderlineitems 
            SET line_amount = $1, unit_price = $2, quantity_sold = $3, updated_at = NOW()
            WHERE sales_order_id = $4 AND part_number = 'OVERHEAD'
          `, [overheadAmount, overheadRate, totalHours, salesOrder.sales_order_id]);
          
          // Update SUPPLY line item if it exists
          const supplyRateResult = await client.query(
            "SELECT value FROM global_settings WHERE key = 'supply_rate'"
          );
          const supplyRate = supplyRateResult.rows.length > 0 ? 
            parseFloat(supplyRateResult.rows[0].value) : 0;
          
          if (supplyRate > 0 && labourAmount > 0) {
            const supplyAmount = labourAmount * (supplyRate / 100);
            
            await client.query(`
              UPDATE salesorderlineitems 
              SET line_amount = $1, unit_price = $2, updated_at = NOW()
              WHERE sales_order_id = $3 AND part_number = 'SUPPLY'
            `, [supplyAmount, supplyAmount, salesOrder.sales_order_id]);
            
            console.log(`  📦 Updated SUPPLY: $${supplyAmount.toFixed(2)} (${supplyRate}% of labour)`);
          }
          
          // Recalculate sales order totals
          const lineItemsResult = await client.query(
            'SELECT line_amount FROM salesorderlineitems WHERE sales_order_id = $1',
            [salesOrder.sales_order_id]
          );
          
          let subtotal = 0;
          for (const item of lineItemsResult.rows) {
            subtotal += parseFloat(item.line_amount || 0);
          }
          
          // Apply proper rounding
          subtotal = Math.round(subtotal * 100) / 100;
          const total_gst_amount = Math.round((subtotal * 0.05) * 100) / 100;
          const total_amount = Math.round((subtotal + total_gst_amount) * 100) / 100;
          
          // Update sales order summary
          await client.query(`
            UPDATE salesorderhistory 
            SET subtotal = $1, total_gst_amount = $2, total_amount = $3, updated_at = NOW()
            WHERE sales_order_id = $4
          `, [subtotal, total_gst_amount, total_amount, salesOrder.sales_order_id]);
          
          console.log(`  ✅ Updated totals: Subtotal = $${subtotal.toFixed(2)}, GST = $${total_gst_amount.toFixed(2)}, Total = $${total_amount.toFixed(2)}`);
          
          fixedCount++;
        } else {
          console.log(`  ⚠️ No time entries found, skipping calculation`);
        }
        
      } catch (error) {
        console.error(`  ❌ Error processing Sales Order ${salesOrder.sales_order_number}:`, error);
        errorCount++;
      }
    }
    
    console.log(`\n🎉 Fix completed!`);
    console.log(`✅ Successfully fixed: ${fixedCount} sales orders`);
    console.log(`❌ Errors encountered: ${errorCount} sales orders`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the fix
if (require.main === module) {
  fixAllSalesOrderCalculations()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export { fixAllSalesOrderCalculations };

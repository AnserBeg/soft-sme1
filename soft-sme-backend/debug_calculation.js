const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'soft_sme_db',
  user: 'postgres',
  password: '123',
});

async function debugCalculation() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Debugging calculation for SO-2025-00052...\n');
    
    // Get the sales order details
    const salesOrderQuery = `
      SELECT sales_order_id, sales_order_number, subtotal, total_gst_amount, total_amount
      FROM salesorderhistory 
      WHERE sales_order_number = 'SO-2025-00052'
    `;
    
    const salesOrderResult = await client.query(salesOrderQuery);
    if (salesOrderResult.rows.length === 0) {
      console.log('❌ Sales order not found');
      return;
    }
    
    const salesOrder = salesOrderResult.rows[0];
    console.log(`📋 Sales Order: ${salesOrder.sales_order_number} (ID: ${salesOrder.sales_order_id})`);
    console.log(`💰 Current totals: Subtotal = $${salesOrder.subtotal}, GST = $${salesOrder.total_gst_amount}, Total = $${salesOrder.total_amount}\n`);
    
    // Get all line items for this sales order
    const lineItemsQuery = `
      SELECT part_number, part_description, quantity_sold, unit, unit_price, line_amount
      FROM salesorderlineitems 
      WHERE sales_order_id = $1
      ORDER BY part_number
    `;
    
    const lineItemsResult = await client.query(lineItemsQuery, [salesOrder.sales_order_id]);
    console.log('📊 Line Items:');
    
    for (const item of lineItemsResult.rows) {
      console.log(`  ${item.part_number}:`);
      console.log(`    Quantity: ${item.quantity_sold} ${item.unit}`);
      console.log(`    Unit Price: $${item.unit_price}`);
      console.log(`    Line Amount: $${item.line_amount}`);
      console.log(`    Expected: $${(item.quantity_sold * item.unit_price).toFixed(2)}`);
      console.log('');
    }
    
    // Get time entries for this sales order
    const timeEntriesQuery = `
      SELECT duration, unit_price, (duration * unit_price) as calculated_cost
      FROM time_entries 
      WHERE sales_order_id = $1 AND clock_out IS NOT NULL
      ORDER BY clock_in
    `;
    
    const timeEntriesResult = await client.query(timeEntriesQuery, [salesOrder.sales_order_id]);
    console.log('⏰ Time Entries:');
    
    let totalHours = 0;
    let totalCost = 0;
    let rateCount = 0;
    
    for (const entry of timeEntriesResult.rows) {
      console.log(`  Duration: ${entry.duration} hours, Rate: $${entry.unit_price}/hour, Cost: $${entry.calculated_cost}`);
      totalHours += parseFloat(entry.duration);
      totalCost += parseFloat(entry.calculated_cost);
      rateCount++;
    }
    
    if (rateCount > 0) {
      const avgRate = totalCost / totalHours;
      console.log(`\n📈 Summary:`);
      console.log(`  Total Hours: ${totalHours.toFixed(2)}`);
      console.log(`  Average Rate: $${avgRate.toFixed(2)}/hour`);
      console.log(`  Total Cost: $${totalCost.toFixed(2)}`);
      console.log(`  Expected Labour Amount: ${totalHours.toFixed(2)} × $${avgRate.toFixed(2)} = $${(totalHours * avgRate).toFixed(2)}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

debugCalculation();

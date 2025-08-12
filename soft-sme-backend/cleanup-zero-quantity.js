const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'soft_sme_db',
  password: process.env.DB_PASSWORD || '123',
  port: parseInt(process.env.DB_PORT || '5432', 10),
});

async function cleanupZeroQuantity() {
  const client = await pool.connect();
  try {
    console.log('Starting cleanup of zero quantity sales order line items...');
    
    await client.query('BEGIN');
    
    // 1. Delete sales order line items with quantity_sold = 0 (excluding LABOUR and OVERHEAD)
    const deleteResult = await client.query(`
      DELETE FROM salesorderlineitems 
      WHERE quantity_sold = 0 
      AND part_number NOT IN ('LABOUR', 'OVERHEAD')
      RETURNING sales_order_id, part_number, quantity_sold
    `);
    
    console.log(`Deleted ${deleteResult.rows.length} line items with zero quantity:`, deleteResult.rows);
    
    // 2. Recalculate aggregated parts to order
    const aggregatedResult = await client.query(`
      SELECT 
        soli.part_number,
        soli.part_description,
        SUM(soli.quantity_sold) as total_quantity_needed,
        soli.unit,
        i.last_unit_cost as unit_price,
        SUM(soli.quantity_sold) * i.last_unit_cost as total_line_amount
      FROM salesorderlineitems soli
      JOIN salesorderhistory soh ON soli.sales_order_id = soh.sales_order_id
      LEFT JOIN inventory i ON soli.part_number = i.part_number
      WHERE soh.status = 'Open'
        AND soli.part_number NOT IN ('LABOUR', 'OVERHEAD')
        AND soli.quantity_sold > 0
      GROUP BY soli.part_number, soli.part_description, soli.unit, i.last_unit_cost
      ORDER BY soli.part_number
    `);
    
    console.log(`Found ${aggregatedResult.rows.length} parts with non-zero quantities needed`);
    
    // 3. Clear the aggregated_parts_to_order table
    await client.query('DELETE FROM aggregated_parts_to_order');
    console.log('Cleared aggregated_parts_to_order table');
    
    // 4. Insert only parts with non-zero quantities
    for (const row of aggregatedResult.rows) {
      if (parseFloat(row.total_quantity_needed) > 0) {
        await client.query(`
          INSERT INTO aggregated_parts_to_order (
            part_number, part_description, total_quantity_needed, unit, unit_price, 
            total_line_amount, min_required_quantity
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          row.part_number,
          row.part_description || '',
          row.total_quantity_needed,
          row.unit || 'Each',
          row.unit_price || 0,
          row.total_line_amount || 0,
          row.total_quantity_needed
        ]);
        console.log(`Added part ${row.part_number} with quantity ${row.total_quantity_needed}`);
      }
    }
    
    await client.query('COMMIT');
    console.log('Cleanup completed successfully!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Cleanup failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

cleanupZeroQuantity(); 
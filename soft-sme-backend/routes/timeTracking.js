const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'soft_sme_db',
  password: '123',
  port: 5432,
});

// Get all profiles
router.get('/profiles', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM profiles ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching profiles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new profile
router.post('/profiles', async (req, res) => {
  const { name, email } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO profiles (name, email) VALUES ($1, $2) RETURNING *',
      [name, email]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating profile:', error);
    if (error.code === '23505') { // Unique violation
      res.status(400).json({ error: 'Email already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Get open sales orders with their default hourly rates
router.get('/sales-orders', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        sales_order_id as id,
        sales_order_number as number,
        COALESCE(default_hourly_rate, 0.00) as default_hourly_rate
      FROM salesorderhistory 
      WHERE status = 'In Progress'
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching sales orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update sales order hourly rate
router.patch('/sales-orders/:id', async (req, res) => {
  const { id } = req.params;
  const { default_hourly_rate } = req.body;
  try {
    const result = await pool.query(
      'UPDATE salesorderhistory SET default_hourly_rate = $1 WHERE sales_order_id = $2 RETURNING *',
      [default_hourly_rate, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sales order not found' });
    }
    // Return updated list of sales orders
    const allOrders = await pool.query(
      'SELECT sales_order_id as id, sales_order_number as number, COALESCE(default_hourly_rate, 0.00) as default_hourly_rate FROM salesorderhistory WHERE status = \'Open\' ORDER BY created_at DESC'
    );
    res.json({ updated: result.rows[0], all: allOrders.rows });
  } catch (error) {
    console.error('Error updating sales order rate:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clock in
router.post('/time-entries/clock-in', async (req, res) => {
  const { profile_id, so_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if the user is already clocked in to any sales order
    const openEntryResult = await client.query(
      'SELECT * FROM time_entries WHERE profile_id = $1 AND clock_out IS NULL',
      [profile_id]
    );
    if (openEntryResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You are already clocked in to a sales order. Please clock out before clocking in again.' });
    }

    // Get the default hourly rate from the sales order
    const soResult = await client.query(
      'SELECT default_hourly_rate FROM salesorderhistory WHERE sales_order_id = $1',
      [so_id]
    );

    if (soResult.rows.length === 0) {
      throw new Error('Sales order not found');
    }

    const default_hourly_rate = soResult.rows[0].default_hourly_rate;

    // Create the time entry
    const result = await client.query(
      `INSERT INTO time_entries 
       (profile_id, sales_order_id, clock_in, unit_price) 
       VALUES ($1, $2, CURRENT_TIMESTAMP, $3) 
       RETURNING *`,
      [profile_id, so_id, default_hourly_rate]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error clocking in:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Clock out
router.post('/time-entries/:id/clock-out', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get the time entry
    const timeEntryResult = await client.query(
      'SELECT * FROM time_entries WHERE id = $1',
      [id]
    );

    if (timeEntryResult.rows.length === 0) {
      throw new Error('Time entry not found');
    }

    const timeEntry = timeEntryResult.rows[0];
    const clockOutTime = new Date();
    const duration = (clockOutTime - new Date(timeEntry.clock_in)) / (1000 * 60 * 60); // in hours

    // Update the time entry
    const updateResult = await client.query(
      `UPDATE time_entries 
       SET clock_out = CURRENT_TIMESTAMP, duration = $1 
       WHERE id = $2 
       RETURNING *`,
      [duration, id]
    );

    // Create labour line item
    await client.query(
      `INSERT INTO labour_line_items 
       (sales_order_id, date, quantity, unit_price, total) 
       VALUES ($1, CURRENT_DATE, $2, $3, $4)`,
      [
        timeEntry.sales_order_id,
        duration,
        timeEntry.unit_price,
        duration * timeEntry.unit_price
      ]
    );

    // --- Upsert 'Labour' line item in salesorderlineitems ---
    // Sum all labour_line_items for this sales order
    const sumResult = await client.query(
      `SELECT 
         SUM(quantity) as total_quantity, 
         AVG(unit_price) as avg_unit_price, 
         SUM(total) as total_amount 
       FROM labour_line_items WHERE sales_order_id = $1`,
      [timeEntry.sales_order_id]
    );
    const total_quantity = parseFloat(sumResult.rows[0].total_quantity) || 0;
    const avg_unit_price = parseFloat(sumResult.rows[0].avg_unit_price) || 0;
    const total_amount = parseFloat(sumResult.rows[0].total_amount) || 0;

    // Check if a 'Labour' line item exists
    const labourLineItemResult = await client.query(
      `SELECT * FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = 'LABOUR'`,
      [timeEntry.sales_order_id]
    );
    if (labourLineItemResult.rows.length > 0) {
      // Update existing
      await client.query(
        `UPDATE salesorderlineitems SET 
           part_description = $1, 
           quantity_sold = $2, 
           unit = $3, 
           unit_price = $4, 
           line_amount = $5 
         WHERE sales_order_id = $6 AND part_number = 'LABOUR'`,
        [
          'Labour Hours',
          total_quantity,
          'Hours',
          avg_unit_price,
          total_amount,
          timeEntry.sales_order_id
        ]
      );
    } else if (total_quantity > 0) {
      // Insert new
      await client.query(
        `INSERT INTO salesorderlineitems 
           (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount) 
         VALUES ($1, 'LABOUR', $2, $3, $4, $5, $6)`,
        [
          timeEntry.sales_order_id,
          'Labour Hours',
          total_quantity,
          'Hours',
          avg_unit_price,
          total_amount
        ]
      );
    }

    await client.query('COMMIT');
    res.json(updateResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error clocking out:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get time entries for a specific date
router.get('/time-entries', async (req, res) => {
  const { date } = req.query;
  try {
    const result = await pool.query(
      `SELECT te.*, p.name as profile_name, so.sales_order_number 
       FROM time_entries te
       JOIN profiles p ON te.profile_id = p.id
       JOIN salesorderhistory so ON te.sales_order_id = so.sales_order_id
       WHERE DATE(te.clock_in) = $1
       ORDER BY te.clock_in DESC`,
      [date]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching time entries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get time entry report
router.get('/reports/time-entries', async (req, res) => {
  const { from, to, profile, so } = req.query;
  try {
    let query = `
      SELECT 
        te.*,
        p.name as profile_name,
        so.sales_order_number,
        DATE(te.clock_in) as date
      FROM time_entries te
      JOIN profiles p ON te.profile_id = p.id
      JOIN salesorderhistory so ON te.sales_order_id = so.sales_order_id
      WHERE DATE(te.clock_in) BETWEEN $1 AND $2
    `;
    const params = [from, to];

    if (profile && profile !== '') {
      query += ' AND te.profile_id = $' + (params.length + 1);
      params.push(profile);
    }
    if (so && so !== '') {
      query += ' AND te.sales_order_id = $' + (params.length + 1);
      params.push(so);
    }

    query += ' ORDER BY te.clock_in DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error generating time entry report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export time entry report
router.get('/reports/time-entries/export', async (req, res) => {
  const { from, to, profile, so, format } = req.query;
  try {
    let query = `
      SELECT 
        DATE(te.clock_in) as date,
        p.name as profile_name,
        so.sales_order_number,
        te.clock_in,
        te.clock_out,
        te.duration,
        te.unit_price,
        (te.duration * te.unit_price) as total
      FROM time_entries te
      JOIN profiles p ON te.profile_id = p.id
      JOIN salesorderhistory so ON te.sales_order_id = so.sales_order_id
      WHERE DATE(te.clock_in) BETWEEN $1 AND $2
    `;
    const params = [from, to];

    if (profile && profile !== '') {
      query += ' AND te.profile_id = $' + (params.length + 1);
      params.push(profile);
    }
    if (so && so !== '') {
      query += ' AND te.sales_order_id = $' + (params.length + 1);
      params.push(so);
    }

    query += ' ORDER BY te.clock_in DESC';

    const result = await pool.query(query, params);

    if (format === 'csv') {
      // Generate CSV
      const csv = result.rows.map(row => {
        return [
          row.date,
          row.profile_name,
          row.sales_order_number,
          row.clock_in,
          row.clock_out,
          row.duration,
          row.unit_price,
          row.total
        ].join(',');
      }).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=time-entries-${from}-to-${to}.csv`);
      res.send(csv);
    } else if (format === 'pdf') {
      // Generate PDF
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument();
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=time-entries-${from}-to-${to}.pdf`);
      
      doc.pipe(res);
      
      // Add title
      doc.fontSize(16).text('Time Entries Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Period: ${from} to ${to}`, { align: 'center' });
      doc.moveDown();

      // Add table headers
      const headers = ['Date', 'Profile', 'SO #', 'Clock In', 'Clock Out', 'Duration', 'Rate', 'Total'];
      let y = doc.y;
      headers.forEach((header, i) => {
        doc.text(header, 50 + (i * 60), y);
      });
      doc.moveDown();

      // Add table rows
      result.rows.forEach(row => {
        y = doc.y;
        doc.text(row.date, 50, y);
        doc.text(row.profile_name, 110, y);
        doc.text(row.sales_order_number, 170, y);
        doc.text(new Date(row.clock_in).toLocaleTimeString(), 230, y);
        doc.text(row.clock_out ? new Date(row.clock_out).toLocaleTimeString() : '-', 290, y);
        doc.text(
          row.duration !== null && row.duration !== undefined
            ? Number(row.duration).toFixed(2)
            : '-',
          350, y
        );
        doc.text(
          row.unit_price !== null && row.unit_price !== undefined
            ? Number(row.unit_price).toFixed(2)
            : '-',
          410, y
        );
        doc.text(
          row.total !== null && row.total !== undefined
            ? Number(row.total).toFixed(2)
            : '-',
          470, y
        );
        doc.moveDown();
      });

      doc.end();
    } else {
      res.status(400).json({ error: 'Invalid format specified' });
    }
  } catch (error) {
    console.error('Error exporting time entry report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get labour line items for a sales order
router.get('/labour-line-items/:salesOrderId', async (req, res) => {
  const { salesOrderId } = req.params;
  try {
    const result = await pool.query(
      `SELECT * FROM labour_line_items 
       WHERE sales_order_id = $1 
       ORDER BY date DESC, created_at DESC`,
      [salesOrderId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching labour line items:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router; 

import express, { Request, Response } from 'express';
import { pool } from '../db';

const router = express.Router();

// Get time entries for a given date
router.get('/time-entries', async (req: Request, res: Response) => {
  const { date, profile_id } = req.query;

  if (!date) {
    return res.status(400).json({ error: 'Date query parameter is required' });
  }

  try {
    let query = `SELECT
      te.id,
      te.profile_id,
      p.name as profile_name,
      te.sales_order_id,
      soh.sales_order_number,
      te.clock_in,
      te.clock_out,
      te.duration,
      te.unit_price
    FROM
      time_entries te
    JOIN
      profiles p ON te.profile_id = p.id
    JOIN
      salesorderhistory soh ON te.sales_order_id = soh.sales_order_id
    WHERE
      te.clock_in::date = $1`;
    const params: any[] = [date];
    if (profile_id) {
      query += ' AND te.profile_id = $2';
      params.push(profile_id);
    }
    query += ' ORDER BY te.clock_in DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching time entries:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clock-in
router.post('/time-entries/clock-in', async (req: Request, res: Response) => {
  const { profile_id, so_id } = req.body;

  if (!profile_id || !so_id) {
    return res.status(400).json({ error: 'Profile ID and Sales Order ID are required' });
  }

  try {
    // Get global labour rate
    const rateRes = await pool.query("SELECT value FROM global_settings WHERE key = 'labour_rate'");
    const unit_price = rateRes.rows.length > 0 ? parseFloat(rateRes.rows[0].value) : 0;

    const result = await pool.query(
      'INSERT INTO time_entries (profile_id, sales_order_id, clock_in, unit_price) VALUES ($1, $2, NOW(), $3) RETURNING *',
      [profile_id, so_id, unit_price]
    );
    
    // Fetch newly created entry with joins for the response
    const newEntryRes = await pool.query(
      `SELECT
        te.id, te.profile_id, p.name as profile_name, te.sales_order_id, soh.sales_order_number,
        te.clock_in, te.clock_out, te.duration, te.unit_price
      FROM time_entries te
      JOIN profiles p ON te.profile_id = p.id
      JOIN salesorderhistory soh ON te.sales_order_id = soh.sales_order_id
      WHERE te.id = $1`,
      [result.rows[0].id]
    );

    res.status(201).json(newEntryRes.rows[0]);
  } catch (err) {
    console.error('Error clocking in:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clock-out
router.post('/time-entries/:id/clock-out', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const clockOutRes = await pool.query(
      'UPDATE time_entries SET clock_out = NOW(), duration = EXTRACT(EPOCH FROM (NOW() - clock_in)) / 3600 WHERE id = $1 AND clock_out IS NULL RETURNING *',
      [id]
    );

    if (clockOutRes.rows.length === 0) {
      return res.status(404).json({ error: 'Time entry not found or already clocked out' });
    }
    
    // Fetch updated entry with joins for the response
    const updatedEntryRes = await pool.query(
      `SELECT
        te.id, te.profile_id, p.name as profile_name, te.sales_order_id, soh.sales_order_number,
        te.clock_in, te.clock_out, te.duration, te.unit_price
      FROM time_entries te
      JOIN profiles p ON te.profile_id = p.id
      JOIN salesorderhistory soh ON te.sales_order_id = soh.sales_order_id
      WHERE te.id = $1`,
      [id]
    );

    // Upsert LABOUR line item for the sales order
    const salesOrderIdRes = await pool.query('SELECT sales_order_id FROM time_entries WHERE id = $1', [id]);
    if (salesOrderIdRes.rows.length > 0) {
      const soId = salesOrderIdRes.rows[0].sales_order_id;
      // Sum all durations and costs for this sales order
      const sumRes = await pool.query(
        `SELECT SUM(duration) as total_hours, AVG(unit_price) as avg_rate, SUM(duration * unit_price) as total_cost
         FROM time_entries WHERE sales_order_id = $1 AND clock_out IS NOT NULL`,
        [soId]
      );
      const totalHours = parseFloat(sumRes.rows[0].total_hours) || 0;
      const avgRate = parseFloat(sumRes.rows[0].avg_rate) || 0;
      const totalCost = parseFloat(sumRes.rows[0].total_cost) || 0;
      // Check if LABOUR line item exists
      const labourRes = await pool.query(
        `SELECT sales_order_line_item_id FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = 'LABOUR'`,
        [soId]
      );
      if (labourRes.rows.length > 0) {
        // Update
        await pool.query(
          `UPDATE salesorderlineitems SET part_description = $1, quantity_sold = $2, unit = $3, unit_price = $4, line_amount = $5 WHERE sales_order_id = $6 AND part_number = 'LABOUR'`,
          ['Labour Hours', totalHours, 'hr', avgRate, totalCost, soId]
        );
      } else {
        // Insert
        await pool.query(
          `INSERT INTO salesorderlineitems (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount)
           VALUES ($1, 'LABOUR', $2, $3, $4, $5, $6)` ,
          [soId, 'Labour Hours', totalHours, 'hr', avgRate, totalCost]
        );
      }
    }

    res.json(updatedEntryRes.rows[0]);
  } catch (err) {
    console.error('Error clocking out:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all time tracking entries for the current user's company
router.get('/', async (req: Request, res: Response) => {
  try {
    const company_id = req.user?.company_id;
    const result = await pool.query(
      'SELECT * FROM TimeTrackingEntries WHERE company_id = $1 ORDER BY start_time DESC',
      [company_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('timeTrackingRoutes: Error fetching entries:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new time tracking entry
router.post('/', async (req: Request, res: Response) => {
  const { user_id, start_time, end_time, task_description } = req.body;
  try {
    const company_id = req.user?.company_id;
    const result = await pool.query(
      'INSERT INTO TimeTrackingEntries (user_id, company_id, start_time, end_time, task_description) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [user_id, company_id, start_time, end_time, task_description]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('timeTrackingRoutes: Error creating entry:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/profiles', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email FROM profiles ORDER BY name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching profiles:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/profiles', async (req: Request, res: Response) => {
  const { name, email } = req.body;

  try {
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const result = await pool.query(
      'INSERT INTO profiles (name, email) VALUES ($1, $2) RETURNING *',
      [name, email]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating profile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/sales-orders', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT sales_order_id as id, sales_order_number as number FROM salesorderhistory WHERE status = 'Open' ORDER BY sales_order_number"
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching sales orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all open (not clocked out) time entries for a profile
router.get('/time-entries/open', async (req: Request, res: Response) => {
  const { profile_id } = req.query;
  if (!profile_id) {
    return res.status(400).json({ error: 'profile_id query parameter is required' });
  }
  try {
    const result = await pool.query(
      `SELECT te.*, soh.sales_order_number, soh.product_name
       FROM time_entries te
       JOIN salesorderhistory soh ON te.sales_order_id = soh.sales_order_id
       WHERE te.profile_id = $1 AND te.clock_out IS NULL
       ORDER BY te.clock_in DESC`,
      [profile_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching open time entries:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add the correct /reports/time-entries endpoint
router.get('/reports/time-entries', async (req: Request, res: Response) => {
  const { from, to, profile, so } = req.query;
  try {
    console.log('Time entry report request:', { from, to, profile, so });
    
    let query = `
      SELECT 
        te.*,
        p.name as profile_name,
        soh.sales_order_number,
        DATE(te.clock_in) as date
      FROM time_entries te
      JOIN profiles p ON te.profile_id = p.id
      JOIN salesorderhistory soh ON te.sales_order_id = soh.sales_order_id
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

    console.log('Executing query:', query);
    console.log('Query parameters:', params);
    
    const result = await pool.query(query, params);
    console.log('Query result count:', result.rows.length);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error generating time entry report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 
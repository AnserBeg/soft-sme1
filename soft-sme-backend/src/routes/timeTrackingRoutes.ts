import express, { Request, Response } from 'express';
import { pool } from '../db';
import PDFDocument from 'pdfkit';
import Papa from 'papaparse';

const router = express.Router();

// Role-based access middleware
function mobileTimeTrackerOnly(req: Request, res: Response, next: Function) {
  if (
    req.user?.access_role === 'Mobile Time Tracker' ||
    req.user?.access_role === 'Time Tracking' ||
    req.user?.access_role === 'Admin'
  ) {
    return next();
  }
  return res.status(403).json({ message: 'Not authorized' });
}

// Apply the middleware to all routes in this router
router.use(mobileTimeTrackerOnly);

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

  console.log('Clock out route hit for ID:', id);

  try {
    const clockOutRes = await pool.query(
      'UPDATE time_entries SET clock_out = NOW(), duration = EXTRACT(EPOCH FROM (NOW() - clock_in)) / 3600 WHERE id = $1 AND clock_out IS NULL RETURNING *',
      [id]
    );

    console.log('Clock out DB result:', clockOutRes.rows);

    if (clockOutRes.rows.length === 0) {
      console.log('No open time entry found for ID:', id);
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

// Edit a time entry (clock_in and clock_out)
router.put('/time-entries/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  let { clock_in, clock_out } = req.body;
  try {
    // Convert empty strings to null
    if (!clock_in || clock_in === '') clock_in = null;
    if (!clock_out || clock_out === '') clock_out = null;

    const result = await pool.query(
      `UPDATE time_entries
       SET clock_in = $1::timestamptz,
           clock_out = $2::timestamptz,
           duration = CASE
             WHEN $1 IS NOT NULL AND $2 IS NOT NULL THEN EXTRACT(EPOCH FROM ($2::timestamptz - $1::timestamptz)) / 3600
             ELSE duration
           END
       WHERE id = $3
       RETURNING *`,
      [clock_in, clock_out, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Time entry not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating time entry:', err);
    res.status(500).json({ error: 'Internal server error', details: (err as Error).message });
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

// Export time entry report
router.get('/reports/time-entries/export', async (req: Request, res: Response) => {
  console.log('Time tracking report export endpoint hit');
  const { from, to, profile, format } = req.query;
  
  try {
    // 1. Query all time entries for the range/profile
    let query = `
      SELECT 
        te.*, p.name as profile_name, soh.sales_order_number, DATE(te.clock_in) as date
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
    query += ' ORDER BY te.clock_in DESC';
    const result = await pool.query(query, params);
    const timeEntries = result.rows;

    // 2. Compute shift/idle summary and per-shift breakdowns
    // Query all shifts for the range/profile
    let shiftQuery = `SELECT * FROM attendance_shifts WHERE clock_in >= $1 AND clock_in < ($2::date + INTERVAL '1 day')`;
    const shiftParams = [from, to];
    if (profile && profile !== '') {
      shiftQuery += ' AND profile_id = $3';
      shiftParams.push(profile);
    }
    shiftQuery += ' ORDER BY clock_in DESC';
    const shiftResult = await pool.query(shiftQuery, shiftParams);
    const shifts = shiftResult.rows;

    // Group time entries by shift
    const shiftEntryMap: { [shiftId: number]: any[] } = {};
    const unscheduled: any[] = [];
    shifts.forEach(shift => { shiftEntryMap[shift.id] = []; });
    timeEntries.forEach(entry => {
      const entryIn = new Date(entry.clock_in).getTime();
      let found = false;
      for (const shift of shifts) {
        const shiftIn = new Date(shift.clock_in).getTime();
        const shiftOut = shift.clock_out ? new Date(shift.clock_out).getTime() : null;
        if (shiftOut && entryIn >= shiftIn && entryIn < shiftOut) {
          shiftEntryMap[shift.id].push(entry);
          found = true;
          break;
        }
      }
      if (!found) unscheduled.push(entry);
    });

    // Compute shift/idle summary by profile
    const profileShiftStats: { [profileId: number]: { hours: number, idle: number } } = {};
    shifts.forEach(shift => {
      if (shift.clock_in && shift.clock_out) {
        const inTime = new Date(shift.clock_in).getTime();
        const outTime = new Date(shift.clock_out).getTime();
        const dur = Math.max(0, (outTime - inTime) / (1000 * 60 * 60));
        const entries = (shiftEntryMap[shift.id] || []);
        let booked = 0;
        entries.forEach(e => {
          const entryDur = typeof e.duration === 'number' ? e.duration : Number(e.duration) || 0;
          booked += entryDur;
        });
        const idle = Math.max(0, dur - booked);
        if (!profileShiftStats[shift.profile_id]) profileShiftStats[shift.profile_id] = { hours: 0, idle: 0 };
        profileShiftStats[shift.profile_id].hours += dur;
        profileShiftStats[shift.profile_id].idle += idle;
      }
    });

    // 3. Build CSV sections
    if (format === 'csv') {
      let csvSections: string[] = [];
      // Section 1: Shift/Idle Summary
      csvSections.push('Shift/Idle Summary by Profile');
      csvSections.push('Profile,Total Shift Hours,Total Idle Hours');
      for (const [profileId, stats] of Object.entries(profileShiftStats)) {
        const profileName = timeEntries.find(e => String(e.profile_id) === String(profileId))?.profile_name || profileId;
        csvSections.push(`${profileName},${stats.hours.toFixed(2)},${stats.idle.toFixed(2)}`);
      }
      csvSections.push('');
      // Section 2: Per-Shift Breakdown
      csvSections.push('Per-Shift Breakdown');
      csvSections.push('Profile,Date,Shift In,Shift Out,Shift Duration (hrs),Sales Order,Booked Hours,Idle (hrs)');
      for (const shift of shifts) {
        const shiftIn = shift.clock_in ? new Date(shift.clock_in) : null;
        const shiftOut = shift.clock_out ? new Date(shift.clock_out) : null;
        const shiftDuration = shiftIn && shiftOut ? ((shiftOut.getTime() - shiftIn.getTime()) / (1000 * 60 * 60)) : 0;
        const entries = shiftEntryMap[shift.id] || [];
        // Group by sales order
        const soMap: { [so: string]: number } = {};
        let booked = 0;
        entries.forEach(e => {
          const so = e.sales_order_number || 'Unknown';
          const dur = typeof e.duration === 'number' ? e.duration : Number(e.duration) || 0;
          soMap[so] = (soMap[so] || 0) + dur;
          booked += dur;
        });
        const idle = Math.max(0, shiftDuration - booked);
        const profileName = entries[0]?.profile_name || shift.profile_id;
        if (Object.keys(soMap).length === 0) {
          csvSections.push(`${profileName},${shiftIn ? shiftIn.toLocaleDateString() : ''},${shiftIn ? shiftIn.toLocaleTimeString() : ''},${shiftOut ? shiftOut.toLocaleTimeString() : ''},${shiftDuration.toFixed(2)},,,${idle.toFixed(3)}`);
        } else {
          for (const [so, hrs] of Object.entries(soMap)) {
            csvSections.push(`${profileName},${shiftIn ? shiftIn.toLocaleDateString() : ''},${shiftIn ? shiftIn.toLocaleTimeString() : ''},${shiftOut ? shiftOut.toLocaleTimeString() : ''},${shiftDuration.toFixed(2)},${so},${Number(hrs).toFixed(3)},${idle.toFixed(3)}`);
          }
        }
      }
      csvSections.push('');
      // Section 3: Unscheduled Entries
      csvSections.push('Unscheduled Entries');
      csvSections.push('Sales Order,Clock In,Clock Out,Duration');
      for (const entry of unscheduled) {
        csvSections.push(`${entry.sales_order_number || ''},${entry.clock_in ? new Date(entry.clock_in).toLocaleTimeString() : ''},${entry.clock_out ? new Date(entry.clock_out).toLocaleTimeString() : ''},${entry.duration !== null && entry.duration !== undefined && !isNaN(Number(entry.duration)) ? Number(entry.duration).toFixed(3) : ''}`);
      }
      csvSections.push('');
      // Section 4: Full Time Entry Table
      csvSections.push('Full Time Entry Table');
      csvSections.push('Profile,Sales Order,Date,Clock In,Clock Out,Duration');
      for (const entry of timeEntries) {
        csvSections.push(`${entry.profile_name || ''},${entry.sales_order_number || ''},${entry.date ? new Date(entry.date).toLocaleDateString() : ''},${entry.clock_in ? new Date(entry.clock_in).toLocaleTimeString() : ''},${entry.clock_out ? new Date(entry.clock_out).toLocaleTimeString() : ''},${entry.duration !== null && entry.duration !== undefined && !isNaN(Number(entry.duration)) ? Number(entry.duration).toFixed(3) : ''}`);
      }
      const csv = csvSections.join('\n');
      const filename = `time_entries_report_${new Date().toISOString().split('T')[0]}.csv`;
      res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-type', 'text/csv');
      res.send(csv);
      return;
    }

    if (format === 'pdf') {
      // Generate PDF
      const doc = new PDFDocument({ margin: 50 });
      const filename = `time_entries_report_${new Date().toISOString().split('T')[0]}.pdf`;
      res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-type', 'application/pdf');
      doc.pipe(res);

      // Header
      doc.font('Helvetica-Bold').fontSize(20).text('Time Entries Report', { align: 'center' });
      doc.moveDown();
      doc.font('Helvetica').fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
      doc.moveDown();
      doc.font('Helvetica').fontSize(10).text(`Date Range: ${from} to ${to}`, { align: 'center' });
      doc.moveDown(2);

      // Table headers
      const headers = ['Profile', 'Sales Order', 'Date', 'Clock In', 'Clock Out', 'Duration (hrs)'];
      const columnWidths = [100, 120, 80, 80, 80, 80];
      let y = doc.y;

      // Draw header row
      doc.font('Helvetica-Bold').fontSize(9);
      let x = 50;
      headers.forEach((header, index) => {
        doc.text(header, x, y, { width: columnWidths[index] });
        x += columnWidths[index];
      });

      y += 20;
      doc.moveTo(50, y).lineTo(550, y).stroke();

      // Draw data rows
      doc.font('Helvetica').fontSize(8);
      timeEntries.forEach((entry, index) => {
        if (y > doc.page.height - 100) {
          doc.addPage();
          y = 50;
        }

        x = 50;
        doc.text(entry.profile_name || '', x, y, { width: columnWidths[0] });
        x += columnWidths[0];
        doc.text(entry.sales_order_number || '', x, y, { width: columnWidths[1] });
        x += columnWidths[1];
        
        const date = entry.date ? new Date(entry.date).toLocaleDateString() : '';
        doc.text(date, x, y, { width: columnWidths[2] });
        x += columnWidths[2];
        
        const clockIn = entry.clock_in ? new Date(entry.clock_in).toLocaleTimeString() : '';
        doc.text(clockIn, x, y, { width: columnWidths[3] });
        x += columnWidths[3];
        
        const clockOut = entry.clock_out ? new Date(entry.clock_out).toLocaleTimeString() : '-';
        doc.text(clockOut, x, y, { width: columnWidths[4] });
        x += columnWidths[4];
        
        const duration = entry.duration && !isNaN(Number(entry.duration)) ? Number(entry.duration).toFixed(2) : '-';
        doc.text(duration, x, y, { width: columnWidths[5] });

        y += 15;
        
        // Draw row separator
        doc.moveTo(50, y).lineTo(550, y).stroke();
        y += 5;
      });

      doc.end();
    } else {
      // Generate CSV
      const csvData = timeEntries.map(entry => ({
        Profile: entry.profile_name || '',
        'Sales Order': entry.sales_order_number || '',
        Date: entry.date ? new Date(entry.date).toLocaleDateString() : '',
        'Clock In': entry.clock_in ? new Date(entry.clock_in).toLocaleTimeString() : '',
        'Clock Out': entry.clock_out ? new Date(entry.clock_out).toLocaleTimeString() : '',
        'Duration (hrs)': entry.duration && !isNaN(Number(entry.duration)) ? Number(entry.duration).toFixed(2) : ''
      }));

      const csv = Papa.unparse(csvData);
      const filename = `time_entries_report_${new Date().toISOString().split('T')[0]}.csv`;
      
      res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-type', 'text/csv');
      res.send(csv);
    }
  } catch (error) {
    const err = error as Error;
    console.error('Error exporting time entry report:', err);
    res.status(500).json({ error: 'Internal server error during export', details: err.message, stack: err.stack });
  }
});

export default router; 
import express, { Request, Response } from 'express';
import { pool } from '../db';

// Helper function to calculate effective duration, excluding daily break times
function calculateEffectiveDuration(clockIn: Date, clockOut: Date, breakStartStr: string | null, breakEndStr: string | null): number {
  let durationMs = clockOut.getTime() - clockIn.getTime();

  if (breakStartStr && breakEndStr) {
    const breakStartParts = breakStartStr.split(':').map(Number);
    const breakEndParts = breakEndStr.split(':').map(Number);

    const breakStartTime = new Date(clockIn);
    breakStartTime.setHours(breakStartParts[0], breakStartParts[1], 0, 0);

    const breakEndTime = new Date(clockIn);
    breakEndTime.setHours(breakEndParts[0], breakEndParts[1], 0, 0);

    // Handle overnight breaks (e.g., 23:00 - 01:00)
    if (breakEndTime.getTime() < breakStartTime.getTime()) {
      breakEndTime.setDate(breakEndTime.getDate() + 1);
    }

    // Check if shift spans multiple days
    const isMultiDayShift = clockOut.getDate() !== clockIn.getDate() || 
                           clockOut.getMonth() !== clockIn.getMonth() || 
                           clockOut.getFullYear() !== clockIn.getFullYear();

    if (isMultiDayShift) {
      // Multi-day shift - handle breaks for each day
      const clockInDay = new Date(clockIn.getFullYear(), clockIn.getMonth(), clockIn.getDate());
      const clockOutDay = new Date(clockOut.getFullYear(), clockOut.getMonth(), clockOut.getDate());
      const daysDiff = Math.round((clockOutDay.getTime() - clockInDay.getTime()) / (1000 * 60 * 60 * 24));

      // For each day the shift spans, check for break overlap
      for (let i = 0; i <= daysDiff; i++) {
        const currentDayBreakStart = new Date(breakStartTime);
        currentDayBreakStart.setDate(clockIn.getDate() + i);
        const currentDayBreakEnd = new Date(breakEndTime);
        currentDayBreakEnd.setDate(clockIn.getDate() + i);

        // Calculate overlap with work time
        const overlapStart = Math.max(clockIn.getTime(), currentDayBreakStart.getTime());
        const overlapEnd = Math.min(clockOut.getTime(), currentDayBreakEnd.getTime());

        if (overlapEnd > overlapStart) {
          const breakDurationMs = overlapEnd - overlapStart;
          durationMs -= breakDurationMs;
          console.log(`Break deducted: ${breakDurationMs / (1000 * 60)} minutes for day ${i + 1}`);
        }
      }
    } else {
      // Single day shift
      const overlapStart = Math.max(clockIn.getTime(), breakStartTime.getTime());
      const overlapEnd = Math.min(clockOut.getTime(), breakEndTime.getTime());

      if (overlapEnd > overlapStart) {
        const breakDurationMs = overlapEnd - overlapStart;
        durationMs -= breakDurationMs;
        console.log(`Break deducted: ${breakDurationMs / (1000 * 60)} minutes`);
      }
    }
  }

  // Convert to hours and ensure non-negative
  const durationHours = Math.max(0, durationMs / (1000 * 60 * 60));
  
  // Round to 2 decimal places for consistency
  return Math.round(durationHours * 100) / 100;
}

const router = express.Router();

// List/filter shifts
router.get('/', async (req: Request, res: Response) => {
  try {
    const { profile_id, from, to } = req.query;
    let query = `
      SELECT 
        s.*,
        p.name as profile_name,
        p.email as profile_email
      FROM attendance_shifts s
      LEFT JOIN profiles p ON s.profile_id = p.id
    `;
    const params: any[] = [];
    const conditions: string[] = [];
    if (profile_id) {
      conditions.push('s.profile_id = $' + (params.length + 1));
      params.push(profile_id);
    }
    if (from) {
      conditions.push('s.clock_in >= $' + (params.length + 1));
      params.push(from);
    }
    if (to) {
      conditions.push('s.clock_in <= $' + (params.length + 1));
      params.push(to);
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY s.clock_in DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('attendanceRoutes: Error fetching shifts:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clock in
router.post('/clock-in', async (req: Request, res: Response) => {
  const { profile_id } = req.body;
  try {
    // Prevent multiple open shifts
    const open = await pool.query('SELECT * FROM attendance_shifts WHERE profile_id = $1 AND clock_out IS NULL', [profile_id]);
    if (open.rows.length > 0) {
      return res.status(400).json({ error: 'Already clocked in. Please clock out first.' });
    }
    const result = await pool.query(
      'INSERT INTO attendance_shifts (profile_id, clock_in) VALUES ($1, NOW()) RETURNING *',
      [profile_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('attendanceRoutes: Error clocking in:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clock out
router.post('/clock-out', async (req: Request, res: Response) => {
  const { shift_id } = req.body;
  try {
    // Get daily break times
    const breakStartRes = await pool.query("SELECT value FROM global_settings WHERE key = 'daily_break_start'");
    const breakEndRes = await pool.query("SELECT value FROM global_settings WHERE key = 'daily_break_end'");
    const dailyBreakStart = breakStartRes.rows.length > 0 ? breakStartRes.rows[0].value : null;
    const dailyBreakEnd = breakEndRes.rows.length > 0 ? breakEndRes.rows[0].value : null;

    const clockOutTime = new Date();
    const shiftRes = await pool.query('SELECT clock_in FROM attendance_shifts WHERE id = $1', [shift_id]);

    if (shiftRes.rows.length === 0) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    const clockInTime = new Date(shiftRes.rows[0].clock_in);

    console.log('Clock-out Debug:');
    console.log('  clockInTime:', clockInTime);
    console.log('  clockOutTime:', clockOutTime);
    console.log('  dailyBreakStart:', dailyBreakStart);
    console.log('  dailyBreakEnd:', dailyBreakEnd);

    const effectiveDuration = calculateEffectiveDuration(clockInTime, clockOutTime, dailyBreakStart, dailyBreakEnd);
    console.log('  effectiveDuration:', effectiveDuration);

    const result = await pool.query(
      'UPDATE attendance_shifts SET clock_out = $1, duration = $2, updated_at = NOW() WHERE id = $3 AND clock_out IS NULL RETURNING *',
      [clockOutTime, effectiveDuration, shift_id]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'No open shift found to clock out.' });
    }

    // Automatically clock out the last open time entry for this profile
    const profileId = result.rows[0].profile_id;
    const openTimeEntryRes = await pool.query(
      'SELECT id FROM time_entries WHERE profile_id = $1 AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1',
      [profileId]
    );

    if (openTimeEntryRes.rows.length > 0) {
      const timeEntryId = openTimeEntryRes.rows[0].id;
      const timeEntryClockOutTime = new Date();
      const timeEntryRes = await pool.query('SELECT clock_in FROM time_entries WHERE id = $1', [timeEntryId]);
      const timeEntryClockInTime = new Date(timeEntryRes.rows[0].clock_in);
      const timeEntryEffectiveDuration = calculateEffectiveDuration(timeEntryClockInTime, timeEntryClockOutTime, dailyBreakStart, dailyBreakEnd);

      await pool.query(
        'UPDATE time_entries SET clock_out = $1, duration = $2 WHERE id = $3',
        [timeEntryClockOutTime, timeEntryEffectiveDuration, timeEntryId]
      );

      // Recalculate sales order line items
      const salesOrderIdRes = await pool.query('SELECT sales_order_id FROM time_entries WHERE id = $1', [timeEntryId]);
      if (salesOrderIdRes.rows.length > 0) {
        const soId = salesOrderIdRes.rows[0].sales_order_id;
        const sumRes = await pool.query(
          `SELECT SUM(duration) as total_hours, AVG(unit_price) as avg_rate, SUM(duration * unit_price) as total_cost
           FROM time_entries WHERE sales_order_id = $1 AND clock_out IS NOT NULL`,
          [soId]
        );
        const totalHours = parseFloat(sumRes.rows[0].total_hours) || 0;
        const avgRate = parseFloat(sumRes.rows[0].avg_rate) || 0;
        const totalCost = parseFloat(sumRes.rows[0].total_cost) || 0;

        const overheadRateRes = await pool.query("SELECT value FROM global_settings WHERE key = 'overhead_rate'");
        const overheadRate = overheadRateRes.rows.length > 0 ? parseFloat(overheadRateRes.rows[0].value) : 0;
        const totalOverheadCost = totalHours * overheadRate;

        const labourRes = await pool.query(
          `SELECT sales_order_line_item_id FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = 'LABOUR'`,
          [soId]
        );
        if (labourRes.rows.length > 0) {
          await pool.query(
            `UPDATE salesorderlineitems SET part_description = $1, quantity_sold = $2, unit = $3, unit_price = $4, line_amount = $5 WHERE sales_order_id = $6 AND part_number = 'LABOUR'`,
            ['Labour Hours', totalHours, 'hr', avgRate, totalCost, soId]
          );
        } else {
          await pool.query(
            `INSERT INTO salesorderlineitems (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount)
             VALUES ($1, 'LABOUR', $2, $3, $4, $5, $6)`,
            [soId, 'Labour Hours', totalHours, 'hr', avgRate, totalCost]
          );
        }

        const overheadRes = await pool.query(
          `SELECT sales_order_line_item_id FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = 'OVERHEAD'`,
          [soId]
        );
        if (overheadRes.rows.length > 0) {
          await pool.query(
            `UPDATE salesorderlineitems SET part_description = $1, quantity_sold = $2, unit = $3, unit_price = $4, line_amount = $5 WHERE sales_order_id = $6 AND part_number = 'OVERHEAD'`,
            ['Overhead Hours', totalHours, 'hr', overheadRate, totalOverheadCost, soId]
          );
        } else {
          await pool.query(
            `INSERT INTO salesorderlineitems (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount)
             VALUES ($1, 'OVERHEAD', $2, $3, $4, $5, $6)`,
            [soId, 'Overhead Hours', totalHours, 'hr', overheadRate, totalOverheadCost]
          );
        }
      }
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('attendanceRoutes: Error clocking out:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Edit shift (admin)
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  let { clock_in, clock_out } = req.body; // Use let for reassigning

  try {
    // Convert empty strings to null for clock_in and clock_out if they are optional
    if (clock_in === '') clock_in = null;
    if (clock_out === '') clock_out = null;

    // Get daily break times
    const breakStartRes = await pool.query("SELECT value FROM global_settings WHERE key = 'daily_break_start'");
    const breakEndRes = await pool.query("SELECT value FROM global_settings WHERE key = 'daily_break_end'");
    const dailyBreakStart = breakStartRes.rows.length > 0 ? breakStartRes.rows[0].value : null;
    const dailyBreakEnd = breakEndRes.rows.length > 0 ? breakEndRes.rows[0].value : null;

    console.log('Edit Shift Debug:');
    console.log('  clock_in (raw):', req.body.clock_in);
    console.log('  clock_out (raw):', req.body.clock_out);
    console.log('  clock_in (processed):', clock_in);
    console.log('  clock_out (processed):', clock_out);
    console.log('  dailyBreakStart:', dailyBreakStart);
    console.log('  dailyBreakEnd:', dailyBreakEnd);

    let effectiveDuration = null;
    if (clock_in && clock_out) {
      const clockInTime = new Date(clock_in);
      const clockOutTime = new Date(clock_out);
      effectiveDuration = calculateEffectiveDuration(clockInTime, clockOutTime, dailyBreakStart, dailyBreakEnd);
    }
    console.log('  effectiveDuration:', effectiveDuration);

    const result = await pool.query(
      'UPDATE attendance_shifts SET clock_in = $1, clock_out = $2, duration = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [clock_in, clock_out, effectiveDuration, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('attendanceRoutes: Error editing shift:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List unclosed shifts (for warnings)
router.get('/unclosed', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT * FROM attendance_shifts WHERE clock_out IS NULL AND clock_in < NOW()::date`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('attendanceRoutes: Error fetching unclosed shifts:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export CSV/PDF (stub)
router.get('/export', async (req: Request, res: Response) => {
  // TODO: Implement export logic
  res.status(501).json({ error: 'Export not implemented yet' });
});

export default router;
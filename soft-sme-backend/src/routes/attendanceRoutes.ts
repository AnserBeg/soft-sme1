import express, { Request, Response } from 'express';
import { pool } from '../db';

const router = express.Router();

// List/filter shifts
router.get('/', async (req: Request, res: Response) => {
  try {
    const { profile_id, from, to } = req.query;
    let query = 'SELECT * FROM attendance_shifts';
    const params: any[] = [];
    const conditions: string[] = [];
    if (profile_id) {
      conditions.push('profile_id = $' + (params.length + 1));
      params.push(profile_id);
    }
    if (from) {
      conditions.push('clock_in >= $' + (params.length + 1));
      params.push(from);
    }
    if (to) {
      conditions.push('clock_in <= $' + (params.length + 1));
      params.push(to);
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY clock_in DESC';
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
    const result = await pool.query(
      'UPDATE attendance_shifts SET clock_out = NOW(), updated_at = NOW() WHERE id = $1 AND clock_out IS NULL RETURNING *',
      [shift_id]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'No open shift found to clock out.' });
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
  const { clock_in, clock_out } = req.body;
  try {
    const result = await pool.query(
      'UPDATE attendance_shifts SET clock_in = $1, clock_out = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
      [clock_in, clock_out, id]
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
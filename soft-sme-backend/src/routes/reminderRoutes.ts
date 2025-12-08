import express, { Request, Response } from 'express';
import { pool } from '../db';

const router = express.Router();

/**
 * GET /api/reminders/idle-employees
 * Find profiles who are clocked into attendance but not clocked into any sales order time entry.
 * Query params:
 *  - minutes (optional): minimum minutes since attendance clock-in (default 15, min 5, max 240)
 */
router.get('/idle-employees', async (req: Request, res: Response) => {
  const rawMinutes = Number(req.query.minutes ?? 15);
  const minutes = Number.isFinite(rawMinutes) ? Math.min(Math.max(rawMinutes, 5), 240) : 15;

  try {
    const result = await pool.query(
      `
      WITH on_shift AS (
        SELECT profile_id, clock_in
        FROM attendance_shifts
        WHERE clock_out IS NULL
          AND clock_in <= NOW() - ($1::int * INTERVAL '1 minute')
          AND clock_in >= NOW() - INTERVAL '12 hours'
      ),
      idle AS (
        SELECT s.profile_id, s.clock_in
        FROM on_shift s
        WHERE NOT EXISTS (
          SELECT 1
          FROM time_entries te
          WHERE te.profile_id = s.profile_id
            AND te.clock_out IS NULL
        )
      )
      SELECT
        p.id AS profile_id,
        p.name AS profile_name,
        p.email,
        p.phone_number,
        i.clock_in
      FROM idle i
      JOIN profiles p ON p.id = i.profile_id
      WHERE p.phone_number IS NOT NULL AND trim(p.phone_number) <> ''
      ORDER BY i.clock_in ASC
      `,
      [minutes],
    );

    res.json({
      minutes,
      count: result.rowCount ?? 0,
      employees: result.rows,
    });
  } catch (err) {
    console.error('reminderRoutes: error fetching idle employees', err);
    res.status(500).json({ error: 'Failed to fetch idle employees' });
  }
});

export default router;

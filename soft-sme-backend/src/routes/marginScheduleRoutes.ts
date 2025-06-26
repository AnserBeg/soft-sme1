import express, { Request, Response } from 'express';
import { pool } from '../db';

const router = express.Router();

// Get all margin schedules
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT margin_id, product_id, cost_lower_bound, cost_upper_bound, margin_factor, created_at, updated_at FROM marginschedule ORDER BY margin_id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('marginScheduleRoutes: Error fetching margin schedule:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Replace all margin schedules
router.post('/', async (req: Request, res: Response) => {
  const { schedule } = req.body; // expects array of { product_id, cost_lower_bound, cost_upper_bound, margin_factor }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM marginschedule');
    for (const entry of schedule) {
      await client.query(
        'INSERT INTO marginschedule (product_id, cost_lower_bound, cost_upper_bound, margin_factor) VALUES ($1, $2, $3, $4)',
        [entry.product_id, entry.cost_lower_bound, entry.cost_upper_bound, entry.margin_factor]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('marginScheduleRoutes: Error updating margin schedule:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router; 
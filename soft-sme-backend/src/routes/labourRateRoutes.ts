import express, { Request, Response } from 'express';
import { pool } from '../db';

const router = express.Router();

// Get the current labour rate
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT rate FROM labourrate ORDER BY updated_at DESC LIMIT 1');
    if (result.rows.length === 0) {
      return res.json({ rate: null });
    }
    res.json({ rate: result.rows[0].rate });
  } catch (err) {
    console.error('labourRateRoutes: Error fetching labour rate:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Set/update the labour rate
router.post('/', async (req: Request, res: Response) => {
  const { rate } = req.body;
  if (typeof rate !== 'number' || isNaN(rate) || rate < 0) {
    return res.status(400).json({ error: 'Invalid rate' });
  }
  try {
    // Upsert: delete all, insert new (only one row needed)
    await pool.query('DELETE FROM labourrate');
    await pool.query('INSERT INTO labourrate (rate) VALUES ($1)', [rate]);
    res.json({ success: true });
  } catch (err) {
    console.error('labourRateRoutes: Error updating labour rate:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 
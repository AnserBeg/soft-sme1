import express, { Request, Response } from 'express';
import { pool } from '../db';

const router = express.Router();

// Get the global labour rate
router.get('/labour-rate', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT value FROM global_settings WHERE key = $1', ['labour_rate']);
    if (result.rows.length === 0) {
      return res.json({ labour_rate: null });
    }
    res.json({ labour_rate: parseFloat(result.rows[0].value) });
  } catch (err) {
    console.error('globalSettingsRoutes: Error fetching labour rate:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update the global labour rate
router.put('/labour-rate', async (req: Request, res: Response) => {
  const { labour_rate } = req.body;
  if (typeof labour_rate !== 'number' || isNaN(labour_rate) || labour_rate < 0) {
    return res.status(400).json({ error: 'Invalid labour rate' });
  }
  try {
    await pool.query(
      'INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['labour_rate', labour_rate.toString()]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('globalSettingsRoutes: Error updating labour rate:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 
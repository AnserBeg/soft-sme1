import express, { Request, Response } from 'express';
import { pool } from '../db';

const router = express.Router();

function getContext(raw?: any): 'line' | 'pto' {
  const v = String(raw || 'line').toLowerCase();
  return v === 'pto' ? 'pto' : 'line';
}

// GET /api/part-finder/:id/stats?context=line|pto
router.get('/:id/stats', async (req: Request, res: Response) => {
  const salesOrderId = Number(req.params.id);
  const context = getContext(req.query.context);
  if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) {
    return res.status(400).json({ error: 'Invalid sales order id' });
  }
  try {
    const prefs = await pool.query(
      `SELECT part_number, is_favorite, use_count, last_used_at
       FROM sales_order_part_prefs
       WHERE sales_order_id = $1 AND context = $2`,
      [salesOrderId, context]
    );
    const rows = prefs.rows || [];
    const favPartNumbers = rows.filter(r => r.is_favorite).map(r => r.part_number);
    const recentPartNumbers = rows
      .filter(r => r.use_count > 0)
      .sort((a, b) => new Date(b.last_used_at || 0).getTime() - new Date(a.last_used_at || 0).getTime())
      .slice(0, 10)
      .map(r => r.part_number);

    const all = Array.from(new Set([...favPartNumbers, ...recentPartNumbers]));
    let parts: Array<{ part_number: string; part_description: string } & Record<string, any>> = [];
    if (all.length > 0) {
      const q = await pool.query(
        `SELECT part_number, part_description FROM inventory WHERE part_number = ANY($1::text[])`,
        [all]
      );
      parts = q.rows || [];
    }
    const byNumber = new Map(parts.map(p => [p.part_number, p] as const));
    const favorites = favPartNumbers
      .map(pn => byNumber.get(pn))
      .filter(Boolean);
    const recents = recentPartNumbers
      .map(pn => byNumber.get(pn))
      .filter(Boolean);
    res.json({ favorites, recents });
  } catch (err) {
    console.error('partFinderRoutes GET stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/part-finder/:id/use { part_number, context }
router.post('/:id/use', async (req: Request, res: Response) => {
  const salesOrderId = Number(req.params.id);
  const { part_number } = req.body || {};
  const context = getContext(req.body?.context);
  if (!Number.isFinite(salesOrderId) || salesOrderId <= 0 || !part_number) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO sales_order_part_prefs (sales_order_id, part_number, context, is_favorite, last_used_at, use_count)
       VALUES ($1,$2,$3,false,NOW(),1)
       ON CONFLICT (sales_order_id, part_number, context)
       DO UPDATE SET last_used_at = NOW(), use_count = sales_order_part_prefs.use_count + 1`,
      [salesOrderId, part_number, context]
    );
    await client.query(
      `INSERT INTO part_usage_global (part_number, last_used_at, use_count)
       VALUES ($1, NOW(), 1)
       ON CONFLICT (part_number)
       DO UPDATE SET last_used_at = NOW(), use_count = part_usage_global.use_count + 1`,
      [part_number]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('partFinderRoutes POST use error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/part-finder/:id/favorite { part_number, context, value }
router.post('/:id/favorite', async (req: Request, res: Response) => {
  const salesOrderId = Number(req.params.id);
  const { part_number, value } = req.body || {};
  const context = getContext(req.body?.context);
  if (!Number.isFinite(salesOrderId) || salesOrderId <= 0 || !part_number) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }
  try {
    await pool.query(
      `INSERT INTO sales_order_part_prefs (sales_order_id, part_number, context, is_favorite, last_used_at, use_count)
       VALUES ($1,$2,$3,$4,NULL,0)
       ON CONFLICT (sales_order_id, part_number, context)
       DO UPDATE SET is_favorite = EXCLUDED.is_favorite`,
      [salesOrderId, part_number, context, !!value]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('partFinderRoutes POST favorite error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;



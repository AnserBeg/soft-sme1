import express, { Request, Response } from 'express';
import { pool } from '../db';

const router = express.Router();

// List vendor links for a canonical part
router.get('/:partNumber/vendors', async (req: Request, res: Response) => {
  const partNumber = String(req.params.partNumber || '');
  try {
    // First get the part_id for the part_number
    const partQuery = await pool.query(
      'SELECT part_id FROM inventory WHERE part_number = $1',
      [partNumber]
    );
    
    if (partQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Part not found' });
    }
    
    const partId = partQuery.rows[0].part_id;
    
    // Now query vendors using part_id
    const q = await pool.query(
      `SELECT iv.*, v.vendor_name
       FROM inventory_vendors iv
       LEFT JOIN vendormaster v ON v.vendor_id = iv.vendor_id
       WHERE iv.part_id = $1
       ORDER BY preferred DESC, usage_count DESC, vendor_name ASC`,
      [partId]
    );
    res.json(q.rows);
  } catch (err) {
    console.error('inventoryVendorRoutes: list error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List vendor links for a canonical part by part_id
router.get('/part/:partId/vendors', async (req: Request, res: Response) => {
  const partId = Number(req.params.partId);
  if (!Number.isFinite(partId)) {
    return res.status(400).json({ error: 'Invalid part_id' });
  }
  
  try {
    // Query vendors directly using part_id
    const q = await pool.query(
      `SELECT iv.*, v.vendor_name
       FROM inventory_vendors iv
       LEFT JOIN vendormaster v ON v.vendor_id = iv.vendor_id
       WHERE iv.part_id = $1
       ORDER BY preferred DESC, usage_count DESC, vendor_name ASC`,
      [partId]
    );
    res.json(q.rows);
  } catch (err) {
    console.error('inventoryVendorRoutes: list by part_id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create vendor link
router.post('/:partNumber/vendors', async (req: Request, res: Response) => {
  const partNumber = String(req.params.partNumber || '');
  const { vendor_id, vendor_part_number, vendor_part_description, preferred } = req.body || {};
  if (!vendor_id || !vendor_part_number) return res.status(400).json({ error: 'vendor_id and vendor_part_number are required' });
  try {
    // First get the part_id for the part_number
    const partQuery = await pool.query(
      'SELECT part_id FROM inventory WHERE part_number = $1',
      [partNumber]
    );
    
    if (partQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Part not found' });
    }
    
    const partId = partQuery.rows[0].part_id;
    
    const q = await pool.query(
      `INSERT INTO inventory_vendors (part_number, part_id, vendor_id, vendor_part_number, vendor_part_description, preferred)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,false))
       ON CONFLICT (part_id, vendor_id, vendor_part_number) DO UPDATE SET
         part_id = EXCLUDED.part_id,
         vendor_part_description = EXCLUDED.vendor_part_description,
         preferred = EXCLUDED.preferred
       RETURNING *`,
      [partNumber, partId, vendor_id, String(vendor_part_number).toUpperCase(), vendor_part_description || null, !!preferred]
    );
    res.status(201).json(q.rows[0]);
  } catch (err) {
    console.error('inventoryVendorRoutes: create error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create vendor link by part_id
router.post('/part/:partId/vendors', async (req: Request, res: Response) => {
  const partId = Number(req.params.partId);
  const { vendor_id, vendor_part_number, vendor_part_description, preferred } = req.body || {};
  if (!Number.isFinite(partId)) return res.status(400).json({ error: 'Invalid part_id' });
  if (!vendor_id || !vendor_part_number) return res.status(400).json({ error: 'vendor_id and vendor_part_number are required' });
  
  try {
    // Get the part_number for this part_id
    const partQuery = await pool.query(
      'SELECT part_number FROM inventory WHERE part_id = $1',
      [partId]
    );
    
    if (partQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Part not found' });
    }
    
    const partNumber = partQuery.rows[0].part_number;
    
    const q = await pool.query(
      `INSERT INTO inventory_vendors (part_number, part_id, vendor_id, vendor_part_number, vendor_part_description, preferred)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,false))
       ON CONFLICT (part_id, vendor_id, vendor_part_number) DO UPDATE SET
         part_id = EXCLUDED.part_id,
         vendor_part_description = EXCLUDED.vendor_part_description,
         preferred = EXCLUDED.preferred
       RETURNING *`,
      [partNumber, partId, vendor_id, String(vendor_part_number).toUpperCase(), vendor_part_description || null, !!preferred]
    );
    res.status(201).json(q.rows[0]);
  } catch (err) {
    console.error('inventoryVendorRoutes: create by part_id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update vendor link
router.put('/:partNumber/vendors/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { vendor_part_number, vendor_part_description, preferred, is_active } = req.body || {};
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query(
      `UPDATE inventory_vendors SET
         vendor_part_number = COALESCE($1, vendor_part_number),
         vendor_part_description = COALESCE($2, vendor_part_description),
         preferred = COALESCE($3, preferred),
         is_active = COALESCE($4, is_active)
       WHERE id = $5
       RETURNING *`,
      [vendor_part_number ? String(vendor_part_number).toUpperCase() : null, vendor_part_description || null, preferred, is_active, id]
    );
    if (q.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const updated = q.rows[0];
    if (preferred === true && updated.part_id) {
      // Ensure exclusivity: unset preferred on all other vendor links for this part
      await client.query('UPDATE inventory_vendors SET preferred = false WHERE part_id = $1 AND id <> $2', [updated.part_id, id]);
    }
    await client.query('COMMIT');
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('inventoryVendorRoutes: update error', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update vendor link by part_id
router.put('/part/:partId/vendors/:id', async (req: Request, res: Response) => {
  const partId = Number(req.params.partId);
  const id = Number(req.params.id);
  const { vendor_part_number, vendor_part_description, preferred, is_active } = req.body || {};
  if (!Number.isFinite(partId)) return res.status(400).json({ error: 'Invalid part_id' });
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const q = await client.query(
      `UPDATE inventory_vendors SET
         vendor_part_number = COALESCE($1, vendor_part_number),
         vendor_part_description = COALESCE($2, vendor_part_description),
         preferred = COALESCE($3, preferred),
         is_active = COALESCE($4, is_active)
       WHERE id = $5 AND part_id = $6
       RETURNING *`,
      [vendor_part_number ? String(vendor_part_number).toUpperCase() : null, vendor_part_description || null, preferred, is_active, id, partId]
    );
    if (q.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const updated = q.rows[0];
    if (preferred === true) {
      await client.query('UPDATE inventory_vendors SET preferred = false WHERE part_id = $1 AND id <> $2', [partId, id]);
    }
    await client.query('COMMIT');
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('inventoryVendorRoutes: update by part_id error', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete vendor link
router.delete('/:partNumber/vendors/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const q = await pool.query('DELETE FROM inventory_vendors WHERE id = $1', [id]);
    res.json({ ok: true, deleted: q.rowCount });
  } catch (err) {
    console.error('inventoryVendorRoutes: delete error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete vendor link by part_id
router.delete('/part/:partId/vendors/:id', async (req: Request, res: Response) => {
  const partId = Number(req.params.partId);
  const id = Number(req.params.id);
  if (!Number.isFinite(partId)) return res.status(400).json({ error: 'Invalid part_id' });
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const q = await pool.query('DELETE FROM inventory_vendors WHERE id = $1 AND part_id = $2', [id, partId]);
    res.json({ ok: true, deleted: q.rowCount });
  } catch (err) {
    console.error('inventoryVendorRoutes: delete by part_id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Usage increment (from PO creation)
router.post('/usage', async (req: Request, res: Response) => {
  const { part_number, vendor_id, vendor_part_number } = req.body || {};
  if (!part_number || !vendor_id || !vendor_part_number) return res.status(400).json({ error: 'part_number, vendor_id and vendor_part_number required' });
  try {
    await pool.query(
      `INSERT INTO inventory_vendors (part_number, vendor_id, vendor_part_number, usage_count, last_used_at)
       VALUES ($1,$2,$3,1,NOW())
       ON CONFLICT (part_id, vendor_id, vendor_part_number)
       DO UPDATE SET usage_count = inventory_vendors.usage_count + 1, last_used_at = NOW()`,
      [String(part_number).toUpperCase(), vendor_id, String(vendor_part_number).toUpperCase()]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('inventoryVendorRoutes: usage error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;



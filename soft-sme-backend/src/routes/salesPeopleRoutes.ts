import express, { Request, Response } from 'express';
import { pool } from '../db';
import { sanitizePlainText } from '../utils/htmlSanitizer';

const router = express.Router();

const normalizeName = (value: any) => sanitizePlainText(value ?? '').trim();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT sales_person_id, sales_person_name, email, phone_number, is_active, created_at, updated_at
       FROM sales_people
       ORDER BY sales_person_name ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('salesPeopleRoutes: Error fetching sales people:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT sales_person_id, sales_person_name, email, phone_number, is_active, created_at, updated_at
       FROM sales_people
       WHERE sales_person_id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sales person not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('salesPeopleRoutes: Error fetching sales person:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  const name = normalizeName(req.body?.sales_person_name);
  const email = sanitizePlainText(req.body?.email).trim() || null;
  const phone = sanitizePlainText(req.body?.phone_number).trim() || null;

  if (!name) {
    return res.status(400).json({ error: 'sales_person_name is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO sales_people (sales_person_name, email, phone_number)
       VALUES ($1, $2, $3)
       RETURNING sales_person_id, sales_person_name, email, phone_number, is_active, created_at, updated_at`,
      [name, email, phone]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('salesPeopleRoutes: Error creating sales person:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const name = req.body?.sales_person_name !== undefined ? normalizeName(req.body?.sales_person_name) : undefined;
  const email = req.body?.email !== undefined ? (sanitizePlainText(req.body?.email).trim() || null) : undefined;
  const phone = req.body?.phone_number !== undefined ? (sanitizePlainText(req.body?.phone_number).trim() || null) : undefined;
  const isActive = req.body?.is_active !== undefined ? Boolean(req.body?.is_active) : undefined;

  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (name !== undefined) {
    if (!name) {
      return res.status(400).json({ error: 'sales_person_name cannot be empty' });
    }
    fields.push(`sales_person_name = $${idx++}`);
    values.push(name);
  }
  if (email !== undefined) {
    fields.push(`email = $${idx++}`);
    values.push(email);
  }
  if (phone !== undefined) {
    fields.push(`phone_number = $${idx++}`);
    values.push(phone);
  }
  if (isActive !== undefined) {
    fields.push(`is_active = $${idx++}`);
    values.push(isActive);
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  values.push(id);

  try {
    const result = await pool.query(
      `UPDATE sales_people SET ${fields.join(', ')}, updated_at = NOW()
       WHERE sales_person_id = $${idx}
       RETURNING sales_person_id, sales_person_name, email, phone_number, is_active, created_at, updated_at`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sales person not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('salesPeopleRoutes: Error updating sales person:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/sales-orders-summary', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const summaryResult = await pool.query(
      `SELECT COALESCE(SUM(estimated_cost), 0) AS total_estimated_cost
       FROM salesorderhistory
       WHERE sales_person_id = $1`,
      [id]
    );

    const ordersResult = await pool.query(
      `SELECT sales_order_id, sales_order_number, sales_date, CAST(estimated_cost AS FLOAT) as estimated_cost
       FROM salesorderhistory
       WHERE sales_person_id = $1
       ORDER BY sales_date DESC`,
      [id]
    );

    res.json({
      total_estimated_cost: Number(summaryResult.rows[0]?.total_estimated_cost || 0),
      orders: ordersResult.rows,
    });
  } catch (error) {
    console.error('salesPeopleRoutes: Error fetching sales order summary:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

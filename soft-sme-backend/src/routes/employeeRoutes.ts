import express, { Request, Response } from 'express';
import { pool } from '../db';
import bcrypt from 'bcrypt';

const router = express.Router();

// Get all employees for the current user's company
router.get('/', async (req: Request, res: Response) => {
  try {
    const company_id = req.user?.company_id;
    const result = await pool.query(
      'SELECT id, email, username, access_role FROM users WHERE company_id = $1',
      [company_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('employeeRoutes: Error fetching employees:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new employee
router.post('/', async (req: Request, res: Response) => {
  const { email, username, password, access_role } = req.body;
  try {
    const company_id = req.user?.company_id;
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, username, password_hash, access_role, company_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, username, access_role',
      [email, username, hashedPassword, access_role, company_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('employeeRoutes: Error creating employee:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update an employee
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { username, access_role, password } = req.body;
  try {
    const company_id = req.user?.company_id;
    let query, params;
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      query = 'UPDATE users SET username = $1, access_role = $2, password_hash = $3 WHERE id = $4 AND company_id = $5 RETURNING id, email, username, access_role';
      params = [username, access_role, hashedPassword, id, company_id];
    } else {
      query = 'UPDATE users SET username = $1, access_role = $2 WHERE id = $3 AND company_id = $4 RETURNING id, email, username, access_role';
      params = [username, access_role, id, company_id];
    }
    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('employeeRoutes: Error updating employee:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete an employee
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const company_id = req.user?.company_id;
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 AND company_id = $2 RETURNING id',
      [id, company_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('employeeRoutes: Error deleting employee:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 
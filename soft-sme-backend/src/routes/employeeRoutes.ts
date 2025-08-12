import express, { Request, Response } from 'express';
import { pool } from '../db';
import bcrypt from 'bcrypt';

const router = express.Router();

// Get all employees for the current user's company
router.get('/', async (req: Request, res: Response) => {
  try {
    const company_id = req.user?.company_id;
    
    // Debug logging
    console.log('Fetching employees for company_id:', company_id);
    console.log('User object:', req.user);
    
    if (!company_id) {
      console.error('No company_id found in user object');
      return res.status(400).json({ error: 'Company ID not found' });
    }
    
    const result = await pool.query(
      'SELECT id, email, username, access_role FROM users WHERE company_id = $1',
      [company_id]
    );
    res.json(result.rows);
  } catch (err: any) {
    console.error('employeeRoutes: Error fetching employees:', err);
    console.error('Error details:', {
      message: err.message,
      code: err.code
    });
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// Create a new employee
router.post('/', async (req: Request, res: Response) => {
  const { email, username, password, access_role } = req.body;
  try {
    const company_id = req.user?.company_id;
    
    // Debug logging
    console.log('Creating employee with data:', {
      email,
      username,
      access_role,
      company_id,
      user: req.user
    });
    
    if (!company_id) {
      console.error('No company_id found in user object');
      return res.status(400).json({ error: 'Company ID not found' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, username, password_hash, access_role, company_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, username, access_role',
      [email, username, hashedPassword, access_role, company_id]
    );
    res.status(201).json({ message: 'Employee created successfully', employee: result.rows[0] });
  } catch (err: any) {
    console.error('employeeRoutes: Error creating employee:', err);
    console.error('Error details:', {
      message: err.message,
      code: err.code,
      constraint: err.constraint,
      detail: err.detail
    });
    
    // Provide more specific error messages
    if (err.code === '23505') { // Unique constraint violation
      if (err.constraint?.includes('email')) {
        res.status(400).json({ error: 'Email already exists' });
      } else if (err.constraint?.includes('username')) {
        res.status(400).json({ error: 'Username already exists' });
      } else {
        res.status(400).json({ error: 'Duplicate entry' });
      }
    } else if (err.code === '23503') { // Foreign key constraint violation
      res.status(400).json({ error: 'Invalid company ID' });
    } else {
      res.status(500).json({ error: 'Internal server error', details: err.message });
    }
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
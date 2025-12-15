import express, { Request, Response } from 'express';
import { pool } from '../db';
import { sharedPool } from '../dbShared';
import bcrypt from 'bcrypt';
import { resolveTenantCompanyId } from '../utils/tenantCompany';

const router = express.Router();

/**
 * Keep the shared auth DB and the tenant DB in sync so multi-tenant logins
 * keep working. We upsert by email to avoid duplicate records when a user
 * already exists in one of the databases.
 */
async function upsertSharedUser(
  email: string,
  username: string,
  passwordHash: string,
  accessRole: string,
  companyId: string,
) {
  const sharedResult = await sharedPool.query(
    `
    INSERT INTO users (email, username, password_hash, access_role, company_id)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (company_id, email)
    DO UPDATE SET 
      username = EXCLUDED.username,
      password_hash = EXCLUDED.password_hash,
      access_role = EXCLUDED.access_role,
      company_id = EXCLUDED.company_id,
      updated_at = NOW()
    RETURNING id, email, username, access_role, company_id
    `,
    [email, username, passwordHash, accessRole, companyId],
  );

  return sharedResult.rows[0];
}

async function upsertTenantUser(
  email: string,
  username: string,
  passwordHash: string,
  accessRole: string,
  companyId: string,
  sharedUserId: number,
) {
  const tenantResult = await pool.query(
    `
    INSERT INTO users (email, username, password_hash, access_role, company_id, shared_user_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (company_id, email)
    DO UPDATE SET 
      username = EXCLUDED.username,
      password_hash = EXCLUDED.password_hash,
      access_role = EXCLUDED.access_role,
      company_id = EXCLUDED.company_id,
      shared_user_id = EXCLUDED.shared_user_id,
      updated_at = NOW()
    RETURNING id, email, username, access_role, company_id, shared_user_id
    `,
    [email, username, passwordHash, accessRole, companyId, sharedUserId],
  );

  return tenantResult.rows[0];
}

// Get all employees for the current user's company
router.get('/', async (req: Request, res: Response) => {
  try {
    const sharedCompanyId = req.user?.company_id;
    const tenantCompanyId = await resolveTenantCompanyId(pool, sharedCompanyId);
    
    // Debug logging
    console.log('Fetching employees for company_id:', sharedCompanyId, 'tenantCompanyId:', tenantCompanyId);
    console.log('User object:', req.user);
    
    if (!sharedCompanyId || !tenantCompanyId) {
      console.error('No company_id found in user object');
      return res.status(400).json({ error: 'Company ID not found' });
    }
    
    const result = await pool.query(
      'SELECT id, email, username, access_role FROM users WHERE company_id = $1',
      [tenantCompanyId]
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
    const sharedCompanyId = req.user?.company_id;
    const tenantCompanyId = await resolveTenantCompanyId(pool, sharedCompanyId);
    
    // Debug logging
    console.log('Creating employee with data:', {
      email,
      username,
      access_role,
      company_id: sharedCompanyId,
      tenantCompanyId,
      user: req.user
    });
    
    if (!sharedCompanyId || !tenantCompanyId) {
      console.error('No company_id found in user object');
      return res.status(400).json({ error: 'Company ID not found' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const sharedUser = await upsertSharedUser(email, username, hashedPassword, access_role, sharedCompanyId);
    const tenantUser = await upsertTenantUser(
      email,
      username,
      hashedPassword,
      access_role,
      tenantCompanyId,
      sharedUser.id,
    );

    res.status(201).json({
      message: 'Employee created successfully',
      employee: {
        id: tenantUser.id,
        email: tenantUser.email,
        username: tenantUser.username,
        access_role: tenantUser.access_role,
        shared_user_id: sharedUser.id,
      },
    });
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
    const sharedCompanyId = req.user?.company_id;
    const tenantCompanyId = await resolveTenantCompanyId(pool, sharedCompanyId);
    if (!sharedCompanyId || !tenantCompanyId) {
      return res.status(400).json({ error: 'Company ID not found' });
    }

    const existing = await pool.query(
      'SELECT email, username, password_hash FROM users WHERE id = $1 AND company_id = $2',
      [id, tenantCompanyId],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const current = existing.rows[0];
    const newPasswordHash = password ? await bcrypt.hash(password, 10) : current.password_hash;
    const newUsername = username ?? current.username;
    const newAccessRole = access_role ?? 'Employee';

    const tenantResult = await pool.query(
      'UPDATE users SET username = $1, access_role = $2, password_hash = $3 WHERE id = $4 AND company_id = $5 RETURNING id, email, username, access_role, shared_user_id',
      [newUsername, newAccessRole, newPasswordHash, id, tenantCompanyId],
    );

    const sharedUser = await upsertSharedUser(
      current.email,
      newUsername,
      newPasswordHash,
      newAccessRole,
      sharedCompanyId,
    );

    // Keep the mapping set even if the row pre-dated the shared_user_id column.
    if (!tenantResult.rows[0]?.shared_user_id) {
      await pool.query(
        'UPDATE users SET shared_user_id = $1 WHERE id = $2',
        [sharedUser.id, id],
      );
    }

    res.json(tenantResult.rows[0]);
  } catch (err) {
    console.error('employeeRoutes: Error updating employee:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete an employee
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const sharedCompanyId = req.user?.company_id;
    const tenantCompanyId = await resolveTenantCompanyId(pool, sharedCompanyId);
    if (!sharedCompanyId || !tenantCompanyId) {
      return res.status(400).json({ error: 'Company ID not found' });
    }

    const existing = await pool.query(
      'SELECT email FROM users WHERE id = $1 AND company_id = $2',
      [id, tenantCompanyId],
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    await pool.query('DELETE FROM users WHERE id = $1 AND company_id = $2', [id, tenantCompanyId]);
    await sharedPool.query('DELETE FROM users WHERE email = $1 AND company_id = $2', [
      existing.rows[0].email,
      sharedCompanyId,
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error('employeeRoutes: Error deleting employee:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 

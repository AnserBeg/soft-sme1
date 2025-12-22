import express, { Request, Response } from 'express';
import { pool } from '../db';
import { resolveTenantCompanyIdFromRequest } from '../utils/companyContext';

const router = express.Router();

// Get overhead expense distribution for a company
router.get('/distribution', async (req: Request, res: Response) => {
  try {
    const companyId = await resolveTenantCompanyIdFromRequest(req, pool);
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID not found' });
    }
    
    const result = await pool.query(
      'SELECT * FROM overhead_expense_distribution WHERE company_id = $1 AND is_active = TRUE ORDER BY id',
      [companyId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching overhead distribution:', error);
    res.status(500).json({ error: 'Failed to fetch overhead distribution' });
  }
});

// Add new overhead expense distribution
router.post('/distribution', async (req: Request, res: Response) => {
  const { expense_account_id, percentage, description } = req.body;
  
  if (!expense_account_id || typeof percentage !== 'number' || percentage < 0 || percentage > 100) {
    return res.status(400).json({ error: 'Invalid expense account ID or percentage' });
  }
  
  try {
    const companyId = await resolveTenantCompanyIdFromRequest(req, pool);
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID not found' });
    }
    
    // Check if total percentage would exceed 100%
    const existingResult = await pool.query(
      'SELECT SUM(percentage) as total_percentage FROM overhead_expense_distribution WHERE company_id = $1 AND is_active = TRUE',
      [companyId]
    );
    
    const currentTotal = parseFloat(existingResult.rows[0]?.total_percentage || '0');
    if (currentTotal + percentage > 100) {
      return res.status(400).json({ 
        error: `Total percentage would exceed 100%. Current total: ${currentTotal}%, adding: ${percentage}%` 
      });
    }
    
    const result = await pool.query(
      `INSERT INTO overhead_expense_distribution 
       (company_id, expense_account_id, percentage, description) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [companyId, expense_account_id, percentage, description || '']
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error adding overhead distribution:', error);
    res.status(500).json({ error: 'Failed to add overhead distribution' });
  }
});

// Update overhead expense distribution
router.put('/distribution/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { expense_account_id, percentage, description, is_active } = req.body;
  
  if (!expense_account_id || typeof percentage !== 'number' || percentage < 0 || percentage > 100) {
    return res.status(400).json({ error: 'Invalid expense account ID or percentage' });
  }
  
  try {
    const companyId = await resolveTenantCompanyIdFromRequest(req, pool);
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID not found' });
    }
    
    // Check if total percentage would exceed 100% (excluding current record)
    const existingResult = await pool.query(
      'SELECT SUM(percentage) as total_percentage FROM overhead_expense_distribution WHERE company_id = $1 AND is_active = TRUE AND id != $2',
      [companyId, id]
    );
    
    const currentTotal = parseFloat(existingResult.rows[0]?.total_percentage || '0');
    if (currentTotal + percentage > 100) {
      return res.status(400).json({ 
        error: `Total percentage would exceed 100%. Current total: ${currentTotal}%, adding: ${percentage}%` 
      });
    }
    
    const result = await pool.query(
      `UPDATE overhead_expense_distribution 
       SET expense_account_id = $1, percentage = $2, description = $3, is_active = $4, updated_at = NOW()
       WHERE id = $5 AND company_id = $6 
       RETURNING *`,
      [expense_account_id, percentage, description || '', is_active !== false, id, companyId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Overhead distribution not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating overhead distribution:', error);
    res.status(500).json({ error: 'Failed to update overhead distribution' });
  }
});

// Delete overhead expense distribution
router.delete('/distribution/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    const companyId = await resolveTenantCompanyIdFromRequest(req, pool);
    if (!companyId) {
      return res.status(400).json({ error: 'Company ID not found' });
    }
    
    const result = await pool.query(
      'DELETE FROM overhead_expense_distribution WHERE id = $1 AND company_id = $2 RETURNING *',
      [id, companyId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Overhead distribution not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting overhead distribution:', error);
    res.status(500).json({ error: 'Failed to delete overhead distribution' });
  }
});

export default router; 

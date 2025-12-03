import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantContextMiddleware } from '../middleware/tenantMiddleware';
import { resolveTenantUserId } from '../utils/tenantUser';

const router = Router();

// Apply auth middleware to all routes
router.use(authMiddleware);
router.use(tenantContextMiddleware);

// Submit leave request
router.post('/request', async (req: Request, res: Response) => {
  const { profile_id, request_type, start_date, end_date, reason } = req.body;
  const userId = await resolveTenantUserId(pool, req.user);

  if (!userId) {
    return res.status(403).json({ error: 'User record not found for this tenant' });
  }

  try {
    // Validate user has access to this profile
    const profileAccess = await pool.query(
      'SELECT * FROM user_profile_access WHERE user_id = $1 AND profile_id = $2 AND is_active = true',
      [userId, profile_id]
    );

    if (profileAccess.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to this profile' });
    }

    // Calculate total days
    const start = new Date(start_date);
    const end = new Date(end_date);
    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // For vacation requests, check available days
    if (request_type === 'vacation') {
      const profile = await pool.query(
        'SELECT vacation_days_available FROM profiles WHERE id = $1',
        [profile_id]
      );
      
      if (profile.rows[0].vacation_days_available < totalDays) {
        return res.status(400).json({ 
          error: 'Insufficient vacation days',
          available: profile.rows[0].vacation_days_available,
          requested: totalDays
        });
      }
    }

    // For personal and bereavement, check if they exceed reasonable limits
    if (request_type === 'personal' && totalDays > 5) {
      return res.status(400).json({ 
        error: 'Personal leave cannot exceed 5 days',
        requested: totalDays,
        max_allowed: 5
      });
    }

    if (request_type === 'bereavement' && totalDays > 10) {
      return res.status(400).json({ 
        error: 'Bereavement leave cannot exceed 10 days',
        requested: totalDays,
        max_allowed: 10
      });
    }

    const result = await pool.query(
      `INSERT INTO leave_requests 
       (user_id, profile_id, request_type, start_date, end_date, reason, total_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [userId, profile_id, request_type, start_date, end_date, reason, totalDays]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating leave request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's own requests
router.get('/my-requests', async (req: Request, res: Response) => {
  const userId = await resolveTenantUserId(pool, req.user);

  if (!userId) {
    return res.status(403).json({ error: 'User record not found for this tenant' });
  }

  try {
    const result = await pool.query(
      `SELECT lr.*, p.name as profile_name
       FROM leave_requests lr
       JOIN profiles p ON lr.profile_id = p.id
       WHERE lr.user_id = $1
       ORDER BY lr.created_at DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching user requests:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all requests (Admin and Time Tracking users)
router.get('/all-requests', async (req: Request, res: Response) => {
  const userRole = req.user?.access_role;
  
  if (userRole !== 'Admin' && userRole !== 'Time Tracking') {
    return res.status(403).json({ error: 'Admin or Time Tracking access required' });
  }

  try {
    const { status } = req.query;
    let query = `
      SELECT lr.*, p.name as profile_name, u.email as user_email
      FROM leave_requests lr
      JOIN profiles p ON lr.profile_id = p.id
      JOIN users u ON lr.user_id = u.id
    `;
    
    const params: any[] = [];
    if (status) {
      query += ' WHERE lr.status = $1';
      params.push(status);
    }
    
    query += ' ORDER BY lr.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching all requests:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get calendar data
router.get('/calendar', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date } = req.query;
    
    let query = `
      SELECT lr.*, p.name as profile_name, u.email as user_email
      FROM leave_requests lr
      JOIN profiles p ON lr.profile_id = p.id
      JOIN users u ON lr.user_id = u.id
      WHERE lr.status = 'approved'
    `;
    
    const params: any[] = [];
    if (start_date && end_date) {
      query += ' AND (lr.start_date <= $1 AND lr.end_date >= $2)';
      params.push(end_date, start_date);
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching calendar data:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve request (Admin only)
router.post('/approve/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { admin_notes, proposed_start_date, proposed_end_date } = req.body;
  const adminUserId = await resolveTenantUserId(pool, req.user);
  const userRole = req.user?.access_role;

  if (userRole !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (!adminUserId) {
    return res.status(403).json({ error: 'Admin user not found for this tenant' });
  }

  try {
    // Get request details
    const request = await pool.query(
      'SELECT * FROM leave_requests WHERE request_id = $1',
      [id]
    );

    if (request.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const leaveRequest = request.rows[0];

    // If admin proposed new dates, calculate new total days and update the request
    if (proposed_start_date && proposed_end_date) {
      const start = new Date(proposed_start_date);
      const end = new Date(proposed_end_date);
      const newTotalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      
      await pool.query(
        'UPDATE leave_requests SET start_date = $1, end_date = $2, total_days = $3, status = $4, admin_user_id = $5, admin_notes = $6, updated_at = NOW() WHERE request_id = $7',
        [proposed_start_date, proposed_end_date, newTotalDays, 'modified', adminUserId, admin_notes, id]
      );
    } else {
      // Update request status with admin notes only
      await pool.query(
        'UPDATE leave_requests SET status = $1, admin_user_id = $2, admin_notes = $3, updated_at = NOW() WHERE request_id = $4',
        ['approved', adminUserId, admin_notes, id]
      );
    }

    // If vacation request, deduct days from profile (use original days if no new dates proposed)
    if (leaveRequest.request_type === 'vacation') {
      const daysToDeduct = proposed_start_date && proposed_end_date ? 
        Math.ceil((new Date(proposed_end_date).getTime() - new Date(proposed_start_date).getTime()) / (1000 * 60 * 60 * 24)) + 1 :
        leaveRequest.total_days;
      
      await pool.query(
        'UPDATE profiles SET vacation_days_available = vacation_days_available - $1 WHERE id = $2',
        [daysToDeduct, leaveRequest.profile_id]
      );
    }

    // Note: Personal and bereavement leave types don't deduct from vacation days
    // They are separate leave categories with their own policies

    res.json({ message: 'Request approved successfully' });
  } catch (err) {
    console.error('Error approving request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Deny request (Admin only)
router.post('/deny/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { admin_notes } = req.body;
  const adminUserId = await resolveTenantUserId(pool, req.user);
  const userRole = req.user?.access_role;

  if (userRole !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (!adminUserId) {
    return res.status(403).json({ error: 'Admin user not found for this tenant' });
  }

  try {
    await pool.query(
      'UPDATE leave_requests SET status = $1, admin_user_id = $2, admin_notes = $3, updated_at = NOW() WHERE request_id = $4',
      ['denied', adminUserId, admin_notes, id]
    );

    res.json({ message: 'Request denied successfully' });
  } catch (err) {
    console.error('Error denying request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Propose vacation dates (Admin only)
router.post('/propose/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { proposed_start_date, proposed_end_date, admin_notes } = req.body;
  const adminUserId = await resolveTenantUserId(pool, req.user);
  const userRole = req.user?.access_role;

  if (userRole !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (!adminUserId) {
    return res.status(403).json({ error: 'Admin user not found for this tenant' });
  }

  if (!proposed_start_date || !proposed_end_date) {
    return res.status(400).json({ error: 'Both start and end dates are required' });
  }

  try {
    // Get request details
    const request = await pool.query(
      'SELECT * FROM leave_requests WHERE request_id = $1',
      [id]
    );

    if (request.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const leaveRequest = request.rows[0];

    // Calculate new total days
    const start = new Date(proposed_start_date);
    const end = new Date(proposed_end_date);
    const newTotalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Update request with proposed dates and notes
    await pool.query(
      'UPDATE leave_requests SET start_date = $1, end_date = $2, total_days = $3, admin_notes = $4, admin_user_id = $5, status = $6, updated_at = NOW() WHERE request_id = $7',
      [proposed_start_date, proposed_end_date, newTotalDays, admin_notes, adminUserId, 'modified', id]
    );

    res.json({ message: 'Vacation dates proposed successfully' });
  } catch (err) {
    console.error('Error proposing vacation dates:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get leave history for the past 12 months (Admin and Time Tracking users)
router.get('/history', async (req: Request, res: Response) => {
  const userRole = req.user?.access_role;
  
  if (userRole !== 'Admin' && userRole !== 'Time Tracking') {
    return res.status(403).json({ error: 'Admin or Time Tracking access required' });
  }

  try {
    // Get the date 12 months ago
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const startDate = twelveMonthsAgo.toISOString().split('T')[0];

    const result = await pool.query(`
      SELECT 
        p.id as profile_id,
        p.name as profile_name,
        p.email as profile_email,
        DATE_TRUNC('month', lr.start_date) as month,
        lr.request_type,
        lr.status,
        SUM(lr.total_days) as total_days,
        COUNT(*) as request_count
      FROM profiles p
      LEFT JOIN leave_requests lr ON p.id = lr.profile_id 
        AND lr.start_date >= $1 
        AND lr.status = 'approved'
      GROUP BY p.id, p.name, p.email, DATE_TRUNC('month', lr.start_date), lr.request_type, lr.status
      ORDER BY p.name, month DESC, lr.request_type
    `, [startDate]);

    // Transform the data to group by profile and month
    const historyData: { [key: number]: any } = {};
    
    result.rows.forEach((row: any) => {
      if (!historyData[row.profile_id]) {
        historyData[row.profile_id] = {
          profile_id: row.profile_id,
          profile_name: row.profile_name,
          profile_email: row.profile_email,
          months: {} as { [key: string]: any }
        };
      }
      
      if (row.month) {
        const monthKey = row.month.toISOString().split('T')[0].substring(0, 7); // YYYY-MM format
        
        if (!historyData[row.profile_id].months[monthKey]) {
          historyData[row.profile_id].months[monthKey] = {
            month: monthKey,
            vacation_days: 0,
            sick_days: 0,
            personal_days: 0,
            bereavement_days: 0,
            total_days: 0
          };
        }
        
        if (row.request_type) {
          historyData[row.profile_id].months[monthKey][`${row.request_type}_days`] = parseFloat(row.total_days) || 0;
          historyData[row.profile_id].months[monthKey].total_days += parseFloat(row.total_days) || 0;
        }
      }
    });

    res.json(Object.values(historyData));
  } catch (err) {
    console.error('Error fetching leave history:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get leave statistics for dashboard
router.get('/statistics', async (req: Request, res: Response) => {
  const userRole = req.user?.access_role;
  
  if (userRole !== 'Admin' && userRole !== 'Time Tracking') {
    return res.status(403).json({ error: 'Admin or Time Tracking access required' });
  }

  try {
    const currentDate = new Date();
    const currentMonthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const twelveMonthsAgo = new Date(currentDate.getFullYear(), currentDate.getMonth() - 12, 1);

    // Get statistics for current month
    const currentMonthStats = await pool.query(`
      SELECT 
        COUNT(DISTINCT lr.profile_id) as employees_with_leave,
        COALESCE(SUM(lr.total_days), 0) as total_days
      FROM leave_requests lr
      WHERE lr.start_date >= $1 
        AND lr.start_date < $2 
        AND lr.status = 'approved'
    `, [currentMonthStart, new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1)]);

    // Get statistics for past 12 months
    const twelveMonthsStats = await pool.query(`
      SELECT 
        COALESCE(SUM(lr.total_days), 0) as total_days
      FROM leave_requests lr
      WHERE lr.start_date >= $1 
        AND lr.status = 'approved'
    `, [twelveMonthsAgo]);

    const stats = {
      employees_with_leave_this_month: parseInt(currentMonthStats.rows[0]?.employees_with_leave || 0),
      total_days_this_month: Math.round(parseFloat(currentMonthStats.rows[0]?.total_days || 0)),
      total_days_past_12_months: Math.round(parseFloat(twelveMonthsStats.rows[0]?.total_days || 0))
    };

    res.json(stats);
  } catch (err) {
    console.error('Error fetching leave statistics:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get profiles with vacation days (Admin and Time Tracking users)
router.get('/profiles', async (req: Request, res: Response) => {
  const userRole = req.user?.access_role;
  
  if (userRole !== 'Admin' && userRole !== 'Time Tracking') {
    return res.status(403).json({ error: 'Admin or Time Tracking access required' });
  }

  try {
    const result = await pool.query(`
      SELECT 
        p.id, 
        p.name, 
        p.email, 
        COALESCE(vdm.total_vacation_days, 20) as total_vacation_days,
        COALESCE(CAST(vdm.days_used AS INTEGER), 0) as days_used,
        COALESCE(CAST(vdm.days_remaining AS INTEGER), 20) as days_remaining,
        COALESCE(vdm.reset_date, (SELECT reset_date FROM vacation_reset_settings WHERE is_active = true LIMIT 1)) as reset_date
      FROM profiles p
      LEFT JOIN vacation_days_management vdm ON p.id = vdm.profile_id
      ORDER BY p.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching profiles:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get vacation reset settings (Admin only)
router.get('/vacation-settings', async (req: Request, res: Response) => {
  const userRole = req.user?.access_role;
  
  if (userRole !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const result = await pool.query(`
      SELECT reset_date, is_active
      FROM vacation_reset_settings 
      WHERE is_active = true 
      LIMIT 1
    `);
    res.json(result.rows[0] || { reset_date: null, is_active: true });
  } catch (err) {
    console.error('Error fetching vacation settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update vacation reset date (Admin only)
router.put('/vacation-settings', async (req: Request, res: Response) => {
  const userRole = req.user?.access_role;
  const { reset_date } = req.body;
  
  if (userRole !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (!reset_date) {
    return res.status(400).json({ error: 'Reset date is required' });
  }

  try {
    // Update the reset date for all active settings
    await pool.query(`
      UPDATE vacation_reset_settings 
      SET reset_date = $1, updated_at = NOW()
      WHERE is_active = true
    `, [reset_date]);

    // Update all vacation days management records with the new reset date
    await pool.query(`
      UPDATE vacation_days_management 
      SET reset_date = $1, updated_at = NOW()
    `, [reset_date]);

    res.json({ message: 'Vacation reset date updated successfully' });
  } catch (err) {
    console.error('Error updating vacation settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update individual employee vacation days (Admin only)
router.put('/profiles/:id/vacation-days', async (req: Request, res: Response) => {
  const userRole = req.user?.access_role;
  const { id } = req.params;
  const { total_vacation_days } = req.body;
  
  if (userRole !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (!total_vacation_days || total_vacation_days < 0 || !Number.isInteger(total_vacation_days)) {
    return res.status(400).json({ error: 'Valid integer total vacation days is required' });
  }

  try {
    // Get the current reset date
    const resetDateResult = await pool.query(`
      SELECT reset_date FROM vacation_reset_settings WHERE is_active = true LIMIT 1
    `);
    const resetDate = resetDateResult.rows[0]?.reset_date || new Date().toISOString().split('T')[0];

    // Insert or update vacation days management
    await pool.query(`
      INSERT INTO vacation_days_management (profile_id, total_vacation_days, reset_date)
      VALUES ($1, $2, $3)
      ON CONFLICT (profile_id) 
      DO UPDATE SET 
        total_vacation_days = $2,
        updated_at = NOW()
    `, [id, total_vacation_days, resetDate]);

    // Update the profiles table for backward compatibility
    await pool.query(`
      UPDATE profiles 
      SET vacation_days_available = $1
      WHERE id = $2
    `, [total_vacation_days, id]);

    res.json({ message: 'Vacation days updated successfully' });
  } catch (err) {
    console.error('Error updating vacation days:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset vacation days for all employees (Admin only)
router.post('/reset-vacation-days', async (req: Request, res: Response) => {
  const userRole = req.user?.access_role;
  
  if (userRole !== 'Admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    // Call the database function to reset all vacation days
    await pool.query('SELECT reset_vacation_days_for_all()');
    
    res.json({ message: 'Vacation days reset successfully for all employees. Reset date has been updated to the same month and day next year.' });
  } catch (err) {
    console.error('Error resetting vacation days:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Accept modified request (User action)
router.post('/accept-modified/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = await resolveTenantUserId(pool, req.user);

  if (!userId) {
    return res.status(403).json({ error: 'User record not found for this tenant' });
  }

  try {
    // Get request details
    const request = await pool.query(
      'SELECT * FROM leave_requests WHERE request_id = $1',
      [id]
    );

    if (request.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const leaveRequest = request.rows[0];

    // Verify user owns this request
    if (leaveRequest.user_id !== userId) {
      return res.status(403).json({ error: 'Access denied to this request' });
    }

    // Verify request is in modified status
    if (leaveRequest.status !== 'modified') {
      return res.status(400).json({ error: 'Request is not in modified status' });
    }

    // Update request status to approved
    await pool.query(
      'UPDATE leave_requests SET status = $1, updated_at = NOW() WHERE request_id = $2',
      ['approved', id]
    );

    // If vacation request, deduct days from profile
    if (leaveRequest.request_type === 'vacation') {
      await pool.query(
        'UPDATE profiles SET vacation_days_available = vacation_days_available - $1 WHERE id = $2',
        [leaveRequest.total_days, leaveRequest.profile_id]
      );
    }

    res.json({ message: 'Modified request accepted successfully' });
  } catch (err) {
    console.error('Error accepting modified request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Resend request (User action)
router.post('/resend/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { request_type, start_date, end_date, reason } = req.body;
  const userId = await resolveTenantUserId(pool, req.user);

  if (!userId) {
    return res.status(403).json({ error: 'User record not found for this tenant' });
  }

  try {
    // Get request details
    const request = await pool.query(
      'SELECT * FROM leave_requests WHERE request_id = $1',
      [id]
    );

    if (request.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const leaveRequest = request.rows[0];

    // Verify user owns this request
    if (leaveRequest.user_id !== userId) {
      return res.status(403).json({ error: 'Access denied to this request' });
    }

    // Verify request is in modified status
    if (leaveRequest.status !== 'modified') {
      return res.status(400).json({ error: 'Request is not in modified status' });
    }

    // Validate required fields
    if (!request_type || !start_date || !end_date) {
      return res.status(400).json({ error: 'Request type, start date, and end date are required' });
    }

    // Calculate total days
    const start = new Date(start_date);
    const end = new Date(end_date);
    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // For vacation requests, check available days
    if (request_type === 'vacation') {
      const profile = await pool.query(
        'SELECT vacation_days_available FROM profiles WHERE id = $1',
        [leaveRequest.profile_id]
      );
      
      if (profile.rows[0].vacation_days_available < totalDays) {
        return res.status(400).json({ 
          error: 'Insufficient vacation days',
          available: profile.rows[0].vacation_days_available,
          requested: totalDays
        });
      }
    }

    // For personal and bereavement, check if they exceed reasonable limits
    if (request_type === 'personal' && totalDays > 5) {
      return res.status(400).json({ 
        error: 'Personal leave cannot exceed 5 days',
        requested: totalDays,
        max_allowed: 5
      });
    }

    if (request_type === 'bereavement' && totalDays > 10) {
      return res.status(400).json({ 
        error: 'Bereavement leave cannot exceed 10 days',
        requested: totalDays,
        max_allowed: 10
      });
    }

    // Update the existing request with new data and reset status to pending
    await pool.query(
      `UPDATE leave_requests 
       SET request_type = $1, start_date = $2, end_date = $3, reason = $4, total_days = $5, 
           status = $6, admin_notes = NULL, admin_user_id = NULL, updated_at = NOW()
       WHERE request_id = $7`,
      [request_type, start_date, end_date, reason, totalDays, 'pending', id]
    );

    res.json({ message: 'Request resent successfully' });
  } catch (err) {
    console.error('Error resending request:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

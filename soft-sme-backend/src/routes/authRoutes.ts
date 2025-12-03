import express, { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import path from 'path';
import { authMiddleware, adminAuth } from '../middleware/authMiddleware';
import { sharedPool as pool } from '../dbShared';
import { SessionManager } from '../utils/sessionManager';

const router = express.Router();

interface JwtPayload {
  id: string;
  email: string;
  userId: string;
  company_id: string;
  role: string;
  access_role: string;
}

// Register User (This endpoint might become less relevant if all users belong to a company)
router.post('/register', async (req: Request, res: Response) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email',
      [username, email, hashedPassword]
    );
    const user = result.rows[0];
    res.status(201).json({ message: 'User registered successfully', user: { id: user.id, username: user.username, email: user.email } });
  } catch (error) {
    console.error('Error registering user:', error);
    if ((error as any).code === '23505') { // Unique violation code
      return res.status(409).json({ message: 'Username or email already exists' });
    }
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// Register a new company and admin user
router.post('/register-company', async (req: Request, res: Response) => {
  try {
    const { company_name, admin_username, admin_email, admin_password } = req.body;

    // Start a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create company
      const companyResult = await client.query(
        'INSERT INTO companies (company_name) VALUES ($1) RETURNING id',
        [company_name]
      );
      const companyId = companyResult.rows[0].id;

      // Hash password
      const hashedPassword = await bcrypt.hash(admin_password, 10);

      // Create admin user
      const userResult = await client.query(
        'INSERT INTO users (username, email, password_hash, company_id, role, access_role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, email, company_id, role, access_role',
        [admin_username, admin_email, hashedPassword, companyId, 'Admin', 'Admin']
      );

      const user = userResult.rows[0];

      await client.query('COMMIT');

      // Create session for admin user (after commit)
      const deviceInfo = SessionManager.extractDeviceInfo(req);
      const locationInfo = SessionManager.extractLocationInfo(req);
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || '';

      const { sessionToken, refreshToken } = await SessionManager.createSession(
        user.id,
        deviceInfo,
        ipAddress,
        userAgent,
        locationInfo
      );

      // Return user data and tokens
      res.status(201).json({
        sessionToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          company_id: user.company_id,
          role: user.role,
          access_role: user.access_role,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Transaction error:', error);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Registration error:', error);
    if ((error as any).code === '23505') { // Unique violation code
      return res.status(409).json({ message: 'Company name, username, or email already exists' });
    }
    res.status(500).json({ message: 'Failed to register company' });
  }
});

// Register Employee (Admin Only)
router.post('/register-employee', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { username, email, password, role = 'Employee', access_role = 'Employee' } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (company_id, username, email, password_hash, role, access_role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [req.user?.company_id, username, email, hashedPassword, role, access_role]
    );

    res.status(201).json({ message: 'Employee registered successfully', userId: result.rows[0].id });
  } catch (err: unknown) {
    console.error('Error registering employee:', err);
    if ((err as any).code === '23505') { // Unique violation code
      return res.status(409).json({ message: 'Username or email already exists in this company' });
    } else {
      res.status(500).json({ message: 'An unexpected error occurred.' });
    }
  }
});

// Change Password (Authenticated Users)
router.post('/change-password', authMiddleware, async (req: Request, res: Response) => {
  const { oldPassword, newPassword } = req.body;
  const userId = req.user?.id;

  if (!userId || !oldPassword || !newPassword) {
    return res.status(400).json({ message: 'User ID, old password, and new password are required' });
  }

  try {
    const result = await pool.query('SELECT id, password_hash FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isPasswordValid = await bcrypt.compare(oldPassword, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid old password' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      'UPDATE users SET password_hash = $1, force_password_change = FALSE WHERE id = $2',
      [hashedNewPassword, userId]
    );

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'Server error during password change' });
  }
});

// Login User with Session Management
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, email, password_hash, company_id, role, access_role FROM users WHERE email = $1',
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Create session for user
    const deviceInfo = SessionManager.extractDeviceInfo(req);
    const locationInfo = SessionManager.extractLocationInfo(req);
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || '';

    const sessionResult = await SessionManager.createSession(
      user.id,
      deviceInfo,
      ipAddress,
      userAgent,
      locationInfo
    );
    console.log('[DEBUG] SessionManager.createSession result:', sessionResult);

    // Set refresh token as httpOnly, secure cookie
    res.cookie('refreshToken', sessionResult.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/api/auth',
    });

    const responsePayload = {
      sessionToken: sessionResult.sessionToken,
      refreshToken: sessionResult.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        company_id: user.company_id,
        role: user.role,
        access_role: user.access_role,
      },
    };
    console.log('[DEBUG] /login response payload:', responsePayload);
    res.json(responsePayload);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Refresh Session Token
router.post('/refresh', async (req: Request, res: Response) => {
  // Try to get refreshToken from cookie first, then body
  const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

  if (!refreshToken) {
    return res.status(400).json({ message: 'Refresh token is required' });
  }

  try {
    const result = await SessionManager.refreshSession(refreshToken);

    if (result.success === false) {
      // Log failed refresh with reason and a short prefix of the token for traceability
      const tokenPrefix = refreshToken ? refreshToken.slice(0, 8) : 'none';
      console.log(`[SESSION] Invalid refresh token (${result.reason}) used at ${new Date().toISOString()} token=${tokenPrefix}...`);
      // Clear refresh token cookie so the client stops retrying with a bad token
      res.clearCookie('refreshToken', { path: '/api/auth' });
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }

    // At this point result is a success payload
    const tokenPrefix = result.refreshToken.slice(0, 8);
    console.log(`[SESSION] Session refreshed at ${new Date().toISOString()} token=${tokenPrefix}...`);

    // Set new refresh token as httpOnly, secure cookie
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/api/auth',
    });

    // Return both tokens so the client can persist the rotated refresh token
    res.json({
      sessionToken: result.sessionToken,
      refreshToken: result.refreshToken,
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ message: 'Server error during token refresh' });
  }
});

// Get current user
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, company_id, role, access_role FROM users WHERE id = $1',
      [req.user?.id]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      id: user.id,
      email: user.email,
      company_id: user.company_id,
      role: user.role,
      access_role: user.access_role,
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'Server error while fetching user data' });
  }
});

// Get user sessions (for managing multiple devices)
router.get('/sessions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const sessions = await SessionManager.getUserSessions(parseInt(req.user?.id || '0'));
    
    // Remove sensitive data before sending to client
    const safeSessions = sessions.map(session => ({
      id: session.id,
      deviceInfo: session.deviceInfo,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      locationInfo: session.locationInfo,
      isActive: session.isActive,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt
    }));

    res.json(safeSessions);
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ message: 'Server error while fetching sessions' });
  }
});

// Deactivate a specific session (logout from specific device)
router.delete('/sessions/:sessionId', authMiddleware, async (req: Request, res: Response) => {
  try {
    const sessionId = parseInt(req.params.sessionId);
    const userId = parseInt(req.user?.id || '0');

    const success = await SessionManager.deactivateSession(sessionId, userId);

    if (!success) {
      return res.status(404).json({ message: 'Session not found or not authorized' });
    }

    res.json({ message: 'Session deactivated successfully' });
  } catch (error) {
    console.error('Error deactivating session:', error);
    res.status(500).json({ message: 'Server error while deactivating session' });
  }
});

// Logout from all devices
router.post('/logout-all', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.user?.id || '0');
    await SessionManager.deactivateAllSessions(userId);
    // Log session invalidation
    console.log(`[SESSION] User ${userId} logged out from all devices at ${new Date().toISOString()}`);
    // Clear refresh token cookie
    res.clearCookie('refreshToken', { path: '/api/auth' });
    res.json({ message: 'Logged out from all devices successfully' });
  } catch (error) {
    console.error('Error logging out from all devices:', error);
    res.status(500).json({ message: 'Server error while logging out' });
  }
});

// Update user roles (Admin only)
router.put('/update-user-roles/:id', authMiddleware, async (req: Request, res: Response) => {
  const { role, access_role } = req.body;
  const userId = req.params.id;

  if (!role || !access_role) {
    return res.status(400).json({ message: 'Role and access role are required' });
  }

  try {
    const result = await pool.query(
      'UPDATE users SET role = $1, access_role = $2 WHERE id = $3 RETURNING id, role, access_role',
      [role, access_role, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'User roles updated successfully',
      user: {
        id: result.rows[0].id,
        role: result.rows[0].role,
        access_role: result.rows[0].access_role,
      },
    });
  } catch (error) {
    console.error('Error updating user roles:', error);
    res.status(500).json({ message: 'Server error while updating user roles' });
  }
});

// Get company session settings (Admin only)
router.get('/company-session-settings', authMiddleware, adminAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT max_concurrent_sessions, session_timeout_hours, refresh_token_days, allow_multiple_devices FROM companies WHERE id = $1',
      [req.user?.company_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching company session settings:', error);
    res.status(500).json({ message: 'Server error while fetching session settings' });
  }
});

// Update company session settings (Admin only)
router.put('/company-session-settings', authMiddleware, adminAuth, async (req: Request, res: Response) => {
  const { max_concurrent_sessions, session_timeout_hours, refresh_token_days, allow_multiple_devices } = req.body;

  try {
    const result = await pool.query(
      `UPDATE companies 
       SET max_concurrent_sessions = $1, 
           session_timeout_hours = $2, 
           refresh_token_days = $3, 
           allow_multiple_devices = $4
       WHERE id = $5 
       RETURNING max_concurrent_sessions, session_timeout_hours, refresh_token_days, allow_multiple_devices`,
      [max_concurrent_sessions, session_timeout_hours, refresh_token_days, allow_multiple_devices, req.user?.company_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Company not found' });
    }

    res.json({
      message: 'Session settings updated successfully',
      settings: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating company session settings:', error);
    res.status(500).json({ message: 'Server error while updating session settings' });
  }
});

// Get all active sessions for company (Admin only)
router.get('/company-sessions', authMiddleware, adminAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT us.id, us.user_id, us.device_info, us.ip_address, us.user_agent, us.location_info, 
              us.is_active, us.expires_at, us.created_at, us.last_used_at,
              u.username, u.email, u.role, u.access_role
       FROM user_sessions us
       JOIN users u ON us.user_id = u.id
       WHERE u.company_id = $1 AND us.is_active = TRUE
       ORDER BY us.last_used_at DESC`,
      [req.user?.company_id]
    );

    // Remove sensitive data before sending to client
    const safeSessions = result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      username: row.username,
      email: row.email,
      role: row.role,
      accessRole: row.access_role,
      deviceInfo: row.device_info,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      locationInfo: row.location_info,
      isActive: row.is_active,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at
    }));

    res.json(safeSessions);
  } catch (error) {
    console.error('Error fetching company sessions:', error);
    res.status(500).json({ message: 'Server error while fetching company sessions' });
  }
});

// Force logout user from all devices (Admin only)
router.post('/force-logout-user/:userId', authMiddleware, adminAuth, async (req: Request, res: Response) => {
  try {
    const targetUserId = parseInt(req.params.userId);
    
    // Verify the target user belongs to the same company
    const userCheck = await pool.query(
      'SELECT id FROM users WHERE id = $1 AND company_id = $2',
      [targetUserId, req.user?.company_id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'User not found or not authorized' });
    }

    await SessionManager.deactivateAllSessions(targetUserId);
    res.json({ message: 'User logged out from all devices successfully' });
  } catch (error) {
    console.error('Error forcing user logout:', error);
    res.status(500).json({ message: 'Server error while forcing user logout' });
  }
});

export default router; 

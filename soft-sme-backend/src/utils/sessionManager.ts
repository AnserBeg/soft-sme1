import { sharedPool as pool } from '../dbShared';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Request } from 'express';

export interface DeviceInfo {
  deviceId: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  browser: string;
  os: string;
  screenResolution?: string;
  timezone?: string;
}

export interface LocationInfo {
  ip: string;
  country?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
}

export interface SessionData {
  id: number;
  userId: number;
  sessionToken: string;
  refreshToken: string;
  deviceInfo: DeviceInfo;
  ipAddress: string;
  userAgent: string;
  locationInfo?: LocationInfo;
  isActive: boolean;
  expiresAt: Date;
  refreshExpiresAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
}

export class SessionManager {
  private static readonly SESSION_SECRET = process.env.JWT_SECRET || 'your-secret-key';
  private static readonly REFRESH_SECRET = process.env.REFRESH_SECRET || 'your-refresh-secret-key';

  /**
   * Create a new session for a user
   */
  static async createSession(
    userId: number,
    deviceInfo: DeviceInfo,
    ipAddress: string,
    userAgent: string,
    locationInfo?: LocationInfo
  ): Promise<{ sessionToken: string; refreshToken: string; sessionData: SessionData }> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Get company settings for session limits
      const companyResult = await client.query(
        'SELECT c.max_concurrent_sessions, c.session_timeout_hours, c.refresh_token_days, c.allow_multiple_devices FROM users u JOIN companies c ON u.company_id = c.id WHERE u.id = $1',
        [userId]
      );

      if (companyResult.rows.length === 0) {
        throw new Error('User or company not found');
      }

      const companySettings = companyResult.rows[0];
      
      // Check if multiple devices are allowed
      if (!companySettings.allow_multiple_devices) {
        // Deactivate all existing sessions
        await client.query(
          'UPDATE user_sessions SET is_active = FALSE WHERE user_id = $1',
          [userId]
        );
      } else {
        // Check concurrent session limit
        const activeSessionsResult = await client.query(
          'SELECT COUNT(*) FROM user_sessions WHERE user_id = $1 AND is_active = TRUE',
          [userId]
        );
        
        const activeSessionsCount = parseInt(activeSessionsResult.rows[0].count);
        
        if (activeSessionsCount >= companySettings.max_concurrent_sessions) {
          // Deactivate oldest session
          await client.query(
            'UPDATE user_sessions SET is_active = FALSE WHERE id = (SELECT id FROM user_sessions WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at ASC LIMIT 1)',
            [userId]
          );
        }
      }

      // Generate tokens
      const sessionToken = this.generateSessionToken(userId);
      const refreshToken = this.generateRefreshToken(userId);

      // Calculate expiration times
      const sessionExpiresAt = new Date();
      sessionExpiresAt.setHours(sessionExpiresAt.getHours() + companySettings.session_timeout_hours);

      const refreshExpiresAt = new Date();
      refreshExpiresAt.setDate(refreshExpiresAt.getDate() + companySettings.refresh_token_days);

      // Create session record
      const sessionResult = await client.query(
        `INSERT INTO user_sessions 
         (user_id, session_token, refresh_token, device_info, ip_address, user_agent, location_info, expires_at, refresh_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          userId,
          sessionToken,
          refreshToken,
          JSON.stringify(deviceInfo),
          ipAddress,
          userAgent,
          locationInfo ? JSON.stringify(locationInfo) : null,
          sessionExpiresAt,
          refreshExpiresAt
        ]
      );

      // Update user's last login info
      await client.query(
        'UPDATE users SET last_login_at = CURRENT_TIMESTAMP, last_login_ip = $1 WHERE id = $2',
        [ipAddress, userId]
      );

      await client.query('COMMIT');

      const sessionData = this.mapSessionData(sessionResult.rows[0]);

      return {
        sessionToken,
        refreshToken,
        sessionData
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Validate a session token
   */
  static async validateSession(sessionToken: string): Promise<SessionData | null> {
    try {
      const result = await pool.query(
        `SELECT * FROM user_sessions 
         WHERE session_token = $1 
         AND is_active = TRUE 
         AND expires_at > CURRENT_TIMESTAMP`,
        [sessionToken]
      );

      if (result.rows.length === 0) {
        return null;
      }

      // Update last used timestamp
      await pool.query(
        'UPDATE user_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
        [result.rows[0].id]
      );

      return this.mapSessionData(result.rows[0]);
    } catch (error) {
      console.error('Error validating session:', error);
      return null;
    }
  }

  /**
   * Refresh a session using refresh token
   */
  static async refreshSession(refreshToken: string): Promise<
    | { success: true; sessionToken: string; refreshToken: string }
    | { success: false; reason: 'not_found' | 'inactive' | 'expired' | 'error' }
  > {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Fetch the session regardless of status to provide detailed reason codes
      const lookupResult = await client.query(
        `SELECT * FROM user_sessions 
         WHERE refresh_token = $1`,
        [refreshToken]
      );

      if (lookupResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'not_found' };
      }

      const session = lookupResult.rows[0];

      if (!session.is_active) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'inactive' };
      }

      if (new Date(session.refresh_expires_at) <= new Date()) {
        await client.query('ROLLBACK');
        return { success: false, reason: 'expired' };
      }

      // Generate new tokens
      const newSessionToken = this.generateSessionToken(session.user_id);
      const newRefreshToken = this.generateRefreshToken(session.user_id);

      // Get company settings for new expiration times
      const companyResult = await client.query(
        'SELECT c.session_timeout_hours, c.refresh_token_days FROM users u JOIN companies c ON u.company_id = c.id WHERE u.id = $1',
        [session.user_id]
      );

      const companySettings = companyResult.rows[0];
      
      const sessionExpiresAt = new Date();
      sessionExpiresAt.setHours(sessionExpiresAt.getHours() + companySettings.session_timeout_hours);

      const refreshExpiresAt = new Date();
      refreshExpiresAt.setDate(refreshExpiresAt.getDate() + companySettings.refresh_token_days);

      // Update session with new tokens
      await client.query(
        `UPDATE user_sessions 
         SET session_token = $1, refresh_token = $2, expires_at = $3, refresh_expires_at = $4, last_used_at = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [newSessionToken, newRefreshToken, sessionExpiresAt, refreshExpiresAt, session.id]
      );

      await client.query('COMMIT');

      return {
        success: true,
        sessionToken: newSessionToken,
        refreshToken: newRefreshToken
      };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error refreshing session:', error);
      return { success: false, reason: 'error' };
    } finally {
      client.release();
    }
  }

  /**
   * Get all active sessions for a user
   */
  static async getUserSessions(userId: number): Promise<SessionData[]> {
    const result = await pool.query(
      `SELECT * FROM user_sessions 
       WHERE user_id = $1 AND is_active = TRUE 
       ORDER BY last_used_at DESC`,
      [userId]
    );

    return result.rows.map(row => this.mapSessionData(row));
  }

  /**
   * Deactivate a specific session
   */
  static async deactivateSession(sessionId: number, userId: number): Promise<boolean> {
    const result = await pool.query(
      'UPDATE user_sessions SET is_active = FALSE WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Deactivate all sessions for a user (logout from all devices)
   */
  static async deactivateAllSessions(userId: number): Promise<boolean> {
    const result = await pool.query(
      'UPDATE user_sessions SET is_active = FALSE WHERE user_id = $1',
      [userId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Clean up expired sessions
   */
  static async cleanupExpiredSessions(): Promise<number> {
    const result = await pool.query(
      'UPDATE user_sessions SET is_active = FALSE WHERE expires_at < CURRENT_TIMESTAMP AND is_active = TRUE'
    );

    return result.rowCount ?? 0;
  }

  /**
   * Extract device info from request
   */
  static extractDeviceInfo(req: Request): DeviceInfo {
    const userAgent = req.headers['user-agent'] || '';
    const deviceId = req.headers['x-device-id'] as string || crypto.randomUUID();

    // Simple device detection (you might want to use a library like ua-parser-js)
    let deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown' = 'unknown';
    let browser = 'Unknown';
    let os = 'Unknown';

    if (userAgent.includes('Mobile')) {
      deviceType = 'mobile';
    } else if (userAgent.includes('Tablet')) {
      deviceType = 'tablet';
    } else if (userAgent.includes('Windows') || userAgent.includes('Mac') || userAgent.includes('Linux')) {
      deviceType = 'desktop';
    }

    if (userAgent.includes('Chrome')) browser = 'Chrome';
    else if (userAgent.includes('Firefox')) browser = 'Firefox';
    else if (userAgent.includes('Safari')) browser = 'Safari';
    else if (userAgent.includes('Edge')) browser = 'Edge';

    if (userAgent.includes('Windows')) os = 'Windows';
    else if (userAgent.includes('Mac')) os = 'macOS';
    else if (userAgent.includes('Linux')) os = 'Linux';
    else if (userAgent.includes('Android')) os = 'Android';
    else if (userAgent.includes('iOS')) os = 'iOS';

    return {
      deviceId,
      deviceType,
      browser,
      os,
      timezone: req.headers['x-timezone'] as string
    };
  }

  /**
   * Extract location info from request
   */
  static extractLocationInfo(req: Request): LocationInfo {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    
    return {
      ip: ip.toString()
    };
  }

  private static generateSessionToken(userId: number): string {
    // Generate a random token instead of JWT to avoid expiration conflicts
    return crypto.randomBytes(64).toString('hex');
  }

  private static generateRefreshToken(userId: number): string {
    return crypto.randomBytes(64).toString('hex');
  }

  private static mapSessionData(row: any): SessionData {
    return {
      id: row.id,
      userId: row.user_id,
      sessionToken: row.session_token,
      refreshToken: row.refresh_token,
      deviceInfo: row.device_info,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      locationInfo: row.location_info,
      isActive: row.is_active,
      expiresAt: row.expires_at,
      refreshExpiresAt: row.refresh_expires_at,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at
    };
  }
} 

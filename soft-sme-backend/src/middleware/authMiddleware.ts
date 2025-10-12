import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db';
import { SessionManager } from '../utils/sessionManager';

interface JwtPayload {
  id: string;
  email: string;
  company_id: string;
  access_role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

const sanitizeEnvValue = (value?: string | null): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  const withoutQuotes = trimmed.replace(/^['"](.+)['"]$/s, '$1').trim();

  return withoutQuotes.length > 0 ? withoutQuotes : undefined;
};

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    const configuredServiceToken = sanitizeEnvValue(process.env.AI_AGENT_SERVICE_TOKEN);
    const configuredServiceApiKey = sanitizeEnvValue(process.env.AI_AGENT_SERVICE_API_KEY);
    const incomingApiKeyHeader = req.headers['x-api-key'];
    const incomingApiKey = Array.isArray(incomingApiKeyHeader)
      ? incomingApiKeyHeader[0]
      : incomingApiKeyHeader;

    if (configuredServiceToken && authHeader && authHeader === configuredServiceToken) {
      (req as any).auth = { kind: 'service', via: 'bearer' };
      return next();
    }

    if (configuredServiceApiKey && incomingApiKey && incomingApiKey === configuredServiceApiKey) {
      (req as any).auth = { kind: 'service', via: 'api-key' };
      return next();
    }

    if (!authHeader) {
      return res.status(401).json({ message: 'No authorization header' });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    // Validate session using SessionManager
    const session = await SessionManager.validateSession(token);

    if (!session) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    // Get user details from database
    const result = await pool.query(
      'SELECT id, email, company_id, access_role FROM users WHERE id = $1',
      [session.userId]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      company_id: user.company_id,
      access_role: user.access_role,
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ message: 'Authentication failed' });
  }
};

export const adminAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (req.user.access_role !== 'Admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    next();
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
}; 
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { sharedPool } from '../dbShared';
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

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

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
    const result = await sharedPool.query(
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

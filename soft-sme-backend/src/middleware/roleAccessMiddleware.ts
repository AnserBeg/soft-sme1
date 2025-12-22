import { Request, Response, NextFunction } from 'express';

export const ACCESS_ROLES = {
  ADMIN: 'Admin',
  SALES_PURCHASE: 'Sales and Purchase',
  TIME_TRACKING: 'Time Tracking',
  MOBILE_TIME_TRACKER: 'Mobile Time Tracker',
} as const;

const normalizeRole = (role?: string | null) =>
  (role ?? '')
    .trim()
    .toLowerCase()
    .replace(/[&/]+/g, ' and ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const requireAccessRoles = (roles: string[]) => {
  const allowedRoles = new Set(roles.map(normalizeRole));
  const adminRole = normalizeRole(ACCESS_ROLES.ADMIN);

  return (req: Request, res: Response, next: NextFunction) => {
    const role = normalizeRole(req.user?.access_role);
    if (!role) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (role === adminRole) {
      return next();
    }

    if (!allowedRoles.has(role)) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    return next();
  };
};

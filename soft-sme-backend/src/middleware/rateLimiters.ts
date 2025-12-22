import { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';

const getClientIp = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0] ?? req.ip ?? 'unknown';
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
};

type LimiterOptions = {
  windowMs: number;
  max: number;
  message: string;
  skipSuccessfulRequests?: boolean;
};

const buildLimiter = ({ windowMs, max, message, skipSuccessfulRequests }: LimiterOptions) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getClientIp,
    skipSuccessfulRequests: Boolean(skipSuccessfulRequests),
    handler: (_req: Request, res: Response) => {
      res.status(429).json({ message });
    },
  });

export const loginRateLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  skipSuccessfulRequests: true,
});

export const loginMobileRateLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  skipSuccessfulRequests: true,
});

export const registerRateLimiter = buildLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many registration attempts. Please try again later.',
});

export const registerCompanyRateLimiter = buildLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: 'Too many company registration attempts. Please try again later.',
});

export const passwordChangeRateLimiter = buildLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many password change attempts. Please try again later.',
});

export const refreshRateLimiter = buildLimiter({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: 'Too many session refresh attempts. Please try again shortly.',
});

export const csrfTokenRateLimiter = buildLimiter({
  windowMs: 5 * 60 * 1000,
  max: 60,
  message: 'Too many CSRF token requests. Please try again shortly.',
});

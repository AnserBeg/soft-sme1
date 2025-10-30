import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);

type Canonicalizable =
  | string
  | number
  | boolean
  | null
  | undefined
  | bigint
  | symbol
  | Record<string, unknown>
  | unknown[];

function canonicalize(value: Canonicalizable, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number') {
      if (Number.isNaN(value)) {
        return 'NaN';
      }
      if (!Number.isFinite(value)) {
        return value > 0 ? 'Infinity' : '-Infinity';
      }
      return value;
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (typeof value === 'undefined') {
      return null;
    }

    if (typeof value === 'symbol') {
      return value.toString();
    }

    return value;
  }

  const candidate = value as Record<string, unknown>;

  if (candidate instanceof Date) {
    return candidate.toISOString();
  }

  if (Buffer.isBuffer(candidate)) {
    return candidate.toString('base64');
  }

  if (Array.isArray(candidate)) {
    return candidate.map((item) => canonicalize(item as Canonicalizable, seen));
  }

  if (typeof (candidate as unknown as { toJSON?: () => unknown }).toJSON === 'function') {
    return canonicalize(
      ((candidate as unknown as { toJSON: () => unknown }).toJSON() ?? null) as Canonicalizable,
      seen
    );
  }

  if (seen.has(candidate)) {
    throw new TypeError('Cannot canonicalize circular structure');
  }

  seen.add(candidate);
  const sortedEntries = Object.entries(candidate)
    .filter(([key]) => Object.prototype.hasOwnProperty.call(candidate, key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => [key, canonicalize(val as Canonicalizable, seen)] as const);
  seen.delete(candidate);

  const normalized: Record<string, unknown> = {};
  for (const [key, val] of sortedEntries) {
    normalized[key] = val;
  }

  return normalized;
}

export function canonicalStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const canonical = canonicalize(value as Canonicalizable, seen);
  return JSON.stringify(canonical);
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
}

function fromBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  return Buffer.from(padded, 'base64');
}

export function hashCanonicalJson(value: unknown): string {
  const canonical = canonicalStringify(value);
  const digest = createHash('sha256').update(canonical).digest();
  return toBase64Url(digest);
}

export function hashPlan(plan: unknown): string {
  return hashCanonicalJson(plan);
}

export function makePlan<T>(kind: string, payload: T): { kind: string; payload: T; planId: string } {
  const plan = { kind, payload };
  return { ...plan, planId: hashPlan(plan) };
}

export function verifyConfirmToken(planId: string, token: string, secret: string): boolean {
  if (!planId || !token || !secret) {
    return false;
  }

  try {
    const expected = createHmac('sha256', secret).update(planId).digest();
    const provided = fromBase64Url(token);

    if (expected.length !== provided.length) {
      return false;
    }

    return timingSafeEqual(expected, provided);
  } catch (error) {
    return false;
  }
}

export function requireIdempotencyKey(req: Request, res: Response, next: NextFunction): void {
  const commitRaw = req.query.commit;
  const commitValue = Array.isArray(commitRaw) ? commitRaw[commitRaw.length - 1] : commitRaw;
  const shouldEnforce =
    typeof commitValue === 'string'
      ? TRUE_VALUES.has(commitValue.toLowerCase())
      : Boolean(commitValue);

  if (!shouldEnforce) {
    next();
    return;
  }

  const headerValue = req.get('x-idempotency-key');
  const trimmed = headerValue?.trim();

  if (!trimmed) {
    res.status(400).json({ error: 'X-Idempotency-Key header is required when commit=true.' });
    return;
  }

  res.locals.idempotencyKey = trimmed;
  next();
}

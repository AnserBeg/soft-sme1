import express, { Request, Response } from 'express';
import { fuzzySearch, FuzzySearchType } from '../services/FuzzySearchService';

const router = express.Router();

function normalizeType(raw: unknown): FuzzySearchType | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const lower = raw.trim().toLowerCase();
  if (lower === 'vendor' || lower === 'customer' || lower === 'part') {
    return lower;
  }
  return undefined;
}

function parseLimit(value: unknown): number | undefined {
  if (value == null) {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return numeric;
}

function parseMinScore(value: unknown): number | undefined {
  if (value == null) {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  return numeric;
}

router.get('/fuzzy', async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const type = normalizeType(req.query.type);
  const rawQuery = typeof req.query.q === 'string' ? req.query.q : '';

  if (!type) {
    return res.status(400).json({ error: 'Invalid or missing type parameter' });
  }

  if (!rawQuery || rawQuery.trim().length === 0) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  const limit = parseLimit(req.query.limit);
  const minScore = parseMinScore(req.query.minScore);

  try {
    const matches = await fuzzySearch({
      type,
      query: rawQuery,
      limit,
      minScore,
    });

    const tookMs = Date.now() - startedAt;
    res.json({ matches, tookMs });
  } catch (error) {
    console.error('searchRoutes /fuzzy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;


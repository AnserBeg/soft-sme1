import express, { Request, Response } from 'express';

// Node 20+ has global fetch; fallback import only if needed
const _fetch: typeof fetch = (global as any).fetch ?? require('node-fetch');

const router = express.Router();

const ASSISTANT_BASE = process.env.ASSISTANT_API_URL || 'http://127.0.0.1:5001';

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const r = await _fetch(`${ASSISTANT_BASE}/health`);
    const j = await r.json();
    res.json(j);
  } catch (err) {
    res.status(500).json({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { prompt, mode } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ message: 'prompt is required' });
    }

    const r = await _fetch(`${ASSISTANT_BASE}/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, mode })
    });

    if (!r.ok) {
      const txt = await r.text();
      return res.status(502).json({ message: 'Assistant service error', detail: txt });
    }

    const j = await r.json();
    res.json(j);
  } catch (err) {
    res.status(500).json({ message: 'Failed to call assistant', error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;


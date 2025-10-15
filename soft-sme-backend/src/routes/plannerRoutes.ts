import express, { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import plannerStreamService from '../services/plannerStreamService';

const router = express.Router();

router.get('/sessions/:sessionId/stream', authMiddleware, async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const planStepId = req.query.planStepId;

  if (!planStepId || typeof planStepId !== 'string') {
    res.status(400).json({
      success: false,
      message: 'planStepId query parameter is required',
    });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const abortController = new AbortController();
  const lastEventIdHeader = req.header('last-event-id') ?? undefined;

  req.on('close', () => {
    abortController.abort();
  });

  try {
    await plannerStreamService.forwardStream({
      sessionId,
      planStepId,
      lastEventId: lastEventIdHeader,
      res,
      signal: abortController.signal,
      traceHeaders: {
        traceId: req.header('x-trace-id') ?? undefined,
        spanId: req.header('x-span-id') ?? undefined,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Planner stream error:', message);
    res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
  } finally {
    res.end();
  }
});

export default router;

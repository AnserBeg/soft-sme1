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
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const abortController = new AbortController();
  const lastEventIdHeader = req.header('last-event-id') ?? undefined;

  const heartbeatIntervalMs = Number(process.env.PLANNER_STREAM_HEARTBEAT_MS ?? '15000');
  const resolvedHeartbeat = Number.isFinite(heartbeatIntervalMs) && heartbeatIntervalMs > 0 ? heartbeatIntervalMs : 15000;

  const sendHeartbeat = () => {
    if (res.writableEnded) {
      return;
    }
    res.write('event: heartbeat\ndata: {}\n\n');
    res.flush?.();
  };

  const heartbeat = setInterval(sendHeartbeat, resolvedHeartbeat);
  // Send an initial heartbeat so proxies flush the headers immediately.
  sendHeartbeat();

  let connectionClosed = false;

  req.on('close', () => {
    connectionClosed = true;
    abortController.abort();
    clearInterval(heartbeat);
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
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
      res.flush?.();
    }
  } finally {
    clearInterval(heartbeat);
    if (!connectionClosed && !res.writableEnded) {
      res.write('event: end\ndata: {"reason":"complete"}\n\n');
      res.flush?.();
    }
    if (!res.writableEnded) {
      res.end();
    }
  }
});

router.get(
  '/sessions/:sessionId/steps/:planStepId/events',
  authMiddleware,
  async (req: Request, res: Response) => {
    const { sessionId, planStepId } = req.params;
    const after = typeof req.query.after === 'string' ? req.query.after : undefined;
    const limitParam = req.query.limit;
    const limit = typeof limitParam === 'string' ? Number(limitParam) : undefined;

    try {
      const payload = await plannerStreamService.fetchReplay({
        sessionId,
        planStepId,
        after,
        limit: Number.isFinite(limit) ? limit : undefined,
        traceHeaders: {
          traceId: req.header('x-trace-id') ?? undefined,
          spanId: req.header('x-span-id') ?? undefined,
        },
      });
      res.json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown planner replay error';
      console.error('Planner replay error:', message);
      res.status(502).json({
        success: false,
        message,
      });
    }
  }
);

export default router;

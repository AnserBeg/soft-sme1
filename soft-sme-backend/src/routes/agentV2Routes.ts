import express, { Request, Response } from 'express';
import { pool } from '../db';
import { authMiddleware } from '../middleware/authMiddleware';
import { AgentOrchestratorV2, AgentToolRegistry } from '../services/agentV2/orchestrator';
import { AgentAnalyticsLogger } from '../services/agentV2/analyticsLogger';
import { AgentToolsV2 } from '../services/agentV2/tools';

const router = express.Router();
const analyticsLogger = new AgentAnalyticsLogger(pool);

const parseNumeric = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const coerceId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const requireId = (value: unknown, label: string): number => {
  const parsed = coerceId(value);
  if (parsed == null) {
    throw new Error(`${label} is required`);
  }
  return parsed;
};

const buildToolRegistry = (
  tools: AgentToolsV2,
  sessionId: number,
  companyId: number,
  userId: number
): AgentToolRegistry => ({
  retrieveDocs: async ({ query }: any) => tools.retrieveDocs(query),
  createSalesOrder: async (args: any) => tools.createSalesOrder(sessionId, args),
  updateSalesOrder: async (args: any) =>
    tools.updateSalesOrder(sessionId, requireId(args?.sales_order_id ?? args?.id, 'sales_order_id'), args?.patch ?? args),
  createPurchaseOrder: async (args: any) => tools.createPurchaseOrder(sessionId, args),
  updatePurchaseOrder: async (args: any) =>
    tools.updatePurchaseOrder(sessionId, requireId(args?.purchase_id ?? args?.id, 'purchase_id'), args?.patch ?? args),
  closePurchaseOrder: async (args: any) =>
    tools.closePurchaseOrder(sessionId, requireId(args?.purchase_id ?? args?.id, 'purchase_id')),
  emailPurchaseOrder: async (args: any) =>
    tools.emailPurchaseOrder(
      sessionId,
      requireId(args?.purchase_id ?? args?.id, 'purchase_id'),
      args?.to,
      args?.message
    ),
  createQuote: async (args: any) => tools.createQuote(sessionId, args),
  updateQuote: async (args: any) =>
    tools.updateQuote(sessionId, requireId(args?.quote_id ?? args?.id, 'quote_id'), args?.patch ?? args),
  emailQuote: async (args: any) =>
    tools.emailQuote(sessionId, requireId(args?.quote_id ?? args?.id, 'quote_id'), args?.to),
  convertQuoteToSO: async (args: any) =>
    tools.convertQuoteToSO(sessionId, requireId(args?.quote_id ?? args?.id, 'quote_id')),
  createTask: async (args: any) => tools.createAgentTask(sessionId, companyId, userId, args),
  updateTask: async (args: any) => tools.updateAgentTask(sessionId, companyId, userId, args),
  postTaskMessage: async (args: any) => tools.postAgentTaskMessage(sessionId, companyId, userId, args),
  updatePickupDetails: async (args: any) =>
    tools.updatePickupDetails(
      sessionId,
      requireId(args?.purchase_id ?? args?.purchaseId ?? args?.id ?? args, 'purchase_id'),
      args
    ),
  getPickupDetails: async (args: any) =>
    tools.getPickupDetails(sessionId, requireId(args?.purchase_id ?? args?.purchaseId ?? args?.id ?? args, 'purchase_id')),
  initiateVendorCall: async (args: any) =>
    tools.initiateVendorCall(sessionId, requireId(args?.purchase_id ?? args?.purchaseId ?? args?.id ?? args, 'purchase_id')),
  pollVendorCall: async (args: any) =>
    tools.pollVendorCall(
      sessionId,
      requireId(args?.session_id ?? args?.call_session_id ?? args?.sessionId ?? args?.id ?? args, 'session_id')
    ),
  sendVendorCallEmail: async (args: any) =>
    tools.sendVendorCallEmail(
      sessionId,
      requireId(args?.session_id ?? args?.call_session_id ?? args?.sessionId ?? args?.id ?? args, 'session_id'),
      args?.override_email ?? args?.email
    ),
});

router.post('/session', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = parseNumeric(req.user?.id);
    const result = await pool.query('INSERT INTO agent_sessions (user_id) VALUES ($1) RETURNING id', [userId]);
    res.json({ sessionId: result.rows[0].id });
  } catch (err) {
    console.error('agentV2: create session error', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

router.post('/analytics/events', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authContext = (req as any).auth;
    if (!authContext || authContext.kind !== 'service') {
      return res.status(403).json({ error: 'Service credentials required' });
    }

    const {
      source = 'python_agent',
      sessionId,
      conversationId,
      tool,
      eventType,
      status,
      errorCode,
      errorMessage,
      traceId,
      latencyMs,
      metadata,
      occurredAt,
    } = req.body || {};

    if (!eventType || typeof eventType !== 'string') {
      return res.status(400).json({ error: 'eventType is required' });
    }

    await analyticsLogger.logEvent({
      source,
      sessionId: typeof sessionId === 'number' ? sessionId : undefined,
      conversationId: typeof conversationId === 'string' ? conversationId : undefined,
      tool: typeof tool === 'string' ? tool : undefined,
      eventType,
      status: typeof status === 'string' ? status : undefined,
      errorCode: typeof errorCode === 'string' ? errorCode : undefined,
      errorMessage: typeof errorMessage === 'string' ? errorMessage : undefined,
      traceId: typeof traceId === 'string' ? traceId : undefined,
      latencyMs: typeof latencyMs === 'number' ? latencyMs : undefined,
      metadata: metadata && typeof metadata === 'object' ? metadata : undefined,
      occurredAt: occurredAt ? new Date(occurredAt) : undefined,
    });

    res.json({ status: 'ok' });
  } catch (error) {
    console.error('agentV2: analytics event error', error);
    res.status(500).json({ error: 'Failed to record analytics event' });
  }
});

router.post('/chat', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { sessionId, message } = req.body || {};
    if (!sessionId || !message) {
      return res.status(400).json({ error: 'sessionId and message required' });
    }

    const userId = parseNumeric(req.user?.id);
    const companyId = parseNumeric(req.user?.company_id);

    if (!userId) {
      return res.status(400).json({ error: 'Authenticated user context is required for agent chat' });
    }
    if (!companyId) {
      return res.status(400).json({ error: 'Company context is required for agent chat' });
    }

    console.log('agentV2: chat request', {
      sessionId,
      userId,
      companyId,
      messagePreview: typeof message === 'string' ? `${message.slice(0, 120)}${message.length > 120 ? '…' : ''}` : '',
    });

    const timestamp = new Date().toISOString();
    const userPayload = {
      type: 'user_text',
      content: message,
      timestamp,
    };
    await pool.query('INSERT INTO agent_messages (session_id, role, content) VALUES ($1, $2, $3)', [
      sessionId,
      'user',
      JSON.stringify(userPayload),
    ]);

    const tools = new AgentToolsV2(pool);
    const registry = buildToolRegistry(tools, Number(sessionId), companyId, userId);
    const orchestrator = new AgentOrchestratorV2(pool, registry);
    let agentResponse;
    try {
      agentResponse = await orchestrator.handleMessage(Number(sessionId), message, { companyId, userId });
    } catch (error: any) {
      if (error instanceof Error && /is required/i.test(error.message)) {
        return res.status(400).json({ error: error.message });
      }
      console.error('agentV2: orchestrator error', error);
      throw error;
    }

    for (const event of agentResponse.events) {
      const payload = {
        ...event,
        timestamp: event.timestamp ?? new Date().toISOString(),
      };
      await pool.query('INSERT INTO agent_messages (session_id, role, content) VALUES ($1, $2, $3)', [
        sessionId,
        'assistant',
        JSON.stringify(payload),
      ]);
    }

    console.log('agentV2: chat response', {
      sessionId,
      userId,
      eventCount: agentResponse.events.length,
      eventTypes: agentResponse.events.map((event) => event.type),
    });

    res.json(agentResponse);
  } catch (err) {
    console.error('agentV2: chat error', err);
    const status = err instanceof Error && /gemini/i.test(err.message) ? 502 : 500;
    const errorMessage = err instanceof Error ? err.message : 'Failed to process chat';
    res.status(status).json({ error: errorMessage });
  }
});

router.get('/session/:sessionId/messages', authMiddleware, async (req: Request, res: Response) => {
  try {
    const sessionId = parseNumeric(req.params.sessionId);
    if (!sessionId) {
      return res.status(400).json({ error: 'Invalid sessionId' });
    }

    const result = await pool.query(
      `SELECT id, role, content, created_at FROM agent_messages WHERE session_id = $1 ORDER BY created_at ASC, id ASC`,
      [sessionId]
    );

    const messages = result.rows.map((row) => {
      let payload: any = null;
      if (typeof row.content === 'string') {
        try {
          payload = JSON.parse(row.content);
        } catch {
          payload = { type: 'text', content: row.content };
        }
      }
      return {
        id: row.id,
        role: row.role,
        ...payload,
        createdAt: row.created_at,
      };
    });

    res.json({ messages });
  } catch (err) {
    console.error('agentV2: list messages error', err);
    res.status(500).json({ error: 'Failed to load agent messages' });
  }
});

router.get('/tools', authMiddleware, async (_req: Request, res: Response) => {
  const orchestrator = new AgentOrchestratorV2(pool, {} as AgentToolRegistry);
  res.json({ tools: orchestrator.getToolCatalog() });
});

router.post('/tools/:tool/invoke', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { sessionId, input, output, success } = req.body || {};
    const tool = req.params.tool;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }
    const result = await pool.query(
      'INSERT INTO agent_tool_invocations (session_id, tool, input, output, success) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [sessionId, tool, input || null, output || null, success !== false]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    console.error('agentV2: tool invoke error', err);
    res.status(500).json({ error: 'Failed to record tool invocation' });
  }
});

export default router;

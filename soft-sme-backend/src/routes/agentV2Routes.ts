import express, { Request, Response } from 'express';
import { pool } from '../db';
import { authMiddleware } from '../middleware/authMiddleware';
import { AgentOrchestratorV2, AgentToolRegistry } from '../services/agentV2/orchestrator';
import { AgentToolsV2 } from '../services/agentV2/tools';

const router = express.Router();

// Session management
router.post('/session', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id ? parseInt(req.user.id) : null;
    const result = await pool.query(
      'INSERT INTO agent_sessions (user_id) VALUES ($1) RETURNING id',
      [userId]
    );
    res.json({ sessionId: result.rows[0].id });
  } catch (err) {
    console.error('agentV2: create session error', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Ingest a message and get response via orchestrator
router.post('/chat', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { sessionId, message } = req.body || {};
    if (!sessionId || !message) return res.status(400).json({ error: 'sessionId and message required' });
    await pool.query('INSERT INTO agent_messages (session_id, role, content) VALUES ($1, $2, $3)', [sessionId, 'user', message]);

    const tools = new AgentToolsV2(pool);
    const registry = {
      retrieveDocs: async ({ query }: any) => tools.retrieveDocs(query),
      createSalesOrder: async (args: any) => tools.createSalesOrder(sessionId, args),
      updateSalesOrder: async (args: any) => tools.updateSalesOrder(sessionId, args?.sales_order_id || args?.id, args?.patch || args),
      createPurchaseOrder: async (args: any) => tools.createPurchaseOrder(sessionId, args),
      closePurchaseOrder: async (args: any) => tools.closePurchaseOrder(sessionId, args?.purchase_id || args?.id),
      emailPurchaseOrder: async (args: any) => tools.emailPurchaseOrder(sessionId, args?.purchase_id || args?.id, args?.to, args?.message),
      createQuote: async (args: any) => tools.createQuote(sessionId, args),
      updateQuote: async (args: any) => tools.updateQuote(sessionId, args?.quote_id || args?.id, args?.patch || args),
      emailQuote: async (args: any) => tools.emailQuote(sessionId, args?.quote_id || args?.id, args?.to),
      convertQuoteToSO: async (args: any) => tools.convertQuoteToSO(sessionId, args?.quote_id || args?.id),
    };
    const orchestrator = new AgentOrchestratorV2(pool, registry);
    const reply = await orchestrator.handleMessage(sessionId, message);
    await pool.query('INSERT INTO agent_messages (session_id, role, content) VALUES ($1, $2, $3)', [sessionId, 'assistant', JSON.stringify(reply)]);
    res.json({ reply });
  } catch (err) {
    console.error('agentV2: chat error', err);
    res.status(500).json({ error: 'Failed to process chat' });
  }
});

router.get('/tools', authMiddleware, async (_req: Request, res: Response) => {
  const orchestrator = new AgentOrchestratorV2(pool, {} as AgentToolRegistry);
  res.json({ tools: orchestrator.getToolCatalog() });
});

// Admin: record a tool invocation (for testing the pipeline)
router.post('/tools/:tool/invoke', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { sessionId, input, output, success } = req.body || {};
    const tool = req.params.tool;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
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



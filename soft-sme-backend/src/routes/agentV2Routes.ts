import express, { Request, Response } from 'express';
import { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db';
import { authMiddleware } from '../middleware/authMiddleware';
import { AgentOrchestratorV2, AgentToolRegistry } from '../services/agentV2/orchestrator';
import { AgentAnalyticsLogger } from '../services/agentV2/analyticsLogger';
import { AgentToolsV2 } from '../services/agentV2/tools';
import { AgentSkillLibraryService, SkillWorkflowSummary } from '../services/agentV2/skillLibrary';
import aiAssistantService from '../services/aiAssistantService';
import ConversationSummarizer from '../services/conversationSummarizer';
import { ConversationMessage } from '../services/aiConversationManager';
import { ChatIn, isChatInFailure } from './agentV2Schemas';

const router = express.Router();
const analyticsLogger = new AgentAnalyticsLogger(pool);
const skillLibrary = new AgentSkillLibraryService(pool);
const schemaRefreshSecret = process.env.AI_SCHEMA_REFRESH_SECRET?.trim() || null;

const MAX_CONTEXT_MESSAGES = 60;
const CONTEXT_RECENT_PRESERVE = 20;

const sanitizeHeaderValue = (value: string | string[] | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseEnvNumeric = (value?: string | null): number | null => {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

type ServiceContext = { userId: number | null; companyId: number | null };

const parseEnvServiceContext = (): ServiceContext => ({
  userId:
    parseEnvNumeric(process.env.AGENT_V2_DEFAULT_USER_ID) ??
    parseEnvNumeric(process.env.AI_AGENT_DEFAULT_USER_ID),
  companyId:
    parseEnvNumeric(process.env.AGENT_V2_DEFAULT_COMPANY_ID) ??
    parseEnvNumeric(process.env.AI_AGENT_DEFAULT_COMPANY_ID),
});

const fallbackServiceEmail = process.env.AGENT_V2_DEFAULT_USER_EMAIL?.trim() || 'agent-service@softsme.local';
const fallbackServiceUsername = process.env.AGENT_V2_DEFAULT_USERNAME?.trim() || 'ai_agent_service';

let cachedServiceContext: ServiceContext | null = null;

type StoredAgentMessage = {
  id: number;
  role: 'user' | 'assistant' | 'system';
  type?: string;
  content?: string;
  summary?: string;
  timestamp?: string;
  createdAt?: string;
};

const parseStoredMessage = (row: any): StoredAgentMessage => {
  let payload: any = null;
  if (typeof row.content === 'string') {
    try {
      payload = JSON.parse(row.content);
    } catch {
      payload = { type: 'text', content: row.content };
    }
  } else if (row.content && typeof row.content === 'object') {
    payload = row.content;
  }

  return {
    id: Number(row.id),
    role: (row.role as 'user' | 'assistant' | 'system') ?? 'assistant',
    type: payload?.type ?? (row.role === 'user' ? 'user_text' : 'text'),
    content: payload?.content ?? payload?.summary ?? undefined,
    summary: payload?.summary ?? undefined,
    timestamp: payload?.timestamp ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
  };
};

const buildConversationMessages = (messages: StoredAgentMessage[]): ConversationMessage[] => {
  return messages.map((message) => ({
    id: String(message.id),
    conversationId: `agent-session-${message.id}`,
    role: message.role === 'user' ? 'user' : 'assistant',
    content: message.content || message.summary || '',
    metadata: {
      type: message.type,
    },
    createdAt: message.createdAt ? new Date(message.createdAt) : new Date(),
  }));
};

const summarizeConversationChunk = (messages: StoredAgentMessage[]): {
  summary: string;
  metadata: { highlights: string[]; resolution: string | null };
} | null => {
  if (!messages.length) {
    return null;
  }

  const conversationMessages = buildConversationMessages(messages).filter((message) =>
    message.content && message.content.trim().length > 0
  );

  if (!conversationMessages.length) {
    return null;
  }

  const { summaryText, highlights, resolution } = ConversationSummarizer.summarizeMessages(
    conversationMessages
  );

  return {
    summary: summaryText,
    metadata: { highlights, resolution },
  };
};

const ensureIdempotencyKey = (value: any, idempotencyKey: string) => {
  if (!idempotencyKey) {
    return value ?? {};
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const existing = (value as any).idempotency_key;
    if (typeof existing === 'string' && existing.trim().length > 0) {
      return value;
    }
    return { ...value, idempotency_key: idempotencyKey };
  }

  return { idempotency_key: idempotencyKey };
};

const loadDefaultServiceContext = async (): Promise<ServiceContext> => {
  const envContext = parseEnvServiceContext();

  if (envContext.userId && envContext.companyId) {
    cachedServiceContext = envContext;
    return envContext;
  }

  if (cachedServiceContext && (!envContext.userId || !envContext.companyId)) {
    const merged = {
      userId: envContext.userId ?? cachedServiceContext.userId ?? null,
      companyId: envContext.companyId ?? cachedServiceContext.companyId ?? null,
    };
    if (merged.userId && merged.companyId) {
      return merged;
    }
  }

  const context: ServiceContext = { ...envContext };

  if (context.userId && !context.companyId) {
    const userResult = await pool.query('SELECT company_id FROM users WHERE id = $1', [context.userId]);
    const derivedCompanyId = parseNumeric(userResult.rows?.[0]?.company_id);
    if (derivedCompanyId) {
      context.companyId = derivedCompanyId;
    }
  }

  if (!context.userId && context.companyId) {
    const userResult = await pool.query('SELECT id FROM users WHERE company_id = $1 ORDER BY id LIMIT 1', [context.companyId]);
    const derivedUserId = parseNumeric(userResult.rows?.[0]?.id);
    if (derivedUserId) {
      context.userId = derivedUserId;
    }
  }

  if (!context.userId || !context.companyId) {
    const fallbackResult = await pool.query(
      `SELECT id, company_id FROM users WHERE ($1 <> '' AND LOWER(email) = LOWER($1)) OR ($2 <> '' AND LOWER(username) = LOWER($2)) ORDER BY id LIMIT 1`,
      [fallbackServiceEmail, fallbackServiceUsername]
    );
    const fallbackRow = fallbackResult.rows?.[0];
    const fallbackUserId = parseNumeric(fallbackRow?.id);
    const fallbackCompanyId = parseNumeric(fallbackRow?.company_id);
    if (fallbackUserId) {
      context.userId = context.userId ?? fallbackUserId;
    }
    if (fallbackCompanyId) {
      context.companyId = context.companyId ?? fallbackCompanyId;
    }
  }

  if (!context.userId || !context.companyId) {
    const anyUserResult = await pool.query(
      'SELECT id, company_id FROM users WHERE company_id IS NOT NULL ORDER BY id LIMIT 1'
    );
    const anyRow = anyUserResult.rows?.[0];
    const anyUserId = parseNumeric(anyRow?.id);
    const anyCompanyId = parseNumeric(anyRow?.company_id);
    if (anyUserId) {
      context.userId = context.userId ?? anyUserId;
    }
    if (anyCompanyId) {
      context.companyId = context.companyId ?? anyCompanyId;
    }
  }

  if (!context.userId || !context.companyId) {
    console.warn('agentV2: Unable to determine default service context automatically');
  }

  cachedServiceContext = context;
  return context;
};

const updateSessionActivity = async (sessionId: number, client?: PoolClient): Promise<void> => {
  const db = client ?? pool;
  await db.query('UPDATE agent_sessions SET last_activity_at = NOW() WHERE id = $1', [sessionId]);
};

const enforceConversationLimits = async (sessionId: number): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, role, content, created_at
         FROM agent_messages
        WHERE session_id = $1
        ORDER BY created_at ASC, id ASC`,
      [sessionId]
    );

    if (!rows.length) {
      await client.query('COMMIT');
      return;
    }

    if (rows.length <= MAX_CONTEXT_MESSAGES) {
      await client.query('COMMIT');
      return;
    }

    const parsedMessages = rows.map(parseStoredMessage);
    const cutoffIndex = Math.max(0, rows.length - CONTEXT_RECENT_PRESERVE);
    const messagesToSummarize = parsedMessages.slice(0, cutoffIndex);

    if (messagesToSummarize.length === 0) {
      await client.query('COMMIT');
      return;
    }

    const summary = summarizeConversationChunk(messagesToSummarize);
    const idsToRemove = messagesToSummarize.map((message) => message.id);

    await client.query('DELETE FROM agent_messages WHERE session_id = $1 AND id = ANY($2::int[])', [
      sessionId,
      idsToRemove,
    ]);

    if (summary) {
      const payload = {
        type: 'summary',
        summary: summary.summary,
        content: `Summary so far:\n${summary.summary}`,
        highlights: summary.metadata.highlights,
        resolution: summary.metadata.resolution,
        timestamp: new Date().toISOString(),
      };

      await client.query('INSERT INTO agent_messages (session_id, role, content) VALUES ($1, $2, $3)', [
        sessionId,
        'assistant',
        JSON.stringify(payload),
      ]);
    }

    await updateSessionActivity(sessionId, client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('agentV2: failed to enforce context limits', error);
  } finally {
    client.release();
  }
};

const parseNumeric = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const deriveMessagePreview = (raw: any): { text: string | null; timestamp: string | null } => {
  if (!raw) {
    return { text: null, timestamp: null };
  }

  let payload: any = null;
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { content: raw };
    }
  } else if (typeof raw === 'object') {
    payload = raw;
  }

  const content = typeof payload?.content === 'string' ? payload.content : undefined;
  const summary = typeof payload?.summary === 'string' ? payload.summary : undefined;
  const highlights = Array.isArray(payload?.highlights) ? payload.highlights : [];
  const timestamp = typeof payload?.timestamp === 'string' ? payload.timestamp : null;

  if (payload?.type === 'summary') {
    if (summary) {
      return { text: summary, timestamp };
    }
    if (highlights.length > 0) {
      return { text: `Summary: ${highlights.join('; ')}`, timestamp };
    }
  }

  return { text: content ?? summary ?? null, timestamp };
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

const loadSessionContext = async (
  sessionId: number
): Promise<{ userId: number | null; companyId: number | null }> => {
  const sessionResult = await pool.query('SELECT user_id FROM agent_sessions WHERE id = $1', [sessionId]);
  const userId = parseNumeric(sessionResult.rows?.[0]?.user_id);

  if (!userId) {
    return { userId: null, companyId: null };
  }

  const userResult = await pool.query('SELECT company_id FROM users WHERE id = $1', [userId]);
  const companyId = parseNumeric(userResult.rows?.[0]?.company_id);

  return { userId, companyId };
};

const buildToolRegistry = (
  tools: AgentToolsV2,
  sessionId: number,
  companyId: number,
  userId: number,
  idempotencyKey: string
): AgentToolRegistry => ({
  retrieveDocs: async ({ query, k }: any) => tools.retrieveDocs(sessionId, query, k),
  inventoryLookup: async (args: any) => tools.inventoryLookup(sessionId, args),
  createSalesOrder: async (args: any) =>
    tools.createSalesOrder(sessionId, ensureIdempotencyKey(args, idempotencyKey)),
  updateSalesOrder: async (args: any) =>
    tools.updateSalesOrder(
      sessionId,
      requireId(args?.sales_order_id ?? args?.id, 'sales_order_id'),
      ensureIdempotencyKey(args?.patch ?? args, idempotencyKey)
    ),
  createPurchaseOrder: async (args: any) =>
    tools.createPurchaseOrder(sessionId, ensureIdempotencyKey(args, idempotencyKey)),
  updatePurchaseOrder: async (args: any) =>
    tools.updatePurchaseOrder(
      sessionId,
      requireId(args?.purchase_id ?? args?.id, 'purchase_id'),
      ensureIdempotencyKey(args?.patch ?? args, idempotencyKey)
    ),
  closePurchaseOrder: async (args: any) =>
    tools.updatePurchaseOrder(
      sessionId,
      requireId(args?.purchase_id ?? args?.id, 'purchase_id'),
      ensureIdempotencyKey({ header: { status: 'Closed' } }, idempotencyKey)
    ),
  emailPurchaseOrder: async (args: any) =>
    tools.emailPurchaseOrder(
      sessionId,
      requireId(args?.purchase_id ?? args?.id, 'purchase_id'),
      args?.to,
      args?.message,
      userId
    ),
  createQuote: async (args: any) => tools.createQuote(sessionId, ensureIdempotencyKey(args, idempotencyKey)),
  updateQuote: async (args: any) =>
    tools.updateQuote(
      sessionId,
      requireId(args?.quote_id ?? args?.id, 'quote_id'),
      ensureIdempotencyKey(args?.patch ?? args, idempotencyKey)
    ),
  emailQuote: async (args: any) =>
    tools.emailQuote(sessionId, requireId(args?.quote_id ?? args?.id, 'quote_id'), args?.to, userId),
  email_search: async (args: any) => tools.emailSearch(sessionId, userId, args),
  email_read: async (args: any) => tools.emailRead(sessionId, userId, args),
  email_compose_draft: async (args: any) => tools.emailComposeDraft(sessionId, userId, args),
  email_send: async (args: any) => tools.emailSend(sessionId, userId, args),
  email_reply: async (args: any) => tools.emailReply(sessionId, userId, args),
  convertQuoteToSO: async (args: any) =>
    (tools.convertQuoteToSO as any)(
      sessionId,
      requireId(args?.quote_id ?? args?.id, 'quote_id'),
      ensureIdempotencyKey(args, idempotencyKey)
    ),
  createTask: async (args: any) =>
    tools.createAgentTask(sessionId, companyId, userId, ensureIdempotencyKey(args, idempotencyKey)),
  updateTask: async (args: any) =>
    tools.updateAgentTask(sessionId, companyId, userId, ensureIdempotencyKey(args, idempotencyKey)),
  postTaskMessage: async (args: any) =>
    tools.postAgentTaskMessage(sessionId, companyId, userId, ensureIdempotencyKey(args, idempotencyKey)),
  getEmailSettings: async () => tools.getEmailSettings(sessionId, userId),
  saveEmailSettings: async (args: any) => tools.saveEmailSettings(sessionId, userId, args),
  testEmailConnection: async () => tools.testEmailConnection(sessionId, userId),
  listEmailTemplates: async () => tools.listEmailTemplates(sessionId, userId),
  getEmailTemplate: async (args: any) =>
    tools.getEmailTemplate(sessionId, userId, requireId(args?.template_id ?? args?.id, 'template_id')),
  saveEmailTemplate: async (args: any) => tools.saveEmailTemplate(sessionId, userId, args),
  deleteEmailTemplate: async (args: any) =>
    tools.deleteEmailTemplate(sessionId, userId, requireId(args?.template_id ?? args?.id, 'template_id')),
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

const buildSkillToolRegistry = (
  skills: SkillWorkflowSummary[],
  baseRegistry: AgentToolRegistry
): AgentToolRegistry => {
  const registry: AgentToolRegistry = {};
  for (const skill of skills) {
    const normalizedName = skill.name?.trim();
    if (!normalizedName) {
      continue;
    }
    const entrypoint = skill.entrypoint?.trim();
    if (!entrypoint || typeof baseRegistry[entrypoint] !== 'function') {
      continue;
    }
    const defaults =
      skill.parameters && typeof skill.parameters === 'object' && !Array.isArray(skill.parameters)
        ? (skill.parameters as Record<string, unknown>)
        : {};

    registry[`skill:${normalizedName}`] = async (args: any) =>
      baseRegistry[entrypoint]({ ...defaults, ...(args ?? {}) });
  }
  return registry;
};

const requireServiceAuth = (req: Request): boolean => {
  const authContext = (req as any).auth;
  return Boolean(authContext && authContext.kind === 'service');
};

router.post('/session', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authContext = (req as any).auth;
    const isServiceRequest = authContext?.kind === 'service';
    let userId = parseNumeric(req.user?.id);
    if (isServiceRequest) {
      const defaultContext = await loadDefaultServiceContext();
      userId = userId ?? defaultContext.userId ?? null;
    }
    const result = await pool.query('INSERT INTO agent_sessions (user_id) VALUES ($1) RETURNING id', [userId]);
    res.json({ sessionId: result.rows[0].id });
  } catch (err) {
    console.error('agentV2: create session error', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

router.get('/sessions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authContext = (req as any).auth;
    const isServiceRequest = authContext?.kind === 'service';
    const limit = Math.max(1, Number.parseInt(String(req.query.limit ?? '4'), 10) || 4);
    const includeSessionId = parseNumeric(req.query.include as string | undefined);

    let userId = parseNumeric(req.user?.id);

    if (isServiceRequest && !userId) {
      const defaultContext = await loadDefaultServiceContext();
      userId = defaultContext.userId ?? null;
    }

    const sessionsResult = await pool.query(
      `SELECT
         s.id,
         s.created_at,
         s.last_activity_at,
         (SELECT content FROM agent_messages WHERE session_id = s.id AND role = 'user' ORDER BY created_at ASC, id ASC LIMIT 1) AS first_user_message,
         (SELECT content FROM agent_messages WHERE session_id = s.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_message,
         (SELECT created_at FROM agent_messages WHERE session_id = s.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_message_at
       FROM agent_sessions s
       WHERE ($1::int IS NULL OR s.user_id = $1::int OR s.id = $2::int)
       ORDER BY s.last_activity_at DESC, s.id DESC
       LIMIT $3`,
      [userId, includeSessionId, limit + (includeSessionId ? 1 : 0)]
    );

    const uniqueSessions = new Map<number, any>();
    for (const row of sessionsResult.rows) {
      uniqueSessions.set(row.id, row);
    }

    const sessions = Array.from(uniqueSessions.values())
      .sort((a, b) => {
        const left = new Date(a.last_activity_at ?? a.created_at).getTime();
        const right = new Date(b.last_activity_at ?? b.created_at).getTime();
        return right - left;
      })
      .slice(0, limit)
      .map((row) => {
        const firstPreview = deriveMessagePreview(row.first_user_message);
        const lastPreview = deriveMessagePreview(row.last_message);
        const titleSource = firstPreview.text ?? `Chat ${row.id}`;
        const normalizedTitle = titleSource.length > 80 ? `${titleSource.slice(0, 77)}…` : titleSource;

        return {
          id: row.id,
          createdAt: row.created_at,
          lastActivityAt: row.last_activity_at,
          lastMessageAt: row.last_message_at ?? lastPreview.timestamp ?? row.last_activity_at,
          title: normalizedTitle,
          preview: lastPreview.text ?? null,
        };
      });

    res.json({ sessions });
  } catch (error) {
    console.error('agentV2: list sessions error', error);
    res.status(500).json({ error: 'Failed to list chat sessions' });
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

router.post('/schema/refresh', authMiddleware, async (req: Request, res: Response) => {
  const providedSecret = sanitizeHeaderValue(req.headers['x-refresh-secret']);
  const secretMatches = schemaRefreshSecret && providedSecret === schemaRefreshSecret;
  const authContext = (req as any).auth;
  const isServiceRequest = authContext?.kind === 'service';
  const isAdminUser = req.user?.access_role === 'Admin';

  if (!secretMatches && !isAdminUser && !isServiceRequest) {
    return res.status(403).json({ error: 'Not authorized to refresh schema' });
  }

  const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;

  try {
    const result = await aiAssistantService.refreshSchema(reason);
    res.json({ status: 'ok', ...result });
  } catch (error) {
    console.error('agentV2: schema refresh error', error);
    res.status(500).json({ error: 'Failed to refresh schema cache' });
  }
});

router.get('/health', authMiddleware, async (_req: Request, res: Response) => {
  try {
    const info = aiAssistantService.getEndpointInfo();
    const health = await aiAssistantService.getHealthStatus();

    res.json({
      status: health.status ?? 'unknown',
      details: health.details ?? null,
      endpoint: info.endpoint,
      healthUrl: info.healthUrl,
      mode: info.mode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Agent health check failed';
    console.error('agentV2: health check failed', error);
    res.status(503).json({
      status: 'unhealthy',
      error: message,
    });
  }
});

router.get('/skills', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!requireServiceAuth(req)) {
      return res.status(403).json({ error: 'Service credentials required' });
    }

    const skills = await skillLibrary.listWorkflows();
    res.json({
      skills: skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        version: skill.version,
        description: skill.description,
        entrypoint: skill.entrypoint,
        parameters: skill.parameters,
        updatedAt: skill.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('agentV2: list skills error', error);
    res.status(500).json({ error: 'Failed to list skills' });
  }
});

router.post('/skills', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!requireServiceAuth(req)) {
      return res.status(403).json({ error: 'Service credentials required' });
    }

    const { name, entrypoint, version, description, parameters } = req.body || {};

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Skill name is required' });
    }
    if (typeof entrypoint !== 'string' || !entrypoint.trim()) {
      return res.status(400).json({ error: 'Skill entrypoint is required' });
    }

    const skill = await skillLibrary.upsertWorkflow({
      name: name.trim(),
      entrypoint: entrypoint.trim(),
      version: typeof version === 'number' ? version : undefined,
      description: typeof description === 'string' ? description : undefined,
      parameters: parameters && typeof parameters === 'object' ? parameters : undefined,
    });

    res.json({ skill });
  } catch (error: any) {
    console.error('agentV2: upsert skill error', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to upsert skill' });
  }
});

router.post('/skills/runs', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!requireServiceAuth(req)) {
      return res.status(403).json({ error: 'Service credentials required' });
    }

    const { skillWorkflowId, runId, outcome, success, verificationPayload, latencyMs } = req.body || {};

    if (typeof skillWorkflowId !== 'string' || !skillWorkflowId.trim()) {
      return res.status(400).json({ error: 'skillWorkflowId is required' });
    }
    if (typeof runId !== 'string' || !runId.trim()) {
      return res.status(400).json({ error: 'runId is required' });
    }
    if (typeof outcome !== 'string' || !outcome.trim()) {
      return res.status(400).json({ error: 'outcome is required' });
    }
    if (typeof success !== 'boolean') {
      return res.status(400).json({ error: 'success must be a boolean' });
    }

    const reflection = await skillLibrary.recordRunReflection({
      skillWorkflowId: skillWorkflowId.trim(),
      runId: runId.trim(),
      outcome: outcome.trim(),
      success,
      verificationPayload:
        verificationPayload && typeof verificationPayload === 'object' ? verificationPayload : undefined,
      latencyMs: typeof latencyMs === 'number' ? latencyMs : undefined,
    });

    res.json({ reflection });
  } catch (error) {
    console.error('agentV2: record skill reflection error', error);
    res.status(500).json({ error: 'Failed to record skill run reflection' });
  }
});

router.post('/chat', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = ChatIn.safeParse(req.body);
    if (isChatInFailure(parsed)) {
      return res
        .status(422)
        .json({ error: 'Invalid request', issues: parsed.error.flatten() });
    }

    const {
      sessionId,
      message,
      userId: bodyUserId,
      companyId: bodyCompanyId,
      idempotency_key: bodyIdempotencyKey,
    } = parsed.data;

    const authContext = (req as any).auth;
    const isServiceRequest = authContext?.kind === 'service';
    const sessionNumeric = sessionId;

    let userId = parseNumeric(req.user?.id);
    let companyId = parseNumeric(req.user?.company_id);

    if (isServiceRequest) {
      const defaultContext = await loadDefaultServiceContext();

      userId = userId ?? bodyUserId ?? defaultContext.userId ?? null;
      companyId = companyId ?? bodyCompanyId ?? defaultContext.companyId ?? null;

      if (!userId || !companyId) {
        const sessionContext = await loadSessionContext(sessionNumeric);
        userId = userId ?? bodyUserId ?? sessionContext.userId ?? defaultContext.userId ?? null;
        companyId =
          companyId ?? bodyCompanyId ?? sessionContext.companyId ?? defaultContext.companyId ?? null;
      }
    }

    if (!isServiceRequest) {
      if (!userId) {
        return res.status(400).json({ error: 'Authenticated user context is required for agent chat' });
      }
      if (!companyId) {
        return res.status(400).json({ error: 'Company context is required for agent chat' });
      }
    } else if (!userId || !companyId) {
      return res.status(400).json({
        error:
          'User and company context are required for agent actions. Configure AGENT_V2_DEFAULT_USER_ID/AGENT_V2_DEFAULT_COMPANY_ID or provide a service user via AGENT_V2_DEFAULT_USER_EMAIL.',
      });
    }

    console.log('agentV2: chat request', {
      sessionId,
      userId,
      companyId,
      origin: isServiceRequest ? 'agent' : 'user',
      messagePreview: `${message.slice(0, 120)}${message.length > 120 ? '…' : ''}`,
    });

    if (!isServiceRequest) {
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
      await updateSessionActivity(Number(sessionId));
    }

    const headerIdempotencyKey = sanitizeHeaderValue(req.headers['x-idempotency-key']);
    const idempotencyKey = headerIdempotencyKey ?? bodyIdempotencyKey ?? uuidv4();

    const tools = new AgentToolsV2(pool);
    const registry = buildToolRegistry(tools, Number(sessionId), companyId, userId, idempotencyKey);
    const skillCatalog = await skillLibrary.listWorkflows();
    const skillRegistry = buildSkillToolRegistry(skillCatalog, registry);
    const orchestrator = new AgentOrchestratorV2(pool, { ...registry, ...skillRegistry }, skillCatalog);
    let agentResponse;
    try {
      agentResponse = await orchestrator.handleMessage(Number(sessionId), message, { companyId, userId }, {
        origin: isServiceRequest ? 'agent' : 'user',
        conversationId: `agent-v2-session-${sessionNumeric}`,
        userId,
        companyId,
      });
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

    await updateSessionActivity(Number(sessionId));
    void enforceConversationLimits(Number(sessionId));

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
      const parsed = parseStoredMessage(row);
      return {
        id: parsed.id,
        role: row.role,
        type: parsed.type,
        content: parsed.content,
        summary: parsed.summary,
        timestamp: parsed.timestamp,
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

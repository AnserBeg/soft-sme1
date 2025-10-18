import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import aiAssistantService from '../aiAssistantService';
import { AIService } from '../aiService';
import { AgentAnalyticsLogger } from './analyticsLogger';
import type { SkillWorkflowSummary } from './skillLibrary';

export interface AgentToolRegistry {
  [name: string]: (args: any) => Promise<any>;
}

interface VoiceVendorInfo {
  id?: number;
  name?: string | null;
  phone?: string | null;
}

interface VoiceCallArtifact {
  type: 'vendor_call_summary';
  sessionId: number;
  status: string;
  purchaseId?: number;
  purchaseNumber?: string | null;
  vendor?: VoiceVendorInfo;
  capturedEmail?: string | null;
  pickupTime?: string | null;
  parts?: Array<{ part_number: string; quantity: number; notes?: string | null }>;
  summary?: string | null;
  nextSteps?: string[];
  transcriptPreview?: string | null;
}

interface AgentEventBase {
  timestamp?: string;
}

export type AgentEvent =
  | ({ type: 'text'; content: string; callArtifacts?: VoiceCallArtifact[] } & AgentEventBase)
  | ({ type: 'docs'; info: string; chunks: any[] } & AgentEventBase)
  | ({ type: 'task_created' | 'task_updated' | 'task_message'; summary: string; task: any; link: string } & AgentEventBase);

export interface AgentResponse {
  events: AgentEvent[];
  reply?: AgentReply;
}

interface AgentReplyActionTrace {
  tool?: string;
  success?: boolean;
  message?: string;
  input?: any;
  output?: any;
  error?: string;
  link?: string;
  link_label?: string;
  summary?: string;
}

interface AgentReply {
  type: string;
  message: string;
  catalog?: ToolCatalogEntry[];
  traces?: AgentReplyActionTrace[];
  docs?: any[];
}

type AgentInvocationOrigin = 'user' | 'agent';

interface HandleMessageOptions {
  origin?: AgentInvocationOrigin;
  conversationId?: string;
  userId?: number | null;
  companyId?: number | null;
}

interface AgentInstruction {
  tool: string;
  args: any;
  message?: string;
}

interface AssistantLLMResponse {
  response: string;
  sources: string[];
  confidence: number;
  tool_used: string;
  actions?: any[];
  action_message?: string | null;
  action_catalog?: any[];
  documentation_subagent?: any;
}

export interface ToolCatalogEntry {
  name: string;
  description: string;
  example?: string;
}

export class AgentOrchestratorV2 {
  private readonly toolCatalog: ToolCatalogEntry[];
  private readonly analytics: AgentAnalyticsLogger;

  constructor(private pool: Pool, private tools: AgentToolRegistry, private skillCatalog: SkillWorkflowSummary[] = []) {
    this.toolCatalog = this.buildToolCatalog();
    this.analytics = new AgentAnalyticsLogger(pool);
  }

  getToolCatalog(): ToolCatalogEntry[] {
    return this.toolCatalog;
  }

  async handleMessage(
    sessionId: number,
    message: string,
    context?: { companyId?: number | null; userId?: number | null },
    options: HandleMessageOptions = {}
  ): Promise<AgentResponse> {
    const origin: AgentInvocationOrigin = options.origin ?? 'user';
    const normalizedContext = {
      userId: options.userId ?? context?.userId ?? null,
      companyId: options.companyId ?? context?.companyId ?? null,
    };

    if (origin === 'agent') {
      return this.processAgentInstruction(sessionId, message, normalizedContext);
    }

    const conversationId = options.conversationId ?? this.buildConversationId(sessionId);
    const events: AgentEvent[] = [];
    let assistantResponse: AssistantLLMResponse | null = null;

    try {
      assistantResponse = (await aiAssistantService.sendMessage(
        message,
        normalizedContext.userId ?? undefined,
        conversationId
      )) as AssistantLLMResponse;
    } catch (error) {
      console.error('agentV2: aiAssistantService error', error);
    }

    if (assistantResponse && typeof assistantResponse.response === 'string') {
      const trimmed = assistantResponse.response.trim();
      if (trimmed.length > 0) {
        events.push({
          type: 'text',
          content: trimmed,
          timestamp: new Date().toISOString(),
        });
        return { events };
      }
    }

    return this.legacyHandleMessage(sessionId, message, normalizedContext);
  }

  private async legacyHandleMessage(
    sessionId: number,
    message: string,
    context: { companyId?: number | null; userId?: number | null }
  ): Promise<AgentResponse> {
    const events: AgentEvent[] = [];
    const intent = this.classifyIntent(message);

    const matchedIntent = intent?.tool ?? null;

    if (intent && this.tools[intent.tool]) {
      const trace = this.analytics.startToolTrace(sessionId, intent.tool, intent.args);
      try {
        const result = await this.tools[intent.tool](intent.args);
        await this.analytics.finishToolTrace(trace, { status: 'success', output: result });
        events.push(...this.normalizeToolResult(intent.tool, result));
      } catch (error: any) {
        await this.analytics.finishToolTrace(trace, { status: 'failure', error });
        events.push({
          type: 'text',
          content: this.describeActionOutcome(intent.tool, false, undefined, error),
          timestamp: new Date().toISOString(),
        });
      }
    } else if (this.tools['retrieveDocs']) {
      const trace = this.analytics.startToolTrace(sessionId, 'retrieveDocs', {
        query: message,
        matched_intent: matchedIntent,
      });
      try {
        const result = await this.tools['retrieveDocs']({ query: message });
        await this.analytics.finishToolTrace(trace, { status: 'success', output: Array.isArray(result) ? result : [] });
        await this.analytics.logFallback(sessionId, 'documentation', {
          reason: intent ? 'tool_not_available' : 'no_intent_match',
          matched_intent: matchedIntent,
        });
        events.push({
          type: 'docs',
          info: 'Relevant docs',
          chunks: Array.isArray(result) ? result : [],
          timestamp: new Date().toISOString(),
        });
      } catch (error: any) {
        await this.analytics.finishToolTrace(trace, { status: 'failure', error });
        await this.analytics.logFallback(sessionId, 'documentation', {
          reason: 'docs_error',
          matched_intent: matchedIntent,
          error: error instanceof Error ? error.message : String(error),
        });
        events.push({
          type: 'text',
          content: 'Unable to search documentation at the moment.',
          timestamp: new Date().toISOString(),
        });
      }
    }

    const hasTextEvent = events.some((event) => event.type === 'text');

    if (!hasTextEvent) {
      try {
        const fallbackTraceId = randomUUID();
        const aiReply = await AIService.sendMessage(message, context?.userId ?? undefined);
        await this.analytics.logEvent({
          source: 'orchestrator',
          sessionId,
          eventType: 'fallback',
          status: 'llm_fallback',
          traceId: fallbackTraceId,
          metadata: {
            reason: events.length === 0 ? 'no_tool_match' : 'no_text_event',
          },
        });
        events.push({
          type: 'text',
          content: aiReply,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error('agentV2: AIService fallback error', error);
        await this.analytics.logEvent({
          source: 'orchestrator',
          sessionId,
          eventType: 'fallback',
          status: 'llm_fallback_error',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        events.push({
          type: 'text',
          content:
            'I can help with sales orders, purchase orders, quotes, vendor calls, and tasks. What would you like to do?',
          timestamp: new Date().toISOString(),
        });
      }
    }

    if (!intent) {
      await this.analytics.logRoutingMiss(sessionId, message, {
        fallback: this.tools['retrieveDocs'] ? 'documentation' : 'llm',
      });
    } else if (!this.tools[intent.tool]) {
      await this.analytics.logEvent({
        source: 'orchestrator',
        sessionId,
        tool: intent.tool,
        eventType: 'tool_unavailable',
        status: 'missing',
        metadata: {
          reason: 'tool_not_registered',
        },
      });
    }

    return { events };
  }

  private async processAgentInstruction(
    sessionId: number,
    message: string,
    _context: { companyId?: number | null; userId?: number | null }
  ): Promise<AgentResponse> {
    const events: AgentEvent[] = [];
    const instruction = this.parseAgentInstruction(message) ?? this.classifyIntent(message);

    if (!instruction) {
      await this.analytics.logEvent({
        source: 'orchestrator',
        sessionId,
        eventType: 'agent_instruction_unmatched',
        status: 'skipped',
        metadata: { message: message.slice(0, 200) },
      });

      return {
        events,
        reply: {
          type: 'actions',
          message: 'No matching tool found for the requested action.',
          catalog: this.toolCatalog,
          traces: [],
          docs: [],
        },
      };
    }

    const toolName = instruction.tool;
    const handler = this.tools[toolName];
    const traces: AgentReplyActionTrace[] = [];

    if (!handler) {
      await this.analytics.logEvent({
        source: 'orchestrator',
        sessionId,
        tool: toolName,
        eventType: 'tool_unavailable',
        status: 'missing',
        metadata: { reason: 'tool_not_registered', origin: 'agent_instruction' },
      });

      return {
        events,
        reply: {
          type: 'actions',
          message: `Tool ${toolName} is not available for agent execution.`,
          catalog: this.toolCatalog,
          traces: [],
          docs: [],
        },
      };
    }

    const trace = this.analytics.startToolTrace(sessionId, toolName, instruction.args);
    let replyMessage: string;

    try {
      const result = await handler(instruction.args);
      await this.analytics.finishToolTrace(trace, { status: 'success', output: result });
      const normalizedEvents = this.normalizeToolResult(toolName, result);
      events.push(...normalizedEvents);
      replyMessage = this.describeActionOutcome(toolName, true, result);

      traces.push({
        tool: toolName,
        success: true,
        message: replyMessage,
        input: instruction.args ?? null,
        output: result ?? null,
        summary: replyMessage,
      });
    } catch (error: any) {
      await this.analytics.finishToolTrace(trace, { status: 'failure', error });
      replyMessage = this.describeActionOutcome(toolName, false, undefined, error);

      events.push({
        type: 'text',
        content: replyMessage,
        timestamp: new Date().toISOString(),
      });

      traces.push({
        tool: toolName,
        success: false,
        message: replyMessage,
        input: instruction.args ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      events,
      reply: {
        type: 'actions',
        message: replyMessage,
        catalog: this.toolCatalog,
        traces,
        docs: [],
      },
    };
  }

  private buildConversationId(sessionId: number): string {
    return `agent-v2-session-${sessionId}`;
  }

  private parseAgentInstruction(message: string): AgentInstruction | null {
    if (typeof message !== 'string') {
      return null;
    }

    const trimmed = message.trim();
    if (!trimmed) {
      return null;
    }

    const jsonCandidate = this.tryParseJson(trimmed);
    if (jsonCandidate && typeof jsonCandidate === 'object') {
      const directToolCandidate =
        this.resolveToolName(
          (jsonCandidate as any).tool ||
            (jsonCandidate as any).action ||
            (jsonCandidate as any).entrypoint ||
            (jsonCandidate as any).name
        );

      if (directToolCandidate) {
        return {
          tool: directToolCandidate,
          args: this.extractInstructionArguments(jsonCandidate),
          message: trimmed,
        };
      }

      const toolFromObject = this.findToolInObject(jsonCandidate as Record<string, any>);
      if (toolFromObject) {
        const argsSource = (jsonCandidate as Record<string, any>)[toolFromObject.key];
        return {
          tool: toolFromObject.tool,
          args: this.ensureRecord(argsSource),
          message: trimmed,
        };
      }
    }

    const toolFromKeyValue = this.extractToolFromKeyValue(trimmed);
    if (toolFromKeyValue) {
      const argsObject = this.parseJsonSubstring(trimmed);
      return {
        tool: toolFromKeyValue,
        args: this.extractInstructionArguments(argsObject),
        message: trimmed,
      };
    }

    const directTool = this.resolveToolName(trimmed);
    if (directTool) {
      return { tool: directTool, args: {}, message: trimmed };
    }

    const canonicalMessage = this.canonicalize(trimmed);
    for (const name of Object.keys(this.tools)) {
      const canonicalTool = this.canonicalize(name);
      if (canonicalTool && canonicalMessage.includes(canonicalTool)) {
        return { tool: name, args: {}, message: trimmed };
      }
    }

    return null;
  }

  private extractInstructionArguments(source: any): any {
    if (!source || typeof source !== 'object') {
      return {};
    }

    const record = this.ensureRecord(source);
    const candidateKeys = ['args', 'parameters', 'payload', 'input', 'data'];

    for (const key of candidateKeys) {
      if (record[key] && typeof record[key] === 'object') {
        return this.ensureRecord(record[key]);
      }
    }

    const nestedTool = this.findToolInObject(record);
    if (nestedTool) {
      return this.ensureRecord(record[nestedTool.key]);
    }

    return {};
  }

  private ensureRecord(value: any): Record<string, any> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, any>;
    }
    return {};
  }

  private findToolInObject(source: Record<string, any>): { key: string; tool: string } | null {
    for (const key of Object.keys(source)) {
      const resolved = this.resolveToolName(key);
      if (resolved) {
        return { key, tool: resolved };
      }
    }
    return null;
  }

  private extractToolFromKeyValue(message: string): string | null {
    const match = message.match(/(?:tool|action|entrypoint)\s*[:=]\s*([\w:-]+)/i);
    if (!match) {
      return null;
    }
    return this.resolveToolName(match[1]);
  }

  private parseJsonSubstring(value: string): any {
    const start = value.indexOf('{');
    if (start === -1) {
      return {};
    }

    let depth = 0;
    for (let i = start; i < value.length; i += 1) {
      const char = value[i];
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          const candidate = value.slice(start, i + 1);
          const parsed = this.tryParseJson(candidate);
          if (parsed && typeof parsed === 'object') {
            return parsed;
          }
        }
      }
    }

    return {};
  }

  private tryParseJson(value: string): any | null {
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }

  private resolveToolName(candidate?: string | null): string | null {
    if (!candidate || typeof candidate !== 'string') {
      return null;
    }

    const normalized = this.canonicalize(candidate);
    if (!normalized) {
      return null;
    }

    for (const name of Object.keys(this.tools)) {
      if (this.canonicalize(name) === normalized) {
        return name;
      }
    }

    return null;
  }

  private canonicalize(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  private normalizeToolResult(tool: string, result: any): AgentEvent[] {
    const timestamp = new Date().toISOString();

    if (tool === 'retrieveDocs') {
      return [
        {
          type: 'docs',
          info: 'Relevant docs',
          chunks: Array.isArray(result) ? result : [],
          timestamp,
        },
      ];
    }

    if (result && typeof result === 'object' && result.task && result.summary) {
      const type = result.type ?? 'task_updated';
      const link = result.link ?? (result.task?.id ? `/tasks/${result.task.id}` : '');
      return [
        {
          type,
          summary: result.summary,
          task: result.task,
          link,
          timestamp,
        },
      ];
    }

    const artifact = result && typeof result === 'object' ? this.buildVoiceArtifact(result.session) : null;

    return [
      {
        type: 'text',
        content: this.extractMessage(tool, result),
        timestamp,
        ...(artifact ? { callArtifacts: [artifact] } : {}),
      },
    ];
  }

  private extractMessage(tool: string, result: any): string {
    if (result && typeof result.message === 'string' && result.message.trim().length > 0) {
      return result.message;
    }
    return this.describeActionOutcome(tool, true, result);
  }

  private buildVoiceArtifact(session: any): VoiceCallArtifact | null {
    if (!session || typeof session !== 'object') {
      return null;
    }

    const structured = session.structured_notes ?? {};
    const partsSource = Array.isArray(structured.parts) ? structured.parts : [];
    const parts = partsSource
      .map((part: any) => ({
        part_number: String(part?.part_number ?? '').trim(),
        quantity: Number(part?.quantity ?? 0) || 0,
        notes: part?.notes ?? null,
      }))
      .filter((part: any) => part.part_number.length > 0);

    const artifact: VoiceCallArtifact = {
      type: 'vendor_call_summary',
      sessionId: Number(session.id),
      status: String(session.status ?? 'unknown'),
      purchaseId: session.purchase_id != null ? Number(session.purchase_id) : undefined,
      purchaseNumber: session.purchase_number ?? null,
      vendor:
        session.vendor_id || session.vendor_name || session.vendor_phone
          ? {
              id: session.vendor_id != null ? Number(session.vendor_id) : undefined,
              name: session.vendor_name ?? null,
              phone: session.vendor_phone ?? null,
            }
          : undefined,
      capturedEmail: session.captured_email ?? structured.email ?? null,
      pickupTime: session.pickup_time ?? structured.pickup_time ?? null,
      parts: parts.length ? parts : undefined,
      summary: structured.summary ?? null,
      nextSteps: Array.isArray(structured.next_steps) ? structured.next_steps : undefined,
      transcriptPreview:
        typeof session.transcript === 'string' && session.transcript.length > 0
          ? session.transcript.slice(0, 600)
          : undefined,
    };

    return artifact;
  }

  private classifyIntent(message: string): { tool: string; args: any } | null {
    const normalized = message.toLowerCase();

    const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const containsKeyword = (keyword: string): boolean => {
      const trimmed = keyword.trim().toLowerCase();
      if (!trimmed) {
        return false;
      }
      if (trimmed.includes(' ')) {
        return normalized.includes(trimmed);
      }
      const pattern = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`);
      return pattern.test(normalized);
    };

    const includesAny = (keywords: string[]): boolean => keywords.some((keyword) => containsKeyword(keyword));

    const howToPhrases = [
      'how do i',
      'how do we',
      'how to',
      'steps to',
      'instructions',
      'process to',
      'guide me',
      'can you guide',
      'walk me through',
    ];

    if (normalized.includes('doc') || normalized.includes('documentation') || includesAny(howToPhrases)) {
      return { tool: 'retrieveDocs', args: { query: message } };
    }

    const mentionsPurchaseOrder =
      containsKeyword('purchase order') ||
      normalized.includes('purchase-order') ||
      containsKeyword('po') ||
      normalized.includes('p/o') ||
      normalized.includes('p.o.');
    const mentionsSalesOrder =
      containsKeyword('sales order') ||
      normalized.includes('sales-order') ||
      normalized.includes('s/o') ||
      normalized.includes('s.o.') ||
      /\bso\s*(?:#|no\.?|number)?\s*\d+\b/.test(normalized);
    const mentionsQuote = containsKeyword('quote') || containsKeyword('quotes');

    const createKeywords = ['create', 'make', 'build', 'start', 'begin', 'open', 'set up', 'setup', 'generate', 'draft', 'issue', 'raise', 'new'];
    const updateKeywords = ['update', 'change', 'modify', 'edit', 'adjust', 'fix', 'tweak'];
    const closeKeywords = ['close', 'complete', 'finish', 'wrap up', 'wrap-up', 'finalize', 'shut', 'cancel', 'done'];
    const emailKeywords = ['email', 'send', 'mail', 'forward', 'deliver'];

    if (mentionsSalesOrder) {
      if (includesAny(createKeywords)) {
        return { tool: 'createSalesOrder', args: {} };
      }
      if (includesAny(updateKeywords)) {
        return { tool: 'updateSalesOrder', args: {} };
      }
    }

    if (mentionsPurchaseOrder) {
      if (includesAny(emailKeywords)) {
        return { tool: 'emailPurchaseOrder', args: {} };
      }
      if (includesAny(closeKeywords)) {
        return { tool: 'closePurchaseOrder', args: {} };
      }
      if (includesAny(updateKeywords)) {
        return { tool: 'updatePurchaseOrder', args: {} };
      }
      if (includesAny(createKeywords) || /need\s+(?:a|to create|to make)\s+(purchase order|po)\b/.test(normalized)) {
        return { tool: 'createPurchaseOrder', args: {} };
      }
    }

    if (mentionsQuote) {
      if (includesAny(emailKeywords)) {
        return { tool: 'emailQuote', args: {} };
      }
      if (includesAny(createKeywords)) {
        return { tool: 'createQuote', args: {} };
      }
      if (includesAny(updateKeywords)) {
        return { tool: 'updateQuote', args: {} };
      }
      const referencesSalesOrder =
        mentionsSalesOrder ||
        /\bto\s+so\b/.test(normalized) ||
        normalized.includes('to s/o') ||
        normalized.includes('to s.o.');
      if (containsKeyword('convert') && referencesSalesOrder) {
        return { tool: 'convertQuoteToSO', args: {} };
      }
    }

    if (containsKeyword('call') && containsKeyword('vendor')) {
      if (containsKeyword('status') || normalized.includes('call update')) {
        return { tool: 'pollVendorCall', args: {} };
      }
      if (includesAny(emailKeywords)) {
        return { tool: 'sendVendorCallEmail', args: {} };
      }
      return { tool: 'initiateVendorCall', args: {} };
    }

    if (containsKeyword('pickup')) {
      if (containsKeyword('time')) return { tool: 'updatePickupDetails', args: { pickup_time: message } };
      if (containsKeyword('location')) return { tool: 'updatePickupDetails', args: { pickup_location: message } };
      if (containsKeyword('contact')) return { tool: 'updatePickupDetails', args: { pickup_contact_person: message } };
      if (containsKeyword('phone')) return { tool: 'updatePickupDetails', args: { pickup_phone: message } };
      if (containsKeyword('instructions')) return { tool: 'updatePickupDetails', args: { pickup_instructions: message } };
      if (containsKeyword('notes')) return { tool: 'updatePickupDetails', args: { pickup_notes: message } };
      if (containsKeyword('get')) return { tool: 'getPickupDetails', args: {} };
    }

    const reminderKeywords = ['remind', 'reminder', 'follow up', 'follow-up', 'todo', 'to-do', 'task for me', 'keep an eye'];
    if (reminderKeywords.some((keyword) => normalized.includes(keyword))) {
      return {
        tool: 'createTask',
        args: {
          title: message,
          description: message,
        },
      };
    }

    return null;
  }

  private buildToolCatalog(): ToolCatalogEntry[] {
    const catalog: ToolCatalogEntry[] = [
      { name: 'createSalesOrder', description: 'Create a new sales order from customer information and line items.' },
      { name: 'updateSalesOrder', description: 'Update an existing sales order header, line items, or related details.' },
      { name: 'createPurchaseOrder', description: 'Create a purchase order for a vendor including pickup details and items.' },
      { name: 'updatePurchaseOrder', description: 'Update purchase order fields, pickup instructions, or line items.' },
      { name: 'closePurchaseOrder', description: 'Mark a purchase order as complete and close it out.' },
      { name: 'emailPurchaseOrder', description: 'Email a purchase order PDF to a vendor contact.' },
      { name: 'createQuote', description: 'Create a new quote for a customer.' },
      { name: 'updateQuote', description: 'Modify quote details, pricing, or line items.' },
      { name: 'emailQuote', description: 'Email a quote PDF to a customer contact.' },
      { name: 'convertQuoteToSO', description: 'Convert an existing quote into a sales order.' },
      { name: 'updatePickupDetails', description: 'Update pickup instructions such as time, location, or contact details.' },
      { name: 'getPickupDetails', description: 'Retrieve the current pickup instructions for a purchase order.' },
      { name: 'initiateVendorCall', description: 'Start an outbound vendor call to confirm parts or pickup details.' },
      { name: 'pollVendorCall', description: 'Check the latest status for an active vendor call session.' },
      { name: 'sendVendorCallEmail', description: 'Email the purchase order to the vendor after a call completes.' },
      { name: 'createTask', description: 'Create a Workspace Copilot task and subscribe the current session to updates.' },
      { name: 'updateTask', description: 'Update the status or due date of an existing task.' },
      { name: 'postTaskMessage', description: 'Post an update in the related task conversation.' },
      { name: 'retrieveDocs', description: 'Search internal documentation for workflows and UI guidance.' },
    ];

    const skillEntries = this.skillCatalog
      .map((skill) => {
        const name = typeof skill.name === 'string' ? skill.name.trim() : '';
        if (!name) {
          return null;
        }
        const description =
          typeof skill.description === 'string' && skill.description.trim().length > 0
            ? skill.description.trim()
            : `Reusable workflow built on ${skill.entrypoint}`;
        const example =
          skill.parameters && typeof skill.parameters === 'object' && !Array.isArray(skill.parameters)
            ? String((skill.parameters as any).example ?? '')
            : '';

        return {
          name: `skill:${name}`,
          description,
          example: example || undefined,
        } as ToolCatalogEntry;
      })
      .filter((entry): entry is ToolCatalogEntry => Boolean(entry));

    return catalog.concat(skillEntries);
  }

  private describeActionOutcome(tool: string, success: boolean, output?: any, error?: any): string {
    if (!success) {
      const errorMsg = error instanceof Error ? error.message : String(error || 'Unknown error');
      return `Failed to ${this.describeTool(tool)}: ${errorMsg}`;
    }

    switch (tool) {
      case 'createPurchaseOrder':
        return output?.purchase_number ? `Created purchase order ${output.purchase_number}.` : 'Purchase order created successfully.';
      case 'updatePurchaseOrder':
        return 'Updated the purchase order successfully.';
      case 'closePurchaseOrder':
        return 'Closed the purchase order successfully.';
      case 'emailPurchaseOrder':
        if (output?.emailed_to && output?.purchase_number) {
          return `Sent purchase order ${output.purchase_number} to ${output.emailed_to}.`;
        }
        return 'Sent the purchase order email successfully.';
      case 'createSalesOrder':
        return output?.sales_order_number ? `Created sales order ${output.sales_order_number}.` : 'Sales order created successfully.';
      case 'updateSalesOrder':
        return 'Updated the sales order successfully.';
      case 'createQuote':
        return output?.quote_number ? `Created quote ${output.quote_number}.` : 'Quote created successfully.';
      case 'updateQuote':
        return 'Updated the quote successfully.';
      case 'emailQuote':
        return 'Sent the quote email successfully.';
      case 'convertQuoteToSO':
        return 'Converted the quote into a sales order successfully.';
      case 'updatePickupDetails':
        return 'Updated pickup details successfully.';
      case 'getPickupDetails':
        return 'Retrieved pickup details successfully.';
      case 'initiateVendorCall':
        if (output?.session?.purchase_number) {
          return `Started a vendor call for purchase order ${output.session.purchase_number}.`;
        }
        return 'Started a vendor call.';
      case 'pollVendorCall':
        if (output?.session?.status) {
          return `Vendor call status: ${output.session.status}.`;
        }
        return 'Checked vendor call status.';
      case 'sendVendorCallEmail':
        return output?.emailed_to ? `Email sent to ${output.emailed_to}.` : 'Sent the vendor call follow-up email.';
      default:
        return `Completed ${this.describeTool(tool)} successfully.`;
    }
  }

  private describeTool(tool: string): string {
    switch (tool) {
      case 'createPurchaseOrder':
        return 'create a purchase order';
      case 'updatePurchaseOrder':
        return 'update the purchase order';
      case 'closePurchaseOrder':
        return 'close the purchase order';
      case 'emailPurchaseOrder':
        return 'email the purchase order';
      case 'createSalesOrder':
        return 'create a sales order';
      case 'updateSalesOrder':
        return 'update the sales order';
      case 'createQuote':
        return 'create a quote';
      case 'updateQuote':
        return 'update the quote';
      case 'emailQuote':
        return 'email the quote';
      case 'convertQuoteToSO':
        return 'convert the quote into a sales order';
      case 'updatePickupDetails':
        return 'update pickup details';
      case 'getPickupDetails':
        return 'retrieve pickup details';
      case 'initiateVendorCall':
        return 'start a vendor call';
      case 'pollVendorCall':
        return 'check the vendor call status';
      case 'sendVendorCallEmail':
        return 'send the vendor call email';
      case 'createTask':
        return 'create a task';
      case 'updateTask':
        return 'update the task';
      case 'postTaskMessage':
        return 'post a task update';
      case 'retrieveDocs':
        return 'search the documentation';
      default:
        return tool;
    }
  }
}

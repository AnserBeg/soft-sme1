import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

export type ClosedIntent =
  | 'inventory_lookup'
  | 'create_purchase_order'
  | 'create_sales_order'
  | 'create_quote'
  | 'update_pickup_details'
  | 'doc_help'
  | 'smalltalk'
  | 'none';

export type EntityType = 'vendor' | 'customer' | 'part' | 'purchase_order' | 'sales_order' | 'quote';

export interface StructuredSlots {
  entity_type?: EntityType;
  entity_name?: string;
  order_number?: string;
  part_identifier?: string;
  filters?: Array<{ field: string; op: 'eq' | 'contains' | 'gte' | 'lte' | 'gt' | 'lt'; value: string }>;
  vendor_name?: string;
  customer_name?: string;
  line_items?: Array<{ sku: string | null; part_name: string | null; qty: number }>;
  notes?: string;
  so_number?: string;
  pickup_time?: string;
  topic?: string;
}

export interface StructuredIntent {
  intent: ClosedIntent;
  confidence: number;
  slots: StructuredSlots;
  needs_confirmation: boolean;
  reason: string;
}

type FilterSlot = NonNullable<StructuredSlots['filters']>[number];

interface RouterOptions {
  apiKey?: string;
  model?: string;
  temperature?: number;
  logger?: (message: string, metadata?: Record<string, unknown>) => void;
}

const SYSTEM_PROMPT = `You are Aiven ERP’s Intent Router. Your ONLY job is to classify a single user utterance into one of a CLOSED SET of intents and extract required slots for downstream tools. Do not answer the user’s question, do not execute tools, and do not improvise new intents or slots.

OUTPUT RULES
- Return ONLY a single JSON object (no prose, no code fences).
- Follow this exact schema and enums. Omit slots that are not applicable.
- If uncertain, choose intent "none" with low confidence.
- Confidence is a float in [0,1] reflecting routing certainty, not truth of facts.
- Never include PII beyond what the user supplied.

CLOSED INTENTS (enums)
- "inventory_lookup"
- "create_purchase_order"
- "create_sales_order"
- "create_quote"
- "update_pickup_details"
- "doc_help"
- "smalltalk"
- "none"

SLOT SCHEMA (only include keys relevant to the chosen intent)
- Common lookup slots:
  - "entity_type": "vendor" | "customer" | "part" | "purchase_order" | "sales_order" | "quote"
  - "entity_name": string
  - "order_number": string
  - "part_identifier": string
  - "filters": [ { "field": string, "op": "eq|contains|gte|lte|gt|lt", "value": string } ]
- Create PO / SO / Quote:
  - "vendor_name": string
  - "customer_name": string
  - "line_items": [ { "sku": string|null, "part_name": string|null, "qty": number } ]
  - "notes": string
- Update pickup:
  - "so_number": string
  - "pickup_time": string
  - "notes": string
- Documentation help:
  - "topic": string

CONTROL / SAFETY
- Never route destructive or unsupported actions (delete, cancel, wipe data) → "none".
- For write intents ("create_*", "update_pickup_details"), set "needs_confirmation": true when critical slots are missing or ambiguous.
- If user intent is clearly read-only info request → prefer "inventory_lookup".
- Use "doc_help" for “how do I…/where is…” product usage questions.
- Use "smalltalk" for greetings, thanks, or chit-chat with no business intent.

OUTPUT JSON SHAPE (exact keys)
{
  "intent": "<one of enums>",
  "confidence": 0.0,
  "slots": { /* only relevant keys from Slot Schema */ },
  "needs_confirmation": false,
  "reason": "<one short sentence for logging>"
}`;

interface FewShotExample {
  user: string;
  response: StructuredIntent;
}

const FEW_SHOT_EXAMPLES: FewShotExample[] = [
  {
    user: 'My vendor is Parts for Truck Inc',
    response: {
      intent: 'inventory_lookup',
      confidence: 0.86,
      slots: {
        entity_type: 'vendor',
        entity_name: 'Parts for Truck Inc',
      },
      needs_confirmation: false,
      reason: 'Mentions a vendor name; likely wants vendor details.',
    },
  },
  {
    user: 'Show me POs for Parts for Truck Inc from last month',
    response: {
      intent: 'inventory_lookup',
      confidence: 0.88,
      slots: {
        entity_type: 'purchase_order',
        entity_name: 'Parts for Truck Inc',
        filters: [
          { field: 'vendor_name', op: 'eq', value: 'Parts for Truck Inc' },
          { field: 'created_at', op: 'gte', value: 'last_month_start' },
          { field: 'created_at', op: 'lte', value: 'last_month_end' },
        ],
      },
      needs_confirmation: false,
      reason: 'Explicit PO list with vendor and time window.',
    },
  },
  {
    user: 'Create a PO for Phoenix Trailer for 3 axle kits and 10 U-bolts',
    response: {
      intent: 'create_purchase_order',
      confidence: 0.91,
      slots: {
        vendor_name: 'Phoenix Trailer',
        line_items: [
          { sku: null, part_name: 'axle kit', qty: 3 },
          { sku: null, part_name: 'U-bolt', qty: 10 },
        ],
      },
      needs_confirmation: true,
      reason: 'Write action requesting a new PO with line items.',
    },
  },
  {
    user: 'Make a sales order to ABC Logistics for 2 leaf springs',
    response: {
      intent: 'create_sales_order',
      confidence: 0.9,
      slots: {
        customer_name: 'ABC Logistics',
        line_items: [{ sku: null, part_name: 'leaf spring', qty: 2 }],
      },
      needs_confirmation: true,
      reason: 'Write action to create SO; quantities specified.',
    },
  },
  {
    user: 'Update pickup for SO-1023 to tomorrow at 3pm',
    response: {
      intent: 'update_pickup_details',
      confidence: 0.92,
      slots: {
        so_number: 'SO-1023',
        pickup_time: 'tomorrow 3pm',
      },
      needs_confirmation: false,
      reason: 'Pickup change for a specific sales order.',
    },
  },
  {
    user: 'How do I add a new vendor?',
    response: {
      intent: 'doc_help',
      confidence: 0.95,
      slots: {
        topic: 'add vendor',
      },
      needs_confirmation: false,
      reason: 'Product usage question.',
    },
  },
  {
    user: 'thanks!',
    response: {
      intent: 'smalltalk',
      confidence: 0.99,
      slots: {},
      needs_confirmation: false,
      reason: 'Chit-chat only.',
    },
  },
  {
    user: 'Delete customer 5521 and wipe their orders',
    response: {
      intent: 'none',
      confidence: 0.98,
      slots: {},
      needs_confirmation: false,
      reason: 'Destructive/unsupported action.',
    },
  },
  {
    user: 'Status of PO-778?',
    response: {
      intent: 'inventory_lookup',
      confidence: 0.93,
      slots: {
        entity_type: 'purchase_order',
        order_number: 'PO-778',
      },
      needs_confirmation: false,
      reason: 'Read-only status lookup for a specific PO.',
    },
  },
  {
    user: 'Parts for trucks inc??',
    response: {
      intent: 'inventory_lookup',
      confidence: 0.63,
      slots: {
        entity_type: 'vendor',
        entity_name: 'Parts for trucks inc',
      },
      needs_confirmation: false,
      reason: 'Likely vendor lookup; low certainty due to spelling/punctuation.',
    },
  },
];

const buildFewShotContents = () =>
  FEW_SHOT_EXAMPLES.flatMap((example) => [
    { role: 'user', parts: [{ text: example.user }] },
    { role: 'model', parts: [{ text: JSON.stringify(example.response) }] },
  ]);

const INTENT_ENUM: ClosedIntent[] = [
  'inventory_lookup',
  'create_purchase_order',
  'create_sales_order',
  'create_quote',
  'update_pickup_details',
  'doc_help',
  'smalltalk',
  'none',
];

export class GeminiIntentRouter {
  private model: GenerativeModel | null;
  private temperature: number;
  private logger?: (message: string, metadata?: Record<string, unknown>) => void;

  constructor(options: RouterOptions) {
    this.temperature = options.temperature ?? 0.1;
    this.logger = options.logger;

    if (!options.apiKey) {
      this.model = null;
      this.logger?.('gemini_router_disabled', { reason: 'missing_api_key' });
      return;
    }

    const genAI = new GoogleGenerativeAI(options.apiKey);
    const modelName = options.model || 'gemini-1.5-flash';
    this.model = genAI.getGenerativeModel({ model: modelName });
  }

  async classify(utterance: string): Promise<StructuredIntent | null> {
    if (!this.model) {
      return null;
    }

    const trimmed = utterance?.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const response = await this.model.generateContent({
        systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT }] },
        contents: [...buildFewShotContents(), { role: 'user', parts: [{ text: trimmed }] }],
        generationConfig: {
          temperature: this.temperature,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
        },
      });

      const text = response.response.text();
      if (!text) {
        return null;
      }

      const parsed = this.parseStructuredIntent(text);
      if (!parsed) {
        return null;
      }

      return parsed;
    } catch (error) {
      this.logger?.('gemini_router_error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private parseStructuredIntent(payload: string): StructuredIntent | null {
    let data: any;
    try {
      data = JSON.parse(payload);
    } catch (error) {
      this.logger?.('gemini_router_parse_error', {
        payload,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    if (!data || typeof data !== 'object') {
      return null;
    }

    const intent: ClosedIntent = INTENT_ENUM.includes(data.intent) ? data.intent : 'none';
    const confidence = typeof data.confidence === 'number' && Number.isFinite(data.confidence) ? data.confidence : 0;
    const slots: StructuredSlots = this.normalizeSlots(data.slots);
    const needsConfirmation = Boolean(data.needs_confirmation);
    const reason = typeof data.reason === 'string' ? data.reason : '';

    return {
      intent,
      confidence: Math.min(Math.max(confidence, 0), 1),
      slots,
      needs_confirmation: needsConfirmation,
      reason,
    };
  }

  private normalizeSlots(value: unknown): StructuredSlots {
    if (!value || typeof value !== 'object') {
      return {};
    }

    const source = value as Record<string, unknown>;
    const slots: StructuredSlots = {};

    if (typeof source.entity_type === 'string') {
      const normalized = source.entity_type.trim().toLowerCase();
      if (
        normalized === 'vendor' ||
        normalized === 'customer' ||
        normalized === 'part' ||
        normalized === 'purchase_order' ||
        normalized === 'sales_order' ||
        normalized === 'quote'
      ) {
        slots.entity_type = normalized as EntityType;
      }
    }

    if (typeof source.entity_name === 'string' && source.entity_name.trim().length > 0) {
      slots.entity_name = source.entity_name.trim();
    }

    if (typeof source.order_number === 'string' && source.order_number.trim().length > 0) {
      slots.order_number = source.order_number.trim();
    }

    if (typeof source.part_identifier === 'string' && source.part_identifier.trim().length > 0) {
      slots.part_identifier = source.part_identifier.trim();
    }

    if (Array.isArray(source.filters)) {
      slots.filters = source.filters
        .map((item: any) => {
          if (!item || typeof item !== 'object') {
            return null;
          }
          const field = typeof item.field === 'string' ? item.field.trim() : '';
          const op = typeof item.op === 'string' ? item.op.trim() : '';
          const value = typeof item.value === 'string' ? item.value : '';
          if (!field || !value) {
            return null;
          }
          const normalizedOp = op.toLowerCase();
          if (!['eq', 'contains', 'gte', 'lte', 'gt', 'lt'].includes(normalizedOp)) {
            return null;
          }
          return { field, op: normalizedOp as FilterSlot['op'], value };
        })
        .filter((item): item is FilterSlot => Boolean(item));
    }

    if (typeof source.vendor_name === 'string' && source.vendor_name.trim().length > 0) {
      slots.vendor_name = source.vendor_name.trim();
    }

    if (typeof source.customer_name === 'string' && source.customer_name.trim().length > 0) {
      slots.customer_name = source.customer_name.trim();
    }

    if (Array.isArray(source.line_items)) {
      slots.line_items = source.line_items
        .map((item: any) => {
          if (!item || typeof item !== 'object') {
            return null;
          }
          const sku = item.sku === null || typeof item.sku === 'string' ? item.sku : null;
          const partName = item.part_name === null || typeof item.part_name === 'string' ? item.part_name : null;
          const qty = typeof item.qty === 'number' && Number.isFinite(item.qty) ? item.qty : NaN;
          if (!Number.isFinite(qty)) {
            return null;
          }
          return { sku, part_name: partName, qty };
        })
        .filter((item): item is { sku: string | null; part_name: string | null; qty: number } => Boolean(item));
    }

    if (typeof source.notes === 'string' && source.notes.trim().length > 0) {
      slots.notes = source.notes.trim();
    }

    if (typeof source.so_number === 'string' && source.so_number.trim().length > 0) {
      slots.so_number = source.so_number.trim();
    }

    if (typeof source.pickup_time === 'string' && source.pickup_time.trim().length > 0) {
      slots.pickup_time = source.pickup_time.trim();
    }

    if (typeof source.topic === 'string' && source.topic.trim().length > 0) {
      slots.topic = source.topic.trim();
    }

    return slots;
  }
}

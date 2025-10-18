import crypto from 'crypto';
import { Pool, PoolClient } from 'pg';
import { pool as defaultPool } from '../db';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MessageRole = 'user' | 'assistant' | 'system';

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface ConversationReflection {
  id: string;
  conversationId: string;
  trigger: string;
  riskLevel: string;
  summary: string;
  recommendation: string | null;
  requiresRevision: boolean;
  impactedTools: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface ConversationReflectionInput {
  trigger: string;
  riskLevel?: string;
  summary: string;
  recommendation?: string | null;
  requiresRevision?: boolean;
  impactedTools?: string[];
  metadata?: Record<string, unknown>;
}

export interface ConversationSummaryMetadata {
  highlights: string[];
  resolution: string | null;
  lastSummarizedMessageId: string | null;
}

export interface ConversationSummarySnapshot {
  summaryText: string | null;
  metadata: ConversationSummaryMetadata;
  updatedAt: Date | null;
}

export interface ConversationRecord {
  id: string;
  userId: number | null;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
  summary: ConversationSummarySnapshot;
}

export interface ConversationSummaryUpdate {
  summaryText: string | null;
  highlights: string[];
  resolution: string | null;
  lastSummarizedMessageId: string | null;
}

export class ConversationManager {
  private readonly loggedIdentifierWarnings = new Set<string>();

  constructor(private readonly pool: Pool = defaultPool) {}

  async ensureConversation(conversationId?: string | null, userId?: number | null): Promise<string> {
    const normalized = this.normalizeConversationIdentifier(conversationId);
    const existingId = normalized?.id ?? null;

    if (existingId) {
      const existing = await this.pool.query(
        'SELECT id FROM ai_conversations WHERE id = $1',
        [existingId]
      );

      const existingCount = existing.rowCount ?? 0;
      if (existingCount > 0) {
        if (userId) {
          await this.pool.query(
            'UPDATE ai_conversations SET user_id = COALESCE(user_id, $2) WHERE id = $1',
            [existingId, userId]
          );
        }
        return existingId;
      }
    }

    const id = existingId ?? crypto.randomUUID();
    await this.pool.query(
      `INSERT INTO ai_conversations (id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET user_id = COALESCE(ai_conversations.user_id, EXCLUDED.user_id)`,
      [id, userId ?? null]
    );

    return id;
  }

  async addMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    metadata: Record<string, unknown> = {},
    client?: PoolClient
  ): Promise<string> {
    const db = client ?? this.pool;
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO ai_messages (id, conversation_id, role, content, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, conversationId, role, content, metadata ?? {}]
    );

    await db.query(
      `UPDATE ai_conversations
         SET last_message_at = NOW(),
             updated_at = NOW()
       WHERE id = $1`,
      [conversationId]
    );

    return id;
  }

  async getConversationHistory(conversationId: string, limit = 50): Promise<ConversationMessage[]> {
    const result = await this.pool.query(
      `SELECT id, conversation_id, role, content, metadata, created_at
         FROM ai_messages
        WHERE conversation_id = $1
        ORDER BY created_at ASC
        LIMIT $2`,
      [conversationId, limit]
    );

    return result.rows.map(row => {
      let metadata: Record<string, unknown> = {};
      if (row.metadata) {
        if (typeof row.metadata === 'string') {
          try {
            metadata = JSON.parse(row.metadata);
          } catch (error) {
            console.warn('[AI Conversations] Failed to parse metadata JSON:', error);
            metadata = {};
          }
        } else {
          metadata = row.metadata;
        }
      }

      return {
        id: row.id,
        conversationId: row.conversation_id,
        role: row.role,
        content: row.content,
        metadata,
        createdAt: new Date(row.created_at)
      };
    });
  }

  async getConversation(conversationId: string): Promise<ConversationRecord | null> {
    const result = await this.pool.query(
      `SELECT id, user_id, status, metadata, created_at, updated_at, last_message_at, summary, summary_metadata, summary_updated_at
         FROM ai_conversations
        WHERE id = $1`,
      [conversationId]
    );

    if (result.rowCount === 0) {
      return null;
    }

    const row = result.rows[0];
    let metadata: Record<string, unknown> = {};
    if (row.metadata) {
      if (typeof row.metadata === 'string') {
        try {
          metadata = JSON.parse(row.metadata);
        } catch (error) {
          console.warn('[AI Conversations] Failed to parse conversation metadata JSON:', error);
        }
      } else {
        metadata = row.metadata;
      }
    }

    let summaryMetadata: ConversationSummaryMetadata = {
      highlights: [],
      resolution: null,
      lastSummarizedMessageId: null
    };

    if (row.summary_metadata) {
      if (typeof row.summary_metadata === 'string') {
        try {
          const parsed = JSON.parse(row.summary_metadata);
          summaryMetadata = {
            highlights: Array.isArray(parsed?.highlights) ? parsed.highlights : [],
            resolution: typeof parsed?.resolution === 'string' ? parsed.resolution : null,
            lastSummarizedMessageId:
              typeof parsed?.lastSummarizedMessageId === 'string' ? parsed.lastSummarizedMessageId : null
          };
        } catch (error) {
          console.warn('[AI Conversations] Failed to parse conversation summary metadata JSON:', error);
        }
      } else {
        summaryMetadata = {
          highlights: Array.isArray((row.summary_metadata as any)?.highlights)
            ? (row.summary_metadata as any).highlights
            : [],
          resolution:
            typeof (row.summary_metadata as any)?.resolution === 'string'
              ? (row.summary_metadata as any).resolution
              : null,
          lastSummarizedMessageId:
            typeof (row.summary_metadata as any)?.lastSummarizedMessageId === 'string'
              ? (row.summary_metadata as any).lastSummarizedMessageId
              : null
        };
      }
    }

    return {
      id: row.id,
      userId: row.user_id ?? null,
      status: row.status,
      metadata,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastMessageAt: new Date(row.last_message_at),
      summary: {
        summaryText: row.summary ?? null,
        metadata: summaryMetadata,
        updatedAt: row.summary_updated_at ? new Date(row.summary_updated_at) : null
      }
    };
  }

  async updateConversationSummary(
    conversationId: string,
    update: ConversationSummaryUpdate
  ): Promise<void> {
    const payload = {
      highlights: update.highlights ?? [],
      resolution: update.resolution ?? null,
      lastSummarizedMessageId: update.lastSummarizedMessageId ?? null
    };

    await this.pool.query(
      `UPDATE ai_conversations
          SET summary = $2,
              summary_metadata = jsonb_strip_nulls($3::jsonb),
              summary_updated_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [conversationId, update.summaryText ?? null, JSON.stringify(payload)]
    );
  }

  async clearConversation(conversationId: string): Promise<void> {
    await this.pool.query('DELETE FROM ai_conversations WHERE id = $1', [conversationId]);
  }

  async getStatistics(): Promise<{ totalConversations: number; totalMessages: number; activeConversations: number }>
  {
    const [conversationCount, messageCount, activeCount] = await Promise.all([
      this.pool.query('SELECT COUNT(*)::int AS count FROM ai_conversations'),
      this.pool.query('SELECT COUNT(*)::int AS count FROM ai_messages'),
      this.pool.query("SELECT COUNT(*)::int AS count FROM ai_conversations WHERE status = 'active'")
    ]);

    return {
      totalConversations: conversationCount.rows[0].count,
      totalMessages: messageCount.rows[0].count,
      activeConversations: activeCount.rows[0].count
    };
  }

  async addReflection(
    conversationId: string,
    input: ConversationReflectionInput,
    client?: PoolClient
  ): Promise<string> {
    const db = client ?? this.pool;
    const id = crypto.randomUUID();
    const impactedTools = Array.isArray(input.impactedTools) ? input.impactedTools : [];
    const metadata = input.metadata ?? {};

    await db.query(
      `INSERT INTO ai_conversation_reflections (
         id,
         conversation_id,
         trigger,
         risk_level,
         summary,
         recommendation,
         requires_revision,
         impacted_tools,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
      [
        id,
        conversationId,
        input.trigger,
        (input.riskLevel ?? 'normal').toLowerCase(),
        input.summary,
        input.recommendation ?? null,
        input.requiresRevision ?? false,
        JSON.stringify(impactedTools),
        JSON.stringify(metadata)
      ]
    );

    return id;
  }

  async listReflections(
    conversationId: string,
    limit = 20,
    client?: PoolClient
  ): Promise<ConversationReflection[]> {
    const db = client ?? this.pool;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 20;
    const result = await db.query(
      `SELECT
         id,
         conversation_id,
         trigger,
         risk_level,
         summary,
         recommendation,
         requires_revision,
         impacted_tools,
         metadata,
         created_at
       FROM ai_conversation_reflections
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [conversationId, safeLimit]
    );

    return result.rows.map(row => {
      let impactedTools: string[] = [];
      if (Array.isArray(row.impacted_tools)) {
        impactedTools = row.impacted_tools.filter((item: unknown): item is string => typeof item === 'string');
      } else if (typeof row.impacted_tools === 'string') {
        try {
          const parsed = JSON.parse(row.impacted_tools);
          if (Array.isArray(parsed)) {
            impactedTools = parsed.filter((item: unknown): item is string => typeof item === 'string');
          }
        } catch (error) {
          console.warn('[AI Conversations] Failed to parse impacted tools JSON:', error);
        }
      }

      let metadata: Record<string, unknown> = {};
      if (row.metadata) {
        if (typeof row.metadata === 'string') {
          try {
            metadata = JSON.parse(row.metadata);
          } catch (error) {
            console.warn('[AI Conversations] Failed to parse reflection metadata JSON:', error);
          }
        } else {
          metadata = row.metadata;
        }
      }

      return {
        id: row.id,
        conversationId: row.conversation_id,
        trigger: row.trigger,
        riskLevel: row.risk_level,
        summary: row.summary,
        recommendation: row.recommendation ?? null,
        requiresRevision: row.requires_revision ?? false,
        impactedTools,
        metadata,
        createdAt: new Date(row.created_at)
      };
    });
  }

  private normalizeConversationIdentifier(
    conversationId?: string | null
  ): { id: string } | null {
    if (!conversationId) {
      return null;
    }

    const trimmed = conversationId.trim();
    if (trimmed.length === 0) {
      return null;
    }

    if (UUID_PATTERN.test(trimmed)) {
      return { id: trimmed };
    }

    const deterministicId = ConversationManager.deterministicUuidFromString(trimmed);
    if (!this.loggedIdentifierWarnings.has(trimmed)) {
      console.warn(
        `[AI Conversations] Received non-UUID conversation identifier "${trimmed}". ` +
          `Using deterministic UUID "${deterministicId}" instead.`
      );
      this.loggedIdentifierWarnings.add(trimmed);
    }

    return { id: deterministicId };
  }

  private static deterministicUuidFromString(input: string): string {
    const hash = crypto.createHash('sha256').update(input).digest();
    const bytes = Buffer.from(hash.slice(0, 16));

    // Conform to RFC 4122 variant and set version 5 (name-based, SHA-1 in the spec).
    // We're using SHA-256 for the hash to reduce collision risk, then forcing the
    // version/variant bits so the resulting string is a valid UUID.
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = bytes.toString('hex');
    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}`;
  }
}

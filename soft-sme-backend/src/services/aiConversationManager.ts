import crypto from 'crypto';
import { Pool, PoolClient } from 'pg';
import { pool as defaultPool } from '../db';

type MessageRole = 'user' | 'assistant' | 'system';

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface ConversationRecord {
  id: string;
  userId: number | null;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
}

export class ConversationManager {
  constructor(private readonly pool: Pool = defaultPool) {}

  async ensureConversation(conversationId?: string | null, userId?: number | null): Promise<string> {
    if (conversationId) {
      const existing = await this.pool.query(
        'SELECT id FROM ai_conversations WHERE id = $1',
        [conversationId]
      );

      const existingCount = existing.rowCount ?? 0;
      if (existingCount > 0) {
        if (userId) {
          await this.pool.query(
            'UPDATE ai_conversations SET user_id = COALESCE(user_id, $2) WHERE id = $1',
            [conversationId, userId]
          );
        }
        return conversationId;
      }
    }

    const id = conversationId || crypto.randomUUID();
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
      `SELECT id, user_id, status, metadata, created_at, updated_at, last_message_at
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

    return {
      id: row.id,
      userId: row.user_id ?? null,
      status: row.status,
      metadata,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastMessageAt: new Date(row.last_message_at)
    };
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
}

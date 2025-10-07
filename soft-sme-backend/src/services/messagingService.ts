import { Pool, PoolClient } from 'pg';
import { pool } from '../db';

export interface ConversationParticipant {
  id: number;
  username: string | null;
  email: string | null;
  isAdmin: boolean;
}

export interface MessageDTO {
  id: number;
  conversationId: number;
  senderId: number | null;
  senderName: string | null;
  content: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  isDeletedForUser: boolean;
  deletedAt: string | null;
}

export interface ConversationDTO {
  id: number;
  companyId: number;
  conversationType: 'direct' | 'group';
  title: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  participants: ConversationParticipant[];
  lastMessage: MessageDTO | null;
}

interface CreateConversationInput {
  companyId: number;
  createdBy: number;
  participantIds: number[];
  title?: string | null;
  type?: 'direct' | 'group';
}

class MessagingService {
  constructor(private readonly db: Pool) {}

  private async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private mapConversation(row: any): ConversationDTO {
    const participantsRaw = row.participant_list || [];
    const participants: ConversationParticipant[] = Array.isArray(participantsRaw)
      ? participantsRaw.map((participant: any) => ({
          id: typeof participant.id === 'number' ? participant.id : Number(participant.id),
          username: participant.username ?? null,
          email: participant.email ?? null,
          isAdmin: Boolean(participant.isAdmin ?? participant.is_admin ?? false)
        }))
      : [];

    const lastMessage: MessageDTO | null = row.last_message_id
      ? {
          id: Number(row.last_message_id),
          conversationId: Number(row.id),
          senderId: row.last_message_sender_id !== null && row.last_message_sender_id !== undefined
            ? Number(row.last_message_sender_id)
            : null,
          senderName: row.last_message_sender_username || row.last_message_sender_email || null,
          content: row.last_message_is_deleted_for_user ? 'Message deleted' : row.last_message_content,
          isSystem: Boolean(row.last_message_is_system),
          createdAt: row.last_message_created_at,
          updatedAt: row.last_message_created_at,
          isDeletedForUser: Boolean(row.last_message_is_deleted_for_user),
          deletedAt: row.last_message_deleted_at ?? null,
        }
      : null;

    return {
      id: Number(row.id),
      companyId: Number(row.company_id),
      conversationType: row.conversation_type,
      title: row.title,
      createdBy: Number(row.created_by),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastMessageAt: row.last_message_at,
      participants,
      lastMessage,
    };
  }

  private mapMessage(row: any): MessageDTO {
    return {
      id: Number(row.id),
      conversationId: Number(row.conversation_id),
      senderId: row.sender_id !== null && row.sender_id !== undefined ? Number(row.sender_id) : null,
      senderName: row.username || row.email || null,
      content: row.is_deleted_for_user ? 'Message deleted' : row.content,
      isSystem: Boolean(row.is_system),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isDeletedForUser: Boolean(row.is_deleted_for_user),
      deletedAt: row.deleted_at ?? null,
    };
  }

  private async fetchConversationById(conversationId: number, client?: PoolClient): Promise<ConversationDTO | null> {
    const executor = client ?? this.db;
    const result = await executor.query(
      `SELECT
         c.id,
         c.company_id,
         c.conversation_type,
         c.title,
         c.created_by,
         c.last_message_at,
         c.created_at,
         c.updated_at,
         participants.participant_list,
         last_message.id AS last_message_id,
         last_message.content AS last_message_content,
         last_message.sender_id AS last_message_sender_id,
         last_message.created_at AS last_message_created_at,
         last_message.is_system AS last_message_is_system,
         last_message.is_deleted_for_user AS last_message_is_deleted_for_user,
         last_message.deleted_at AS last_message_deleted_at,
         last_sender.username AS last_message_sender_username,
         last_sender.email AS last_message_sender_email
       FROM conversations c
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
           jsonb_build_object(
             'id', u.id,
             'username', u.username,
             'email', u.email,
             'isAdmin', cp.is_admin
           ) ORDER BY u.username
         ) AS participant_list
         FROM conversation_participants cp
         LEFT JOIN users u ON u.id = cp.user_id
         WHERE cp.conversation_id = c.id
       ) AS participants ON TRUE
       LEFT JOIN LATERAL (
         SELECT m.id,
                m.content,
                m.sender_id,
                m.created_at,
                m.is_system,
                (md.deleted_at IS NOT NULL) AS is_deleted_for_user,
                md.deleted_at
         FROM messages m
         LEFT JOIN message_deletions md ON md.message_id = m.id AND md.user_id = $1
         WHERE m.conversation_id = c.id
         ORDER BY m.created_at DESC
         LIMIT 1
       ) AS last_message ON TRUE
       LEFT JOIN users last_sender ON last_sender.id = last_message.sender_id
       WHERE c.id = $1`,
      [conversationId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapConversation(result.rows[0]);
  }

  private async ensureParticipant(conversationId: number, userId: number, client?: PoolClient): Promise<void> {
    const executor = client ?? this.db;
    const membership = await executor.query(
      `SELECT 1
       FROM conversation_participants
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId]
    );

    if (membership.rows.length === 0) {
      const error = new Error('You are not a participant in this conversation.');
      (error as any).status = 403;
      throw error;
    }
  }

  private sanitizeParticipantIds(ids: number[], creatorId: number): number[] {
    const deduped = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
    return deduped.filter((id) => id !== creatorId);
  }

  async createConversation(input: CreateConversationInput): Promise<{ conversation: ConversationDTO; created: boolean }> {
    return this.withTransaction(async (dbClient) => {
      const participantIds = this.sanitizeParticipantIds(input.participantIds, input.createdBy);
      if (participantIds.length === 0) {
        const error = new Error('At least one additional participant is required.');
        (error as any).status = 400;
        throw error;
      }

      const allParticipantIds = Array.from(new Set([...participantIds, input.createdBy]));
      const conversationType: 'direct' | 'group' = input.type
        ? input.type
        : participantIds.length > 1
          ? 'group'
          : 'direct';

      if (conversationType === 'group' && !input.title?.trim()) {
        const error = new Error('Group conversations require a title.');
        (error as any).status = 400;
        throw error;
      }

      const validParticipants = await dbClient.query(
        `SELECT id
         FROM users
         WHERE company_id = $1 AND id = ANY($2::int[])`,
        [input.companyId, allParticipantIds]
      );

      if (validParticipants.rows.length !== allParticipantIds.length) {
        const error = new Error('One or more participants do not belong to your company.');
        (error as any).status = 400;
        throw error;
      }

      if (conversationType === 'direct') {
        const sortedIds = [...allParticipantIds].sort((a, b) => a - b);
        const existing = await dbClient.query(
          `SELECT c.id
           FROM conversations c
           JOIN conversation_participants cp ON cp.conversation_id = c.id
           WHERE c.company_id = $1 AND c.conversation_type = 'direct'
           GROUP BY c.id
           HAVING array_agg(cp.user_id ORDER BY cp.user_id) = $2::int[]
           LIMIT 1`,
          [input.companyId, sortedIds]
        );

        if (existing.rows.length > 0) {
          const conversation = await this.fetchConversationById(Number(existing.rows[0].id), dbClient);
          if (!conversation) {
            throw new Error('Failed to load existing conversation.');
          }
          return { conversation, created: false };
        }
      }

      const conversationResult = await dbClient.query(
        `INSERT INTO conversations (company_id, conversation_type, title, created_by, last_message_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         RETURNING id`,
        [
          input.companyId,
          conversationType,
          conversationType === 'group' ? input.title?.trim() || null : null,
          input.createdBy,
        ]
      );

      const conversationId = Number(conversationResult.rows[0].id);

      const values: any[] = [conversationId];
      const placeholders: string[] = [];
      allParticipantIds.forEach((participantId, index) => {
        values.push(participantId);
        values.push(participantId === input.createdBy);
        const offset = index * 2;
        placeholders.push(`($1, $${offset + 2}, $${offset + 3})`);
      });

      await dbClient.query(
        `INSERT INTO conversation_participants (conversation_id, user_id, is_admin)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        values
      );

      const conversation = await this.fetchConversationById(conversationId, dbClient);
      if (!conversation) {
        throw new Error('Conversation creation failed.');
      }

      return { conversation, created: true };
    });
  }

  async getUserConversations(userId: number, companyId: number): Promise<ConversationDTO[]> {
    const result = await this.db.query(
       `SELECT
          c.id,
          c.company_id,
          c.conversation_type,
          c.title,
          c.created_by,
          c.last_message_at,
          c.created_at,
          c.updated_at,
          participants.participant_list,
          last_message.id AS last_message_id,
          last_message.content AS last_message_content,
          last_message.sender_id AS last_message_sender_id,
          last_message.created_at AS last_message_created_at,
          last_message.is_system AS last_message_is_system,
          last_message.is_deleted_for_user AS last_message_is_deleted_for_user,
          last_message.deleted_at AS last_message_deleted_at,
          last_sender.username AS last_message_sender_username,
          last_sender.email AS last_message_sender_email
       FROM conversations c
       JOIN conversation_participants membership ON membership.conversation_id = c.id AND membership.user_id = $1
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
           jsonb_build_object(
             'id', u.id,
             'username', u.username,
             'email', u.email,
             'isAdmin', cp.is_admin
           ) ORDER BY u.username
         ) AS participant_list
         FROM conversation_participants cp
         LEFT JOIN users u ON u.id = cp.user_id
         WHERE cp.conversation_id = c.id
       ) AS participants ON TRUE
       LEFT JOIN LATERAL (
         SELECT m.id,
                m.content,
                m.sender_id,
                m.created_at,
                m.is_system,
                (md.deleted_at IS NOT NULL) AS is_deleted_for_user,
                md.deleted_at
         FROM messages m
         LEFT JOIN message_deletions md ON md.message_id = m.id AND md.user_id = $1
         WHERE m.conversation_id = c.id
         ORDER BY m.created_at DESC
         LIMIT 1
       ) AS last_message ON TRUE
       LEFT JOIN users last_sender ON last_sender.id = last_message.sender_id
       WHERE c.company_id = $2
       ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC, c.id DESC`,
      [userId, companyId]
    );

    return result.rows.map((row) => this.mapConversation(row));
  }

  async appendMessage(conversationId: number, senderId: number, content: string): Promise<MessageDTO> {
    const trimmed = content.trim();
    if (!trimmed) {
      const error = new Error('Message content cannot be empty.');
      (error as any).status = 400;
      throw error;
    }

    return this.withTransaction(async (client) => {
      await this.ensureParticipant(conversationId, senderId, client);

      const insertResult = await client.query(
        `INSERT INTO messages (conversation_id, sender_id, content)
         VALUES ($1, $2, $3)
         RETURNING id` ,
        [conversationId, senderId, trimmed]
      );

      const messageId = Number(insertResult.rows[0].id);

      await client.query(
        `UPDATE conversations
         SET last_message_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [conversationId]
      );

      const messageResult = await client.query(
        `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.is_system, m.created_at, m.updated_at,
                u.username, u.email
         FROM messages m
         LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.id = $1`,
        [messageId]
      );

      if (messageResult.rows.length === 0) {
        throw new Error('Failed to load message after creation.');
      }

      return this.mapMessage(messageResult.rows[0]);
    });
  }

  async deleteMessageForUser(
    conversationId: number,
    messageId: number,
    userId: number
  ): Promise<MessageDTO> {
    return this.withTransaction(async (client) => {
      await this.ensureParticipant(conversationId, userId, client);

      const messageRow = await client.query(
        `SELECT id, conversation_id
         FROM messages
         WHERE id = $1`,
        [messageId]
      );

      if (messageRow.rows.length === 0) {
        const error = new Error('Message not found.');
        (error as any).status = 404;
        throw error;
      }

      const record = messageRow.rows[0];
      if (Number(record.conversation_id) !== conversationId) {
        const error = new Error('Message does not belong to this conversation.');
        (error as any).status = 400;
        throw error;
      }

      await client.query(
        `INSERT INTO message_deletions (message_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (message_id, user_id) DO UPDATE
         SET deleted_at = CURRENT_TIMESTAMP`,
        [messageId, userId]
      );

      const messageResult = await client.query(
        `SELECT m.id,
                m.conversation_id,
                m.sender_id,
                m.content,
                m.is_system,
                m.created_at,
                m.updated_at,
                u.username,
                u.email,
                TRUE AS is_deleted_for_user,
                md.deleted_at
         FROM messages m
         LEFT JOIN users u ON u.id = m.sender_id
         LEFT JOIN message_deletions md ON md.message_id = m.id AND md.user_id = $2
         WHERE m.id = $1`,
        [messageId, userId]
      );

      if (messageResult.rows.length === 0) {
        const error = new Error('Unable to load message after deletion.');
        (error as any).status = 500;
        throw error;
      }

      return this.mapMessage(messageResult.rows[0]);
    });
  }

  async getConversationMessages(
    conversationId: number,
    userId: number,
    options: { before?: string; limit?: number } = {}
  ): Promise<MessageDTO[]> {
    await this.ensureParticipant(conversationId, userId);

    const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 200) : 100;
    const before = options.before ? new Date(options.before) : null;

    const result = await this.db.query(
      `SELECT m.id,
              m.conversation_id,
              m.sender_id,
              m.content,
              m.is_system,
              m.created_at,
              m.updated_at,
              u.username,
              u.email,
              (md.deleted_at IS NOT NULL) AS is_deleted_for_user,
              md.deleted_at
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       LEFT JOIN message_deletions md ON md.message_id = m.id AND md.user_id = $2
       WHERE m.conversation_id = $1
         AND ($3::timestamptz IS NULL OR m.created_at < $3::timestamptz)
       ORDER BY m.created_at ASC
       LIMIT $4`,
      [conversationId, userId, before, limit]
    );

    return result.rows.map((row) => this.mapMessage(row));
  }
}

export const messagingService = new MessagingService(pool);

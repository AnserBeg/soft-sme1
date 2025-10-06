import api from '../api/axios';

export interface MessagingParticipant {
  id: number;
  username: string | null;
  email: string | null;
  isAdmin: boolean;
}

export interface MessagingMessage {
  id: number | string;
  conversationId: number;
  senderId: number | null;
  senderName: string | null;
  content: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  pending?: boolean;
  error?: boolean;
  isDeletedForUser?: boolean;
  deletedAt?: string | null;
}

export interface MessagingConversation {
  id: number;
  companyId: number;
  conversationType: 'direct' | 'group';
  title: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  participants: MessagingParticipant[];
  lastMessage: MessagingMessage | null;
}

interface CreateConversationPayload {
  participantIds: number[];
  title?: string;
  type?: 'direct' | 'group';
}

const normalizeConversation = (conversation: any): MessagingConversation => ({
  id: Number(conversation.id),
  companyId: Number(conversation.companyId ?? conversation.company_id),
  conversationType: conversation.conversationType ?? conversation.conversation_type,
  title: conversation.title ?? null,
  createdBy: Number(conversation.createdBy ?? conversation.created_by),
  createdAt: conversation.createdAt ?? conversation.created_at,
  updatedAt: conversation.updatedAt ?? conversation.updated_at,
  lastMessageAt: conversation.lastMessageAt ?? conversation.last_message_at ?? null,
  participants: Array.isArray(conversation.participants)
    ? conversation.participants.map((participant: any) => ({
        id: Number(participant.id),
        username: participant.username ?? null,
        email: participant.email ?? null,
        isAdmin: Boolean(participant.isAdmin ?? participant.is_admin ?? false),
      }))
    : [],
  lastMessage: conversation.lastMessage
    ? {
        id: Number(conversation.lastMessage.id),
        conversationId: Number(conversation.lastMessage.conversationId ?? conversation.lastMessage.conversation_id ?? conversation.id),
        senderId:
          conversation.lastMessage.senderId !== undefined && conversation.lastMessage.senderId !== null
            ? Number(conversation.lastMessage.senderId)
            : null,
        senderName: conversation.lastMessage.senderName ?? null,
        content:
          conversation.lastMessage.isDeletedForUser || conversation.lastMessage.is_deleted_for_user
            ? 'Message deleted'
            : conversation.lastMessage.content ?? '',
        isSystem: Boolean(conversation.lastMessage.isSystem),
        createdAt: conversation.lastMessage.createdAt ?? '',
        updatedAt: conversation.lastMessage.updatedAt ?? conversation.lastMessage.createdAt ?? '',
        isDeletedForUser: Boolean(
          conversation.lastMessage.isDeletedForUser ?? conversation.lastMessage.is_deleted_for_user ?? false
        ),
        deletedAt: conversation.lastMessage.deletedAt ?? conversation.lastMessage.deleted_at ?? null,
      }
    : null,
});

const normalizeMessage = (message: any): MessagingMessage => ({
  id: typeof message.id === 'number' || typeof message.id === 'string' ? message.id : Number(message.id),
  conversationId: Number(message.conversationId ?? message.conversation_id),
  senderId:
    message.senderId !== undefined && message.senderId !== null
      ? Number(message.senderId)
      : message.sender_id !== undefined && message.sender_id !== null
        ? Number(message.sender_id)
        : null,
  senderName: message.senderName ?? message.sender_name ?? message.username ?? null,
  content: message.isDeletedForUser || message.is_deleted_for_user ? 'Message deleted' : message.content ?? '',
  isSystem: Boolean(message.isSystem ?? message.is_system ?? false),
  createdAt: message.createdAt ?? message.created_at ?? new Date().toISOString(),
  updatedAt: message.updatedAt ?? message.updated_at ?? message.createdAt ?? message.created_at ?? new Date().toISOString(),
  pending: message.pending,
  error: message.error,
  isDeletedForUser: Boolean(message.isDeletedForUser ?? message.is_deleted_for_user ?? false),
  deletedAt: message.deletedAt ?? message.deleted_at ?? null,
});

export const messagingService = {
  async createConversation(payload: CreateConversationPayload): Promise<{ conversation: MessagingConversation; created: boolean }> {
    const response = await api.post('/api/messaging/conversations', payload);
    const { conversation, created } = response.data;
    return { conversation: normalizeConversation(conversation), created: Boolean(created) };
  },

  async getConversations(): Promise<MessagingConversation[]> {
    const response = await api.get('/api/messaging/conversations');
    const conversations = response.data?.conversations ?? [];
    return conversations.map((conversation: any) => normalizeConversation(conversation));
  },

  async getMessages(conversationId: number, params: { before?: string; limit?: number } = {}): Promise<MessagingMessage[]> {
    const response = await api.get(`/api/messaging/conversations/${conversationId}/messages`, { params });
    const messages = response.data?.messages ?? [];
    return messages.map((message: any) => normalizeMessage(message));
  },

  async postMessage(conversationId: number, content: string): Promise<MessagingMessage> {
    const response = await api.post(`/api/messaging/conversations/${conversationId}/messages`, { content });
    return normalizeMessage(response.data?.message ?? response.data);
  },

  async deleteMessage(conversationId: number, messageId: number): Promise<MessagingMessage> {
    const response = await api.delete(`/api/messaging/conversations/${conversationId}/messages/${messageId}`);
    return normalizeMessage(response.data?.message ?? response.data);
  },
};

export default messagingService;

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import messagingService, {
  MessagingConversation,
  MessagingMessage,
  MessagingParticipant,
} from '../services/messagingService';
import { useAuth } from './AuthContext';

export interface ConversationSummary extends MessagingConversation {
  displayName: string;
  participantNames: string;
  otherParticipants: MessagingParticipant[];
}

interface MessagingContextValue {
  conversations: ConversationSummary[];
  isLoadingConversations: boolean;
  activeConversationId: number | null;
  selectConversation: (conversationId: number | null) => void;
  messagesByConversation: Record<number, MessagingMessage[]>;
  loadMessages: (conversationId: number, options?: { force?: boolean; silent?: boolean }) => Promise<void>;
  isLoadingMessages: Record<number, boolean>;
  sendMessage: (conversationId: number, content: string) => Promise<MessagingMessage>;
  createConversation: (
    payload: {
      participantIds: number[];
      title?: string;
      type?: 'direct' | 'group';
    }
  ) => Promise<{ conversation: ConversationSummary; created: boolean }>;
  refreshConversations: (options?: { silent?: boolean }) => Promise<void>;
  deleteMessage: (conversationId: number, messageId: number) => Promise<MessagingMessage>;
}

const MessagingContext = createContext<MessagingContextValue | undefined>(undefined);

const buildDisplayName = (
  conversation: MessagingConversation,
  currentUserId: number | null
): { displayName: string; otherParticipants: MessagingParticipant[]; participantNames: string } => {
  const participants = conversation.participants ?? [];
  const otherParticipants = currentUserId
    ? participants.filter((participant) => participant.id !== currentUserId)
    : participants;

  const participantNames = participants
    .map((participant) => participant.username || participant.email || 'Unknown user')
    .join(', ');

  if (conversation.conversationType === 'group') {
    const title = conversation.title?.trim();
    const fallback = `${participants.length} participants`;
    return {
      displayName: title || fallback,
      otherParticipants,
      participantNames,
    };
  }

  if (otherParticipants.length === 1) {
    const target = otherParticipants[0];
    return {
      displayName: target.username || target.email || 'Direct message',
      otherParticipants,
      participantNames,
    };
  }

  const name = otherParticipants.length > 0
    ? otherParticipants.map((participant) => participant.username || participant.email || 'Direct message').join(', ')
    : conversation.title || 'Direct message';

  return {
    displayName: name,
    otherParticipants,
    participantNames,
  };
};

const sortConversations = (items: ConversationSummary[]): ConversationSummary[] => {
  return [...items].sort((a, b) => {
    const aKey = a.lastMessageAt || a.updatedAt || a.createdAt;
    const bKey = b.lastMessageAt || b.updatedAt || b.createdAt;
    return new Date(bKey).getTime() - new Date(aKey).getTime();
  });
};

export const MessagingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useAuth();
  const currentUserId = user ? Number(user.id) : null;

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState<boolean>(false);
  const [messagesByConversation, setMessagesByConversation] = useState<Record<number, MessagingMessage[]>>({});
  const [isLoadingMessages, setIsLoadingMessages] = useState<Record<number, boolean>>({});
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);

  const messagesCacheRef = useRef<Record<number, MessagingMessage[]>>({});
  useEffect(() => {
    messagesCacheRef.current = messagesByConversation;
  }, [messagesByConversation]);

  const decorateConversation = useCallback(
    (conversation: MessagingConversation): ConversationSummary => {
      const { displayName, otherParticipants, participantNames } = buildDisplayName(conversation, currentUserId);
      return {
        ...conversation,
        displayName,
        otherParticipants,
        participantNames,
      };
    },
    [currentUserId]
  );

  const refreshConversations = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!isAuthenticated) {
      return;
    }
    if (!options.silent) {
      setIsLoadingConversations(true);
    }
    try {
      const fetched = await messagingService.getConversations();
      const decorated = sortConversations(fetched.map(decorateConversation));
      setConversations(decorated);
    } catch (error) {
      console.error('Failed to load conversations', error);
    } finally {
      if (!options.silent) {
        setIsLoadingConversations(false);
      }
    }
  }, [decorateConversation, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setConversations([]);
      setMessagesByConversation({});
      setIsLoadingConversations(false);
      setIsLoadingMessages({});
      setActiveConversationId(null);
      return;
    }
    refreshConversations();
  }, [isAuthenticated, refreshConversations]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    const interval = setInterval(() => {
      refreshConversations({ silent: true }).catch(() => undefined);
    }, 10000);
    return () => clearInterval(interval);
  }, [isAuthenticated, refreshConversations]);

  useEffect(() => {
    if (!isAuthenticated || conversations.length === 0) {
      return;
    }
    if (!activeConversationId || !conversations.some((conversation) => conversation.id === activeConversationId)) {
      setActiveConversationId(conversations[0].id);
    }
  }, [activeConversationId, conversations, isAuthenticated]);

  const loadMessages = useCallback(
    async (conversationId: number, options: { force?: boolean; silent?: boolean } = {}) => {
      if (!isAuthenticated) {
        return;
      }
      if (!options.force && messagesCacheRef.current[conversationId]) {
        return;
      }
      if (!options.silent) {
        setIsLoadingMessages((prev) => ({ ...prev, [conversationId]: true }));
      }
      try {
        const fetched = await messagingService.getMessages(conversationId);
        setMessagesByConversation((prev) => ({
          ...prev,
          [conversationId]: fetched.map((message) => ({ ...message, pending: false, error: false })),
        }));
      } catch (error) {
        console.error('Failed to load messages', error);
      } finally {
        if (!options.silent) {
          setIsLoadingMessages((prev) => ({ ...prev, [conversationId]: false }));
        }
      }
    },
    [isAuthenticated]
  );

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }
    loadMessages(activeConversationId).catch(() => undefined);
  }, [activeConversationId, loadMessages]);

  useEffect(() => {
    if (!activeConversationId || !isAuthenticated) {
      return;
    }
    const interval = setInterval(() => {
      loadMessages(activeConversationId, { force: true, silent: true }).catch(() => undefined);
    }, 10000);
    return () => clearInterval(interval);
  }, [activeConversationId, isAuthenticated, loadMessages]);

  const selectConversation = useCallback(
    (conversationId: number | null) => {
      setActiveConversationId(conversationId);
      if (conversationId) {
        loadMessages(conversationId).catch(() => undefined);
      }
    },
    [loadMessages]
  );

  const sendMessage = useCallback(
    async (conversationId: number, content: string) => {
      if (!isAuthenticated || !user) {
        throw new Error('Not authenticated');
      }
      const trimmed = content.trim();
      if (!trimmed) {
        throw new Error('Message cannot be empty');
      }

      const optimisticId = `temp-${Date.now()}`;
      const optimisticMessage: MessagingMessage = {
        id: optimisticId,
        conversationId,
        senderId: currentUserId,
        senderName: user.username || user.email || null,
        content: trimmed,
        isSystem: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        pending: true,
      };

      setMessagesByConversation((prev) => {
        const existing = prev[conversationId] ?? [];
        return {
          ...prev,
          [conversationId]: [...existing, optimisticMessage],
        };
      });

      try {
        const saved = await messagingService.postMessage(conversationId, trimmed);
        setMessagesByConversation((prev) => {
          const existing = prev[conversationId] ?? [];
          return {
            ...prev,
            [conversationId]: existing.map((message) => (message.id === optimisticId ? saved : message)),
          };
        });
        await refreshConversations();
        return saved;
      } catch (error) {
        setMessagesByConversation((prev) => {
          const existing = prev[conversationId] ?? [];
          return {
            ...prev,
            [conversationId]: existing.map((message) =>
              message.id === optimisticId ? { ...message, pending: false, error: true } : message
            ),
          };
        });
        throw error;
      }
    },
    [currentUserId, isAuthenticated, refreshConversations, user]
  );

  const deleteMessage = useCallback(
    async (conversationId: number, messageId: number) => {
      if (!isAuthenticated) {
        throw new Error('Not authenticated');
      }

      const updated = await messagingService.deleteMessage(conversationId, messageId);
      setMessagesByConversation((prev) => {
        const existing = prev[conversationId] ?? [];
        return {
          ...prev,
          [conversationId]: existing.map((message) =>
            Number(message.id) === Number(messageId)
              ? {
                  ...message,
                  ...updated,
                  id: message.id,
                  content: 'Message deleted',
                  isDeletedForUser: true,
                  deletedAt: updated.deletedAt ?? null,
                  pending: false,
                  error: false,
                }
              : message
          ),
        };
      });

      refreshConversations({ silent: true }).catch(() => undefined);
      return updated;
    },
    [isAuthenticated, refreshConversations]
  );

  const createConversation = useCallback(
    async (
      payload: {
        participantIds: number[];
        title?: string;
        type?: 'direct' | 'group';
      }
    ) => {
      if (!isAuthenticated) {
        throw new Error('Not authenticated');
      }
      const result = await messagingService.createConversation(payload);
      const decorated = decorateConversation(result.conversation);
      setConversations((prev) => {
        const filtered = prev.filter((conversation) => conversation.id !== decorated.id);
        return sortConversations([decorated, ...filtered]);
      });
      setActiveConversationId(decorated.id);
      if (result.created) {
        setMessagesByConversation((prev) => ({
          ...prev,
          [decorated.id]: [],
        }));
      }
      return { conversation: decorated, created: result.created };
    },
    [decorateConversation, isAuthenticated]
  );

  const value = useMemo<MessagingContextValue>(
    () => ({
      conversations,
      isLoadingConversations,
      activeConversationId,
      selectConversation,
      messagesByConversation,
      loadMessages,
      isLoadingMessages,
      sendMessage,
      createConversation,
      refreshConversations,
      deleteMessage,
    }),
    [
      conversations,
      isLoadingConversations,
      activeConversationId,
      selectConversation,
      messagesByConversation,
      loadMessages,
      isLoadingMessages,
      sendMessage,
      createConversation,
      refreshConversations,
      deleteMessage,
    ]
  );

  return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>;
};

export const useMessaging = (): MessagingContextValue => {
  const context = useContext(MessagingContext);
  if (!context) {
    throw new Error('useMessaging must be used within a MessagingProvider');
  }
  return context;
};

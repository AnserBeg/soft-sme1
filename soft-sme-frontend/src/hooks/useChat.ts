import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-toastify';
import {
  chatService,
  AgentChatEvent,
  AgentChatMessage,
  PlannerStreamHandshake,
  AgentChatSessionPreview,
} from '../services/chatService';
import { ChatMessageItem } from '../components/ChatMessage';
import { VoiceCallArtifact } from '../types/voice';

const STORAGE_KEY = 'agent_v2_session_id';
const POLL_INTERVAL_MS = 45000;

const extractVoiceArtifacts = (
  text: string | undefined,
  provided?: VoiceCallArtifact[] | null
): { content?: string; artifacts?: VoiceCallArtifact[] } => {
  if (provided && provided.length) {
    return { content: text, artifacts: provided };
  }

  if (!text) {
    return { content: text, artifacts: undefined };
  }

  const match = text.match(/\{"type":"vendor_call_summary"[\s\S]*\}$/);
  if (!match) {
    return { content: text, artifacts: undefined };
  }

  try {
    const parsed = JSON.parse(match[0]);
    if (parsed && parsed.type === 'vendor_call_summary') {
      const cleaned = text.replace(match[0], '').trim();
      return { content: cleaned, artifacts: [parsed] };
    }
  } catch (error) {
    console.warn('Failed to parse vendor call summary payload', error);
  }

  return { content: text, artifacts: undefined };
};

const normalizeMessage = (message: AgentChatMessage): ChatMessageItem => {
  const { content, artifacts } = extractVoiceArtifacts(
    message.type === 'text' ? message.content : undefined,
    message.callArtifacts
  );

  const derivedContent =
    message.type === 'summary'
      ? message.summary ?? message.content
      : message.type === 'text'
        ? content ?? message.content
        : message.content;

  return {
    id: message.id,
    role: message.role,
    type: message.type || (message.role === 'user' ? 'user_text' : 'text'),
    content: derivedContent,
    summary: message.summary,
    task: message.task,
    link: message.link,
    info: message.info,
    chunks: message.chunks,
    citations: message.citations,
    timestamp: message.timestamp,
    createdAt: message.createdAt,
    callArtifacts: artifacts ?? message.callArtifacts,
  };
};

export const useChat = () => {
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [plannerStream, setPlannerStream] = useState<PlannerStreamHandshake | null>(null);
  const [sessions, setSessions] = useState<AgentChatSessionPreview[]>([]);
  const [isFetchingSessions, setIsFetchingSessions] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? parsed : null;
  });

  const lastAssistantMessageIdRef = useRef<number | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingFetchRef = useRef<Promise<void> | null>(null);

  const loadSessions = useCallback(
    async (options?: { activeId?: number | null; quiet?: boolean }) => {
      const includeId = options?.activeId ?? sessionId ?? null;
      if (!options?.quiet) {
        setIsFetchingSessions(true);
      }
      try {
        const list = await chatService.listSessions(4, includeId ?? undefined);
        setSessions(list);
        if (!sessionId && list.length > 0) {
          const nextId = list[0].id;
          setSessionId(nextId);
          localStorage.setItem(STORAGE_KEY, String(nextId));
        }
      } catch (error) {
        console.error('Failed to load chat sessions', error);
      } finally {
        if (!options?.quiet) {
          setIsFetchingSessions(false);
        }
      }
    },
    [sessionId]
  );

  const ensureSession = useCallback(async (): Promise<number> => {
    if (sessionId) {
      if (!sessions.length) {
        loadSessions({ activeId: sessionId, quiet: true }).catch(() => undefined);
      }
      return sessionId;
    }
    const newSessionId = await chatService.createSession();
    localStorage.setItem(STORAGE_KEY, String(newSessionId));
    setSessionId(newSessionId);
    await loadSessions({ activeId: newSessionId, quiet: true });
    return newSessionId;
  }, [sessionId, sessions.length, loadSessions]);

  const applyUnreadTracking = useCallback(
    (nextMessages: ChatMessageItem[]) => {
      const assistantMessages = nextMessages.filter((msg) => msg.role === 'assistant');
      const latestAssistantId = assistantMessages.reduce<number | null>((acc, msg) => {
        const numericId = typeof msg.id === 'number' ? msg.id : Number(msg.id);
        if (!Number.isFinite(numericId)) {
          return acc;
        }
        if (acc == null || numericId > acc) {
          return numericId;
        }
        return acc;
      }, null);

      const previous = lastAssistantMessageIdRef.current;
      if (latestAssistantId != null) {
        if (previous != null && latestAssistantId > previous && !isOpen) {
          const newMessages = assistantMessages.filter((msg) => {
            const numericId = typeof msg.id === 'number' ? msg.id : Number(msg.id);
            return Number.isFinite(numericId) && numericId > previous;
          });
          if (newMessages.length > 0) {
            setUnreadCount((count) => count + newMessages.length);
            const label =
              newMessages.length === 1
                ? 'Workspace Copilot posted an update'
                : `Workspace Copilot posted ${newMessages.length} updates`;
            toast.info(label, { toastId: 'chat-unread' });
          }
        }
        lastAssistantMessageIdRef.current = latestAssistantId;
      }

      if (isOpen) {
        setUnreadCount(0);
      }
    },
    [isOpen]
  );

  const fetchMessages = useCallback(
    async (opts?: { showSpinner?: boolean; sessionId?: number; skipUnreadTracking?: boolean }) => {
      if (pendingFetchRef.current) {
        return pendingFetchRef.current;
      }
      const run = (async () => {
        const id = opts?.sessionId ?? (await ensureSession());
        if (opts?.showSpinner) {
          setIsLoading(true);
        }
        try {
          const serverMessages = await chatService.fetchMessages(id);
          const normalized = serverMessages.map(normalizeMessage);
          setMessages(normalized);
          if (!opts?.skipUnreadTracking) {
            applyUnreadTracking(normalized);
          }
        } catch (error) {
          console.error('Failed to load chat history', error);
          if (!opts?.showSpinner) {
            toast.error('Unable to load chat messages.');
          }
        } finally {
          if (opts?.showSpinner) {
            setIsLoading(false);
          }
          pendingFetchRef.current = null;
        }
      })();
      pendingFetchRef.current = run;
      return run;
    },
    [applyUnreadTracking, ensureSession]
  );

  useEffect(() => {
    ensureSession().catch((error) => {
      console.error('Failed to initialize agent session', error);
      toast.error('Unable to start AI assistant session.');
    });
  }, [ensureSession]);

  useEffect(() => {
    loadSessions({ activeId: sessionId ?? undefined, quiet: true }).catch((error) => {
      console.error('Failed to initialize chat sessions', error);
    });
  }, [loadSessions, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    fetchMessages({ showSpinner: true }).catch((error) => {
      console.error('Failed to load chat history', error);
    });
  }, [fetchMessages, sessionId]);

  useEffect(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    const startPolling = async () => {
      try {
        await ensureSession();
      } catch (error) {
        console.error('Failed to ensure chat session', error);
        return;
      }
      pollTimerRef.current = setInterval(() => {
        fetchMessages().catch((error) => {
          console.error('Failed to poll chat messages', error);
        });
      }, POLL_INTERVAL_MS);
    };
    startPolling();
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [ensureSession, fetchMessages]);

  const addEventMessages = useCallback(
    (events: AgentChatEvent[]) => {
      if (!events || events.length === 0) {
        return;
      }
      setMessages((current) => {
        const appended = [
          ...current,
          ...events.map((event, index) => {
            const baseContent = event.type === 'text' ? event.content : undefined;
            const { content, artifacts } = extractVoiceArtifacts(baseContent, event.callArtifacts);
            return {
              id: `${Date.now()}-${index}`,
              role: 'assistant' as const,
              type: event.type,
              content: event.type === 'text' ? content ?? event.content : event.content,
              summary: event.summary,
              task: event.task,
              link: event.link,
              info: event.info,
              chunks: event.chunks,
              citations: event.citations,
              timestamp: event.timestamp ?? new Date().toISOString(),
              callArtifacts: artifacts ?? event.callArtifacts,
            } as ChatMessageItem;
          }),
        ];
        applyUnreadTracking(appended);
        return appended;
      });
    },
    [applyUnreadTracking]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      const id = await ensureSession();

      const userMessage: ChatMessageItem = {
        id: `${Date.now()}-user`,
        role: 'user',
        type: 'user_text',
        content: trimmed,
        timestamp: new Date().toISOString(),
      };

      setMessages((current) => [...current, userMessage]);
      setIsLoading(true);

      try {
        const { events, plan } = await chatService.sendMessage(id, trimmed);
        addEventMessages(events);
        setPlannerStream(plan ?? null);
        await fetchMessages();
        void loadSessions({ activeId: id, quiet: true });
      } catch (error) {
        console.error('Error sending message:', error);
        toast.error('Sorry, the Workspace Copilot encountered an error.');
      } finally {
        setIsLoading(false);
      }
    },
    [addEventMessages, ensureSession, fetchMessages, loadSessions]
  );

  const clearPlannerStream = useCallback(() => {
    setPlannerStream(null);
  }, []);

  const startNewChat = useCallback(async () => {
    try {
      setIsLoading(true);
      const newId = await chatService.createSession();
      localStorage.setItem(STORAGE_KEY, String(newId));
      setSessionId(newId);
      setMessages([]);
      setUnreadCount(0);
      setPlannerStream(null);
      lastAssistantMessageIdRef.current = null;
      await loadSessions({ activeId: newId });
      return newId;
    } catch (error) {
      console.error('Failed to start new chat session', error);
      toast.error('Unable to create a new chat right now.');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [loadSessions]);

  const selectSession = useCallback(
    async (id: number) => {
      if (sessionId === id) {
        return;
      }
      localStorage.setItem(STORAGE_KEY, String(id));
      setSessionId(id);
      setMessages([]);
      setPlannerStream(null);
      lastAssistantMessageIdRef.current = null;
      await loadSessions({ activeId: id, quiet: true });
    },
    [loadSessions, sessionId]
  );

  const toggleChat = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next) {
        setUnreadCount(0);
        fetchMessages().catch(() => undefined);
      }
      return next;
    });
  }, [fetchMessages]);

  const closeChat = useCallback(() => {
    setIsOpen(false);
  }, []);

  const openChat = useCallback(async () => {
    setIsOpen(true);
    setUnreadCount(0);
    await fetchMessages();
  }, [fetchMessages]);

  const acknowledgeMessages = useCallback(() => {
    setUnreadCount(0);
  }, []);

  return {
    messages,
    isLoading,
    isOpen,
    unreadCount,
    sendMessage,
    toggleChat,
    closeChat,
    openChat,
    acknowledgeMessages,
    plannerStream,
    clearPlannerStream,
    sessions,
    isFetchingSessions,
    selectSession,
    startNewChat,
    sessionId,
  };
};

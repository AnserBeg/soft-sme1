import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Paper,
  Box,
  Typography,
  Divider,
  TextField,
  Button,
  IconButton,
  CircularProgress,
  Tooltip,
  Badge,
  Chip,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import RefreshIcon from '@mui/icons-material/Refresh';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { toast } from 'react-toastify';
import { taskChatService } from '../services/taskChatService';
import { TaskMessage, TaskMessagesResponse, TaskParticipantSummary } from '../types/tasks';
import { useAuth } from '../contexts/AuthContext';

dayjs.extend(relativeTime);

interface TaskChatProps {
  taskId: number;
  pollIntervalMs?: number;
  onUnreadChange?: (count: number) => void;
}

interface MergeResult {
  merged: TaskMessage[];
  appended: TaskMessage[];
}

const sortMessages = (messages: TaskMessage[]): TaskMessage[] =>
  [...messages].sort((a, b) => {
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    if (aTime === bTime) {
      return a.id - b.id;
    }
    return aTime - bTime;
  });

const mergeMessages = (existing: TaskMessage[], incoming: TaskMessage[]): MergeResult => {
  if (!incoming.length) {
    return { merged: existing, appended: [] };
  }
  const map = new Map<number, TaskMessage>();
  existing.forEach((msg) => map.set(msg.id, msg));
  const appended: TaskMessage[] = [];
  incoming.forEach((msg) => {
    if (!map.has(msg.id)) {
      appended.push(msg);
    }
    map.set(msg.id, msg);
  });
  const merged = sortMessages(Array.from(map.values()));
  return { merged, appended };
};

const TaskChat: React.FC<TaskChatProps> = ({ taskId, pollIntervalMs = 15000, onUnreadChange }) => {
  const { user } = useAuth();
  const currentUserId = useMemo(() => {
    if (!user?.id) return null;
    const parsed = Number(user.id);
    return Number.isFinite(parsed) ? parsed : null;
  }, [user?.id]);

  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [participant, setParticipant] = useState<TaskParticipantSummary | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [draft, setDraft] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadRef = useRef(true);
  const lastMessageIdRef = useRef<number | null>(null);

  const notifyUnreadChange = useCallback(
    (count: number) => {
      setUnreadCount(count);
      onUnreadChange?.(count);
    },
    [onUnreadChange]
  );

  const scrollToBottom = useCallback((smooth = false) => {
    const container = chatBodyRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);

  const shouldAutoScroll = useCallback(() => {
    const container = chatBodyRef.current;
    if (!container) return true;
    const threshold = 120;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom <= threshold;
  }, []);

  const markMessagesAsRead = useCallback(
    async (lastMessageId?: number | null) => {
      try {
        const response = await taskChatService.markMessagesRead(taskId, lastMessageId ?? undefined);
        setParticipant(response.participant);
        notifyUnreadChange(response.unreadCount);
      } catch (err) {
        console.warn('Failed to update read state for task chat', err);
      }
    },
    [notifyUnreadChange, taskId]
  );

  const handleNewMessagesToast = useCallback(
    (messages: TaskMessage[]) => {
      if (!messages.length || initialLoadRef.current) {
        return;
      }
      messages
        .filter((msg) => msg.sender?.userId && currentUserId && msg.sender.userId !== currentUserId)
        .forEach((msg) => {
          const author = msg.sender?.name || 'Task teammate';
          toast.info(`New message from ${author}`);
        });
    },
    [currentUserId]
  );

  const applyMessages = useCallback(
    (incoming: TaskMessage[], replace = false) => {
      const autoScroll = shouldAutoScroll();
      let appended: TaskMessage[] = [];
      let latestId: number | null = lastMessageIdRef.current;

      setMessages((current) => {
        if (replace) {
          const sorted = sortMessages(incoming);
          appended = sorted;
          latestId = sorted.length ? sorted[sorted.length - 1].id : null;
          return sorted;
        }
        const { merged, appended: newMessages } = mergeMessages(current, incoming);
        appended = newMessages;
        latestId = merged.length ? merged[merged.length - 1].id : latestId;
        return merged;
      });

      if (latestId != null && (lastMessageIdRef.current == null || latestId > lastMessageIdRef.current)) {
        lastMessageIdRef.current = latestId;
      }

      if (appended.length) {
        handleNewMessagesToast(appended);
        if (autoScroll) {
          setTimeout(() => scrollToBottom(true), 50);
        }
      } else if (autoScroll && replace) {
        setTimeout(() => scrollToBottom(true), 50);
      }

      return { appended, latestId };
    },
    [handleNewMessagesToast, scrollToBottom, shouldAutoScroll]
  );

  const fetchMessages = useCallback(
    async (options?: { initial?: boolean; forceFull?: boolean }) => {
      try {
        if (options?.initial) {
          setLoading(true);
        } else {
          setError(null);
        }

        const after = options?.forceFull ? undefined : lastMessageIdRef.current ?? undefined;
        const response: TaskMessagesResponse = await taskChatService.fetchMessages(taskId, after);
        setParticipant(response.participant);
        setLastSyncedAt(response.lastSyncedAt);

        const { appended, latestId } = applyMessages(response.messages, !!options?.initial || options?.forceFull);
        notifyUnreadChange(response.unreadCount);

        if ((response.unreadCount > 0 || appended.length > 0) && latestId != null) {
          await markMessagesAsRead(latestId);
        }

        if (options?.initial) {
          initialLoadRef.current = false;
        }
      } catch (err: any) {
        console.error('Failed to load task messages', err);
        const message = err?.response?.data?.message || 'Unable to load task messages.';
        setError(message);
        if (options?.initial) {
          toast.error(message);
        }
      } finally {
        if (options?.initial) {
          setLoading(false);
        }
      }
    },
    [applyMessages, markMessagesAsRead, notifyUnreadChange, taskId]
  );

  useEffect(() => {
    initialLoadRef.current = true;
    lastMessageIdRef.current = null;
    setMessages([]);
    setParticipant(null);
    notifyUnreadChange(0);
    fetchMessages({ initial: true, forceFull: true }).catch(() => undefined);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [fetchMessages, notifyUnreadChange, taskId]);

  useEffect(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
    }

    if (pollIntervalMs <= 0) {
      return;
    }

    pollTimerRef.current = setInterval(() => {
      fetchMessages({ forceFull: false }).catch(() => undefined);
    }, pollIntervalMs);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [fetchMessages, pollIntervalMs]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!draft.trim()) {
        return;
      }
      try {
        setPosting(true);
        const response = await taskChatService.postMessage(taskId, { content: draft.trim() });
        setParticipant(response.participant);
        notifyUnreadChange(response.unreadCount);
        applyMessages([response.message]);
        lastMessageIdRef.current = response.message.id;
        setDraft('');
        setTimeout(() => scrollToBottom(true), 50);
      } catch (err: any) {
        console.error('Failed to send message', err);
        toast.error(err?.response?.data?.message || 'Failed to send message');
      } finally {
        setPosting(false);
      }
    },
    [applyMessages, draft, notifyUnreadChange, scrollToBottom, taskId]
  );

  const handleManualRefresh = useCallback(async () => {
    try {
      setRefreshing(true);
      await fetchMessages({ forceFull: true });
    } finally {
      setRefreshing(false);
    }
  }, [fetchMessages]);

  const lastSyncLabel = useMemo(() => {
    if (!lastSyncedAt) {
      return 'Not synced yet';
    }
    return `Updated ${dayjs(lastSyncedAt).fromNow()}`;
  }, [lastSyncedAt]);

  const renderMessage = (message: TaskMessage) => {
    const isAgentMessage = Boolean((message.metadata && message.metadata.agent) || message.isSystem);
    const isOwn = !isAgentMessage && currentUserId != null && message.sender?.userId === currentUserId;
    const author = isAgentMessage ? 'System' : isOwn ? 'You' : message.sender?.name || 'Team member';
    const timestamp = dayjs(message.createdAt).format('MMM D, YYYY h:mm A');

    return (
      <Box
        key={message.id}
        display="flex"
        flexDirection="column"
        alignItems={isOwn ? 'flex-end' : 'flex-start'}
        mb={2}
      >
        <Box
          sx={{
            maxWidth: '80%',
            bgcolor: isAgentMessage ? 'rgba(25, 118, 210, 0.08)' : isOwn ? 'primary.main' : 'grey.100',
            color: isAgentMessage ? 'text.primary' : isOwn ? 'primary.contrastText' : 'text.primary',
            px: 2,
            py: 1,
            borderRadius: 2,
            boxShadow: 1,
            border: isAgentMessage ? '1px solid' : undefined,
            borderColor: isAgentMessage ? 'info.light' : undefined,
          }}
        >
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {message.content}
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
          {author} · {timestamp}
        </Typography>
      </Box>
    );
  };

  return (
    <Paper elevation={2} sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" px={2} py={1.5}>
        <Box display="flex" alignItems="center" gap={1}>
          <Typography variant="h6">Task chat</Typography>
          <Badge color="secondary" badgeContent={unreadCount} invisible={unreadCount === 0}>
            <Chip label="Unread" size="small" variant={unreadCount ? 'filled' : 'outlined'} />
          </Badge>
        </Box>
        <Box display="flex" alignItems="center" gap={1}>
          {lastSyncedAt && <Typography variant="caption" color="text.secondary">{lastSyncLabel}</Typography>}
          <Tooltip title="Refresh conversation">
            <span>
              <IconButton onClick={handleManualRefresh} disabled={refreshing || loading} size="small">
                {refreshing ? <CircularProgress size={18} /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>
      <Divider />
      <Box ref={chatBodyRef} flex={1} overflow="auto" px={2} py={2}>
        {loading ? (
          <Box display="flex" alignItems="center" justifyContent="center" height="100%">
            <CircularProgress size={32} />
          </Box>
        ) : error ? (
          <Typography color="error" variant="body2">
            {error}
          </Typography>
        ) : messages.length === 0 ? (
          <Box textAlign="center" color="text.secondary">
            <Typography variant="body2">No messages yet. Start the conversation below.</Typography>
          </Box>
        ) : (
          messages.map((message) => renderMessage(message))
        )}
      </Box>
      <Divider />
      <Box component="form" onSubmit={handleSubmit} display="flex" gap={1} px={2} py={1.5}>
        <TextField
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a message"
          fullWidth
          minRows={2}
          maxRows={4}
          multiline
          disabled={posting}
        />
        <Button
          type="submit"
          variant="contained"
          endIcon={posting ? <CircularProgress color="inherit" size={18} /> : <SendIcon />}
          disabled={posting || draft.trim().length === 0}
        >
          Send
        </Button>
      </Box>
    </Paper>
  );
};

export default TaskChat;

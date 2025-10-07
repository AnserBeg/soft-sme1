import React, { useEffect, useMemo, useRef } from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { format } from 'date-fns';
import ChatInput from './ChatInput';
import { ConversationSummary } from '../contexts/MessagingContext';
import { MessagingMessage } from '../services/messagingService';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';

interface MessageThreadProps {
  conversation?: ConversationSummary;
  messages: MessagingMessage[];
  currentUserId: number | null;
  isLoading: boolean;
  isSending: boolean;
  onSendMessage: (message: string) => Promise<void> | void;
  onDeleteMessage: (messageId: number) => Promise<void> | void;
}

const formatTimestamp = (timestamp: string): string => {
  try {
    return format(new Date(timestamp), 'MMM d, yyyy h:mm a');
  } catch (error) {
    return timestamp;
  }
};

const MessageThread: React.FC<MessageThreadProps> = ({
  conversation,
  messages,
  currentUserId,
  isLoading,
  isSending,
  onSendMessage,
  onDeleteMessage,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages.length, isLoading]);

  const participantSummary = useMemo(() => {
    if (!conversation) {
      return '';
    }
    return conversation.otherParticipants.length > 0
      ? conversation.otherParticipants.map((participant) => participant.username || participant.email || 'Unknown user').join(', ')
      : conversation.participantNames;
  }, [conversation]);

  if (!conversation) {
    return (
      <Paper sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Typography variant="body1" color="text.secondary" align="center">
          Select a conversation to view messages or start a new chat.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" component="h2">
          {conversation.displayName}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {participantSummary}
        </Typography>
      </Box>

      <Divider />

      <Box ref={scrollRef} sx={{ flexGrow: 1, overflowY: 'auto', p: 2 }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <CircularProgress size={36} />
          </Box>
        ) : messages.length === 0 ? (
          <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: 6 }}>
            <Typography variant="body2">No messages yet. Start the conversation below.</Typography>
          </Box>
        ) : (
          <Stack spacing={2}>
            {messages.map((message) => {
              const isSelf = currentUserId !== null && message.senderId === currentUserId;
              const isDeleted = Boolean(message.isDeletedForUser);
              const align = isSelf ? 'flex-end' : 'flex-start';
              const backgroundColor = message.error
                ? 'error.light'
                : isDeleted
                  ? 'grey.300'
                  : isSelf
                    ? 'primary.main'
                    : 'grey.100';
              const textColor = message.error
                ? 'error.dark'
                : isDeleted
                  ? 'text.secondary'
                  : isSelf
                    ? 'common.white'
                    : 'text.primary';
              const canDelete =
                !isDeleted &&
                !message.error &&
                !message.pending &&
                typeof message.id === 'number';
              const displayContent = isDeleted
                ? isSelf
                  ? 'You deleted this message'
                  : 'Message deleted'
                : message.content;

              return (
                <Box key={message.id} sx={{ display: 'flex', justifyContent: align }}>
                  <Box sx={{ maxWidth: '75%', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Paper
                      elevation={isSelf ? 3 : 1}
                      sx={{
                        p: 1.5,
                        bgcolor: backgroundColor,
                        color: textColor,
                        borderRadius: 2,
                        border: message.error ? '1px solid' : 'none',
                        borderColor: message.error ? 'error.main' : undefined,
                        position: 'relative',
                      }}
                    >
                      <Stack spacing={0.5}>
                        <Typography variant="caption" sx={{ opacity: isSelf ? 0.85 : 0.6 }}>
                          {message.senderName || (isSelf ? 'You' : 'Unknown user')}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ whiteSpace: 'pre-wrap', fontStyle: isDeleted ? 'italic' : 'normal' }}
                        >
                          {displayContent}
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: isSelf ? 0.85 : 0.6, textAlign: 'right' }}>
                          {formatTimestamp(message.createdAt)}
                        </Typography>
                      </Stack>
                      {canDelete && (
                        <Tooltip title="Delete for me">
                          <IconButton
                            size="small"
                            onClick={() => onDeleteMessage(Number(message.id))}
                            sx={{
                              position: 'absolute',
                              top: 4,
                              right: 4,
                              color: isSelf ? 'common.white' : 'text.secondary',
                              bgcolor: isSelf ? 'rgba(255,255,255,0.1)' : 'transparent',
                              '&:hover': {
                                bgcolor: isSelf ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.04)',
                              },
                            }}
                          >
                            <DeleteOutlineOutlinedIcon fontSize="inherit" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Paper>
                    {message.pending && !message.error && (
                      <Chip
                        label="Sending..."
                        size="small"
                        color="default"
                        sx={{ alignSelf: isSelf ? 'flex-end' : 'flex-start', mt: 0.5 }}
                      />
                    )}
                    {message.error && (
                      <Typography
                        variant="caption"
                        color="error"
                        sx={{ alignSelf: isSelf ? 'flex-end' : 'flex-start' }}
                      >
                        Failed to send. Please try again.
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>

      <Divider />

      <ChatInput onSendMessage={(value) => onSendMessage(value)} disabled={isSending} />
    </Paper>
  );
};

export default MessageThread;

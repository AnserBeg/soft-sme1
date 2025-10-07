import React, { useMemo, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Divider,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { formatDistanceToNowStrict } from 'date-fns';
import { ConversationSummary } from '../contexts/MessagingContext';

interface ConversationListProps {
  conversations: ConversationSummary[];
  activeConversationId: number | null;
  onSelect: (conversationId: number) => void;
  onStartConversation: () => void;
  isLoading?: boolean;
  unreadConversationIds?: number[];
}

const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  activeConversationId,
  onSelect,
  onStartConversation,
  isLoading = false,
  unreadConversationIds,
}) => {
  const [query, setQuery] = useState('');

  const unreadIds = useMemo(() => new Set(unreadConversationIds ?? []), [unreadConversationIds]);

  const filteredConversations = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return conversations;
    }
    return conversations.filter((conversation) => {
      const name = conversation.displayName.toLowerCase();
      const participants = conversation.participantNames.toLowerCase();
      return name.includes(trimmed) || participants.includes(trimmed);
    });
  }, [conversations, query]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="h6" component="h2">
          Conversations
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={onStartConversation}
          size="small"
        >
          New
        </Button>
      </Stack>

      <TextField
        fullWidth
        size="small"
        placeholder="Search conversations"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        sx={{ mb: 2 }}
      />

      <Divider />

      <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', py: 4 }}>
            <CircularProgress size={32} />
          </Box>
        ) : filteredConversations.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {query ? 'No conversations match your search.' : 'Start a new conversation to begin messaging.'}
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {filteredConversations.map((conversation) => {
              const lastMessage = conversation.lastMessage?.content;
              const lastTimestamp = conversation.lastMessageAt || conversation.updatedAt || conversation.createdAt;
              const timeAgo = formatDistanceToNowStrict(new Date(lastTimestamp), { addSuffix: true });
              const isUnread = unreadIds.has(conversation.id);

              return (
                <React.Fragment key={conversation.id}>
                  <ListItemButton
                    selected={conversation.id === activeConversationId}
                    alignItems="flex-start"
                    onClick={() => onSelect(conversation.id)}
                    sx={{
                      py: 1.5,
                      '&.Mui-selected': {
                        backgroundColor: 'action.selected',
                      },
                      bgcolor: isUnread ? 'action.hover' : undefined,
                      '& .MuiListItemText-secondary': {
                        display: '-webkit-box',
                        overflow: 'hidden',
                        WebkitBoxOrient: 'vertical',
                        WebkitLineClamp: 2,
                      },
                    }}
                  >
                    <ListItemAvatar>
                      <Avatar>
                        {conversation.displayName.charAt(0).toUpperCase()}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={
                        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                          <Typography variant="subtitle1" noWrap sx={{ fontWeight: isUnread ? 600 : 500 }}>
                            {conversation.displayName}
                          </Typography>
                          <Stack direction="row" alignItems="center" spacing={1.25} sx={{ flexShrink: 0 }}>
                            {isUnread && (
                              <Box
                                component="span"
                                sx={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: '50%',
                                  bgcolor: 'primary.main',
                                }}
                              />
                            )}
                            <Typography variant="caption" color="text.secondary">
                              {timeAgo}
                            </Typography>
                          </Stack>
                        </Stack>
                      }
                      secondaryTypographyProps={{ fontWeight: isUnread ? 600 : undefined }}
                      secondary={lastMessage || 'No messages yet'}
                    />
                  </ListItemButton>
                  <Divider component="li" />
                </React.Fragment>
              );
            })}
          </List>
        )}
      </Box>
    </Box>
  );
};

export default ConversationList;

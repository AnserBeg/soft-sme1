import React from 'react';
import { Box, Typography, Paper, Avatar, Stack } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Person as PersonIcon, SmartToy as AIIcon } from '@mui/icons-material';

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

interface ChatMessageProps {
  message: ChatMessage;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.sender === 'user';

  const timestamp = message.timestamp.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Stack
      direction="row"
      justifyContent={isUser ? 'flex-end' : 'flex-start'}
      sx={{ width: '100%' }}
      spacing={1.5}
    >
      {!isUser && (
        <Avatar
          sx={{
            bgcolor: 'primary.main',
            width: 34,
            height: 34,
            boxShadow: '0 10px 20px rgba(64, 132, 253, 0.25)',
          }}
        >
          <AIIcon fontSize="small" />
        </Avatar>
      )}

      <Paper
        elevation={0}
        sx={{
          px: { xs: 2.25, sm: 2.75 },
          py: { xs: 1.5, sm: 1.75 },
          maxWidth: { xs: '82%', sm: '72%' },
          borderRadius: 3,
          borderTopRightRadius: isUser ? 4 : 3,
          borderTopLeftRadius: isUser ? 3 : 4,
          background: (theme) =>
            isUser
              ? `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.95)} 0%, ${theme.palette.primary.main} 100%)`
              : 'rgba(255, 255, 255, 0.92)',
          color: isUser ? 'common.white' : 'text.primary',
          border: isUser
            ? 'none'
            : '1px solid rgba(148, 163, 184, 0.25)',
          boxShadow: isUser
            ? '0 18px 32px -24px rgba(64, 132, 253, 0.65)'
            : '0 12px 28px -22px rgba(15, 23, 42, 0.35)',
          backdropFilter: isUser ? undefined : 'blur(18px)',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 1,
            gap: 1.5,
          }}
        >
          <Typography
            variant="overline"
            sx={{
              fontWeight: 700,
              letterSpacing: 1,
              color: isUser ? alpha('#ffffff', 0.8) : 'text.secondary',
            }}
          >
            {isUser ? 'You' : 'Aiven AI'}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: isUser ? alpha('#ffffff', 0.75) : 'text.disabled',
              whiteSpace: 'nowrap',
            }}
          >
            {timestamp}
          </Typography>
        </Box>

        <Typography
          variant="body2"
          sx={{
            whiteSpace: 'pre-wrap',
            lineHeight: 1.7,
          }}
        >
          {message.text}
        </Typography>
      </Paper>

      {isUser && (
        <Avatar
          sx={{
            bgcolor: 'secondary.main',
            width: 34,
            height: 34,
            boxShadow: '0 10px 20px rgba(244, 63, 94, 0.25)',
          }}
        >
          <PersonIcon fontSize="small" />
        </Avatar>
      )}
    </Stack>
  );
};

export default ChatMessage; 

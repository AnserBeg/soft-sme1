import React from 'react';
import { Box, Typography, Paper, Avatar } from '@mui/material';
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
    <Box
      sx={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        mb: 0.5,
        pr: isUser ? 0 : 4,
        pl: isUser ? 4 : 0,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-end',
          flexDirection: isUser ? 'row-reverse' : 'row',
          gap: 1.5,
          maxWidth: '100%',
        }}
      >
        <Avatar
          sx={{
            bgcolor: isUser ? 'secondary.main' : 'primary.main',
            width: 36,
            height: 36,
            boxShadow: 2,
          }}
        >
          {isUser ? <PersonIcon fontSize="small" /> : <AIIcon fontSize="small" />}
        </Avatar>

        <Paper
          elevation={0}
          sx={{
            position: 'relative',
            px: 2.5,
            py: 1.75,
            maxWidth: { xs: '78%', sm: '70%' },
            bgcolor: isUser
              ? 'primary.main'
              : (theme) => alpha(theme.palette.primary.main, 0.08),
            color: isUser ? 'common.white' : 'text.primary',
            borderRadius: '24px',
            borderBottomRightRadius: isUser ? '12px' : '24px',
            borderBottomLeftRadius: isUser ? '24px' : '12px',
            boxShadow: (theme) =>
              `0 12px 25px -18px ${alpha(theme.palette.primary.main, 0.6)}`,
            backdropFilter: 'blur(6px)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                opacity: isUser ? 0.9 : 0.7,
              }}
            >
              {isUser ? 'You' : 'Soft SME AI'}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                opacity: isUser ? 0.75 : 0.6,
              }}
            >
              {timestamp}
            </Typography>
          </Box>

          <Typography
            variant="body2"
            sx={{
              whiteSpace: 'pre-wrap',
              lineHeight: 1.6,
            }}
          >
            {message.text}
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
};

export default ChatMessage; 
import React from 'react';
import { Fab, Badge } from '@mui/material';
import { Chat as ChatIcon } from '@mui/icons-material';

interface ChatBubbleProps {
  onClick: () => void;
  isOpen: boolean;
  unreadCount?: number;
}

const ChatBubble: React.FC<ChatBubbleProps> = ({ onClick, isOpen, unreadCount = 0 }) => {
  return (
    <Fab
      aria-label="Workspace Copilot"
      onClick={onClick}
      sx={{
        position: 'fixed',
        bottom: { xs: 16, sm: 24 },
        right: { xs: 16, sm: 24 },
        zIndex: 1300,
        bgcolor: (theme) => theme.palette.background.paper,
        color: (theme) => theme.palette.primary.main,
        boxShadow: '0 18px 40px rgba(33, 150, 243, 0.25)',
        border: '1px solid',
        borderColor: (theme) => theme.palette.divider,
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        '&:hover': {
          transform: 'translateY(-3px)',
          boxShadow: '0 22px 48px rgba(33, 150, 243, 0.32)',
          bgcolor: (theme) => theme.palette.primary.main,
          color: 'common.white',
        },
      }}
    >
      <Badge
        color="error"
        badgeContent={unreadCount}
        invisible={unreadCount === 0}
        sx={{ '& .MuiBadge-badge': { fontWeight: 600 } }}
      >
        <ChatIcon />
      </Badge>
    </Fab>
  );
};

export default ChatBubble; 
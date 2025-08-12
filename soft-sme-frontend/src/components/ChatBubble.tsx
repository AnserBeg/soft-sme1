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
      color="primary"
      aria-label="chat"
      onClick={onClick}
      sx={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 1000,
        boxShadow: 3,
        '&:hover': {
          transform: 'scale(1.1)',
          transition: 'transform 0.2s ease-in-out',
        },
      }}
    >
      <Badge badgeContent={unreadCount} color="error">
        <ChatIcon />
      </Badge>
    </Fab>
  );
};

export default ChatBubble; 
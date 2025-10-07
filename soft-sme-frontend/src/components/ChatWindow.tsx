import React, { useRef, useEffect } from 'react';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Button,
  Divider,
  CircularProgress,
  Chip,
  Avatar,
  Tooltip,
} from '@mui/material';
import {
  Close as CloseIcon,
  SmartToy as SmartToyIcon,
  KeyboardDoubleArrowDown as KeyboardDoubleArrowDownIcon,
} from '@mui/icons-material';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import { useChat } from '../hooks/useChat';

interface ChatWindowProps {
  isOpen: boolean;
  onClose: () => void;
}

const ChatWindow: React.FC<ChatWindowProps> = ({ isOpen, onClose }) => {
  const { messages, isLoading, sendMessage, clearMessages } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleClearMessages = () => {
    if (window.confirm('Are you sure you want to clear all messages?')) {
      clearMessages();
    }
  };

  const handleScrollToLatest = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <Drawer
      anchor="right"
      open={isOpen}
      onClose={onClose}
      sx={{
        '& .MuiDrawer-paper': {
          width: { xs: '100%', sm: 420, md: 480 },
          maxWidth: '100vw',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.default',
          backgroundImage:
            'linear-gradient(180deg, rgba(245, 247, 250, 0.95) 0%, rgba(255, 255, 255, 0.95) 40%, rgba(245, 247, 250, 0.9) 100%)',
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 3,
          py: 2,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          bgcolor: 'transparent',
          position: 'relative',
          '&::after': {
            content: "''",
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(135deg, rgba(33, 150, 243, 0.12) 0%, rgba(3, 169, 244, 0.08) 55%, rgba(129, 199, 132, 0.12) 100%)',
            zIndex: -1,
            borderBottom: '1px solid',
            borderColor: 'divider',
          },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar
            sx={{
              bgcolor: 'primary.main',
              width: 48,
              height: 48,
              boxShadow: 3,
            }}
          >
            <SmartToyIcon />
          </Avatar>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              AI Assistant
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                size="small"
                label="Online"
                color="success"
                sx={{ fontWeight: 600, px: 0.5 }}
              />
              <Typography variant="caption" color="text.secondary">
                Ask anything about your workspace
              </Typography>
            </Box>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title="Jump to latest message">
            <IconButton
              color="primary"
              size="small"
              onClick={handleScrollToLatest}
              sx={{
                bgcolor: 'white',
                border: 1,
                borderColor: 'divider',
                '&:hover': {
                  bgcolor: 'grey.50',
                },
              }}
            >
              <KeyboardDoubleArrowDownIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Clear conversation">
            <Button
              variant="outlined"
              size="small"
              onClick={handleClearMessages}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                px: 1.5,
                borderRadius: 2,
              }}
            >
              Clear Chat
            </Button>
          </Tooltip>
          <IconButton
            color="default"
            onClick={onClose}
            size="small"
            sx={{
              bgcolor: 'white',
              border: 1,
              borderColor: 'divider',
              '&:hover': {
                bgcolor: 'grey.50',
              },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      {/* Messages Area */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          px: { xs: 2, sm: 3 },
          py: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          backgroundImage:
            'radial-gradient(circle at top, rgba(33, 150, 243, 0.08), transparent 55%)',
        }}
      >
        {messages.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              textAlign: 'center',
              color: 'text.secondary',
            }}
          >
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
              Welcome to your AI workspace
            </Typography>
            <Typography variant="body2" sx={{ maxWidth: 320 }}>
              Ask about inventory, customers, orders, time tracking, or anything else
              you need. I will keep the conversation tidy and actionable.
            </Typography>
          </Box>
        ) : (
          <>
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            
            {/* Loading indicator */}
            {isLoading && (
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'flex-start',
                  mb: 2,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 2,
                    py: 1.25,
                    bgcolor: 'background.paper',
                    borderRadius: 3,
                    border: 1,
                    borderColor: 'divider',
                    boxShadow: 2,
                  }}
                >
                  <CircularProgress size={16} thickness={5} />
                  <Typography variant="body2" color="text.secondary">
                    AI is drafting a response…
                  </Typography>
                </Box>
              </Box>
            )}
            
            {/* Auto-scroll anchor */}
            <div ref={messagesEndRef} />
          </>
        )}
      </Box>

      <Divider />

      {/* Input Area */}
      <ChatInput
        onSendMessage={sendMessage}
        disabled={isLoading}
        placeholder="Ask me anything about your business..."
      />
    </Drawer>
  );
};

export default ChatWindow; 
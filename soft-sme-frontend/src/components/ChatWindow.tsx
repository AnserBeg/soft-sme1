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
  Paper,
} from '@mui/material';
import {
  Close as CloseIcon,
  SmartToy as SmartToyIcon,
  KeyboardDoubleArrowDown as KeyboardDoubleArrowDownIcon,
} from '@mui/icons-material';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import { useChat } from '../hooks/useChat';
import { SxProps, Theme } from '@mui/material/styles';

interface ChatWindowProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ChatBoardProps {
  variant?: 'drawer' | 'embedded';
  onClose?: () => void;
  sx?: SxProps<Theme>;
}

export const ChatBoard: React.FC<ChatBoardProps> = ({ variant = 'drawer', onClose, sx }) => {
  const { messages, isLoading, sendMessage, clearMessages, acknowledgeMessages } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isEmbedded = variant === 'embedded';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isEmbedded) {
      acknowledgeMessages();
    }
  }, [acknowledgeMessages, isEmbedded, messages.length]);

  const handleClearMessages = () => {
    if (window.confirm('Are you sure you want to clear all messages?')) {
      clearMessages();
    }
  };

  const handleScrollToLatest = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const containerStyles: SxProps<Theme> = {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: isEmbedded ? 4 : 0,
    overflow: 'hidden',
    bgcolor: 'background.paper',
    boxShadow: isEmbedded ? '0 20px 50px -28px rgba(15, 23, 42, 0.32)' : 'none',
    border: isEmbedded ? '1px solid' : 'none',
    borderColor: isEmbedded ? 'divider' : 'transparent',
    minHeight: isEmbedded ? { xs: 360, md: 420 } : 'auto',
    maxHeight: isEmbedded ? { xs: '60vh', md: 520 } : 'none',
  };

  const headerStyles: SxProps<Theme> = {
    px: { xs: 2.5, sm: 3 },
    py: 2.5,
    display: 'flex',
    alignItems: { xs: 'flex-start', sm: 'center' },
    flexDirection: { xs: 'column', sm: 'row' },
    gap: { xs: 2, sm: 3 },
    justifyContent: 'space-between',
    position: 'relative',
    borderBottom: '1px solid',
    borderColor: 'divider',
    backgroundImage: isEmbedded
      ? 'linear-gradient(135deg, rgba(123, 104, 238, 0.12) 0%, rgba(33, 150, 243, 0.08) 50%, rgba(0, 200, 140, 0.12) 100%)'
      : undefined,
    backgroundColor: isEmbedded ? 'rgba(255,255,255,0.85)' : 'transparent',
    '&::after': !isEmbedded
      ? {
          content: "''",
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(135deg, rgba(123, 104, 238, 0.12) 0%, rgba(33, 150, 243, 0.08) 50%, rgba(0, 200, 140, 0.12) 100%)',
          opacity: 0.6,
          zIndex: -1,
        }
      : undefined,
  };

  const messagesWrapperStyles: SxProps<Theme> = {
    flex: 1,
    overflow: 'auto',
    px: { xs: 2.25, sm: 3.25 },
    py: 3,
    display: 'flex',
    flexDirection: 'column',
    gap: 2.5,
    backgroundImage: 'linear-gradient(160deg, rgba(255, 255, 255, 0.9) 0%, rgba(247, 250, 255, 0.85) 100%)',
  };

  const WrapperComponent: React.ElementType = isEmbedded ? Paper : Box;

  return (
    <WrapperComponent sx={{ ...containerStyles, ...sx }}>
      <Box sx={headerStyles}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
          <Avatar
            sx={{
              bgcolor: 'primary.main',
              width: 56,
              height: 56,
              boxShadow: '0 10px 30px rgba(64, 132, 253, 0.35)',
            }}
          >
            <SmartToyIcon fontSize="medium" />
          </Avatar>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: -0.2 }}>
              Workspace Copilot
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
              <Chip size="small" label="Live" color="success" sx={{ fontWeight: 700, px: 0.75, borderRadius: '999px' }} />
              <Typography variant="body2" color="text.secondary">
                Instantly summarise, draft, and explore your data
              </Typography>
            </Box>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Tooltip title="Jump to latest">
            <IconButton
              onClick={handleScrollToLatest}
              size="small"
              sx={{
                bgcolor: 'common.white',
                border: '1px solid',
                borderColor: 'divider',
                boxShadow: '0 8px 18px rgba(15, 23, 42, 0.08)',
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
                px: 1.75,
                borderRadius: '999px',
                borderColor: 'divider',
              }}
            >
              Clear
            </Button>
          </Tooltip>
          {onClose && (
            <Tooltip title="Close">
              <IconButton
                onClick={onClose}
                size="small"
                sx={{
                  bgcolor: 'common.white',
                  border: '1px solid',
                  borderColor: 'divider',
                  '&:hover': {
                    bgcolor: 'grey.50',
                  },
                }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      <Box sx={messagesWrapperStyles}>
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
              gap: 1.5,
              backgroundColor: 'common.white',
              borderRadius: 4,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 18px 45px -24px rgba(15, 23, 42, 0.18)',
              mx: 'auto',
              p: 4,
              maxWidth: 340,
            }}
          >
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Start a fresh conversation
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Ask about inventory, customers, orders, or time tracking. I will keep every reply crisp and actionable.
            </Typography>
          </Box>
        ) : (
          <>
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}

            {isLoading && (
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'flex-start',
                  mb: 1,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 2.25,
                    py: 1.25,
                    bgcolor: 'common.white',
                    borderRadius: 3,
                    border: '1px solid',
                    borderColor: 'divider',
                    boxShadow: '0 14px 36px -28px rgba(15, 23, 42, 0.4)',
                  }}
                >
                  <CircularProgress size={16} thickness={5} />
                  <Typography variant="body2" color="text.secondary">
                    Crafting a response…
                  </Typography>
                </Box>
              </Box>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </Box>

      <Divider />

      <ChatInput
        onSendMessage={sendMessage}
        disabled={isLoading}
        placeholder="Ask me anything about your business..."
      />
    </WrapperComponent>
  );
};

const ChatWindow: React.FC<ChatWindowProps> = ({ isOpen, onClose }) => {
  return (
    <Drawer
      anchor="right"
      open={isOpen}
      onClose={onClose}
      sx={{
        '& .MuiDrawer-paper': {
          width: { xs: '100%', sm: 420, md: 500 },
          maxWidth: '100vw',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderLeft: { sm: '1px solid', xs: 'none' },
          borderColor: 'divider',
          bgcolor: 'transparent',
          backgroundImage:
            'radial-gradient(circle at top left, rgba(64, 132, 253, 0.16), transparent 55%), linear-gradient(180deg, #f7f9fc 0%, #ffffff 35%, #f7f9fc 100%)',
          backdropFilter: 'blur(12px)',
        },
      }}
    >
      <ChatBoard onClose={onClose} />
    </Drawer>
  );
};

export default ChatWindow;

import React, { useRef, useEffect } from 'react';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Button,
  Divider,
  CircularProgress,
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
import PlannerProgressPanel from './PlannerProgressPanel';
import PlannerUpdateList from './planner/PlannerUpdateList';
import usePlannerStream from '../hooks/usePlannerStream';
import { isPlannerStreamingEnabled } from '../utils/featureFlags';

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
  const {
    messages,
    isLoading,
    sendMessage,
    clearMessages,
    acknowledgeMessages,
    plannerStream,
  } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isEmbedded = variant === 'embedded';

  const streamingEnabled = isPlannerStreamingEnabled();

  const streamState = usePlannerStream({
    sessionId: plannerStream?.sessionId,
    planStepId: plannerStream?.planStepId,
    initialCursor: plannerStream?.cursor ?? null,
    expectedSubagents: plannerStream?.expectedSubagents,
    plannerContext: plannerStream?.plannerContext ?? null,
    enabled: streamingEnabled && Boolean(plannerStream?.planStepId),
  });

  const showPlannerPanel = streamingEnabled && Boolean(plannerStream?.planStepId);

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
    borderRadius: isEmbedded ? 3 : 0,
    overflow: 'hidden',
    bgcolor: 'background.paper',
    boxShadow: isEmbedded ? '0 12px 32px rgba(15, 23, 42, 0.16)' : 'none',
    border: '1px solid',
    borderColor: isEmbedded ? 'divider' : 'transparent',
    minHeight: isEmbedded ? { xs: 320, md: 380 } : 'auto',
    maxHeight: isEmbedded ? { xs: '60vh', md: 520 } : 'none',
  };

  const headerStyles: SxProps<Theme> = {
    px: { xs: 2.5, sm: 3 },
    py: 2.25,
    display: 'flex',
    alignItems: { xs: 'flex-start', sm: 'center' },
    flexDirection: { xs: 'column', sm: 'row' },
    gap: { xs: 2, sm: 3 },
    justifyContent: 'space-between',
    borderBottom: '1px solid',
    borderColor: 'divider',
    backgroundColor: (theme) => (isEmbedded ? theme.palette.background.paper : theme.palette.background.default),
  };

  const messagesWrapperStyles: SxProps<Theme> = {
    flex: 1,
    overflow: 'auto',
    px: { xs: 2.25, sm: 3 },
    py: 2.5,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    backgroundColor: (theme) => theme.palette.background.default,
  };

  const WrapperComponent: React.ElementType = isEmbedded ? Paper : Box;

  return (
    <WrapperComponent sx={{ ...containerStyles, ...sx }}>
      <Box sx={headerStyles}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
          <Avatar
            sx={{
              bgcolor: 'primary.main',
              color: 'common.white',
              width: 48,
              height: 48,
              boxShadow: '0 10px 24px rgba(33, 150, 243, 0.28)',
            }}
          >
            <SmartToyIcon fontSize="small" />
          </Avatar>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Workspace Copilot
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Ask about anything in your workspace for instant help.
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Tooltip title="Jump to latest">
            <IconButton
              onClick={handleScrollToLatest}
              size="small"
              sx={{
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: 'divider',
                '&:hover': { bgcolor: 'grey.50' },
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
                borderRadius: 999,
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
                  bgcolor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  '&:hover': { bgcolor: 'grey.50' },
                }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      <Box sx={messagesWrapperStyles}>
        {showPlannerPanel && (
          <PlannerProgressPanel
            subagents={streamState.subagents}
            connectionState={streamState.connectionState}
            stepStatus={streamState.stepStatus}
            plannerContext={streamState.plannerContext}
            completedPayload={streamState.completedPayload}
            replayComplete={streamState.replayComplete}
            lastHeartbeatAt={streamState.lastHeartbeatAt}
            isTerminal={streamState.isTerminal}
          />
        )}
        {showPlannerPanel && (
          <PlannerUpdateList
            sessionId={plannerStream?.sessionId}
            planStepId={plannerStream?.planStepId}
            events={streamState.events}
          />
        )}
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
                borderRadius: 3,
                border: '1px dashed',
                borderColor: 'divider',
                mx: 'auto',
                p: 4,
                maxWidth: 320,
                bgcolor: 'background.paper',
              }}
            >
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Start a fresh conversation
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Ask about inventory, customers, orders, or time tracking.
              </Typography>
            </Box>
        ) : (
          <>
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}

            {isLoading && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                    px: 2,
                    py: 1.25,
                    bgcolor: 'background.paper',
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
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
          width: { xs: '100%', sm: 400, md: 460 },
          maxWidth: '100vw',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderLeft: { sm: '1px solid', xs: 'none' },
          borderColor: 'divider',
          bgcolor: 'background.default',
        },
      }}
    >
      <ChatBoard onClose={onClose} />
    </Drawer>
  );
};

export default ChatWindow;

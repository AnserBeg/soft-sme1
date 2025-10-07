import React, { useState, KeyboardEvent } from 'react';
import { Box, TextField, IconButton, Paper, Tooltip } from '@mui/material';
import { Send as SendIcon } from '@mui/icons-material';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const ChatInput: React.FC<ChatInputProps> = ({ 
  onSendMessage, 
  disabled = false, 
  placeholder = "Type your message..." 
}) => {
  const [message, setMessage] = useState('');

  const handleSend = () => {
    if (message.trim() && !disabled) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  const handleKeyPress = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <Paper
      elevation={0}
      sx={{
        px: { xs: 2, sm: 3 },
        py: 2.5,
        borderTop: '1px solid',
        borderColor: 'divider',
        bgcolor: 'transparent',
        backdropFilter: 'blur(6px)',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'stretch', sm: 'center' },
          gap: 1.5,
          bgcolor: 'rgba(255, 255, 255, 0.92)',
          borderRadius: 3,
          px: { xs: 1.5, sm: 2.5 },
          py: { xs: 1.25, sm: 1.5 },
          border: '1px solid rgba(148, 163, 184, 0.25)',
          boxShadow: '0 18px 36px -28px rgba(15, 23, 42, 0.4)',
        }}
      >
        <TextField
          fullWidth
          multiline
          maxRows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder={placeholder}
          disabled={disabled}
          variant="standard"
          size="medium"
          sx={{
            '& .MuiInputBase-root': {
              fontSize: 15,
              lineHeight: 1.7,
              '&::before, &::after': {
                display: 'none',
              },
            },
            '& textarea': {
              padding: 0,
            },
          }}
        />
        <Tooltip title="Send message">
          <span>
            <IconButton
              onClick={handleSend}
              disabled={!message.trim() || disabled}
              sx={{
                bgcolor: 'primary.main',
                color: 'common.white',
                p: 1.4,
                borderRadius: '18px',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                boxShadow: (theme) =>
                  `0 16px 32px -18px ${theme.palette.primary.main}`,
                '&:hover': {
                  bgcolor: 'primary.dark',
                  transform: 'translateY(-1px)',
                  boxShadow: (theme) =>
                    `0 20px 38px -20px ${theme.palette.primary.dark}`,
                },
                '&.Mui-disabled': {
                  bgcolor: 'grey.200',
                  color: 'grey.500',
                  boxShadow: 'none',
                  transform: 'none',
                },
              }}
            >
              <SendIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Paper>
  );
};

export default ChatInput; 
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
      elevation={2}
      sx={{
        p: 2,
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        borderRadius: 0,
        boxShadow: '0 -8px 24px -20px rgba(15, 23, 42, 0.65)',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          bgcolor: 'grey.50',
          borderRadius: '18px',
          px: 2,
          py: 1.25,
          border: 1,
          borderColor: 'grey.200',
          boxShadow: 'inset 0 1px 2px rgba(15, 23, 42, 0.04)',
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
          variant="outlined"
          size="small"
          sx={{
            '& .MuiOutlinedInput-notchedOutline': {
              border: 'none',
            },
            '& .MuiOutlinedInput-root': {
              borderRadius: '16px',
              bgcolor: 'transparent',
              fontSize: 14,
              '& textarea': {
                lineHeight: 1.6,
              },
            },
          }}
        />
        <Tooltip title="Send message">
          <span>
            <IconButton
              color="primary"
              onClick={handleSend}
              disabled={!message.trim() || disabled}
              sx={{
                bgcolor: 'primary.main',
                color: 'white',
                p: 1.25,
                borderRadius: '16px',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                boxShadow: (theme) =>
                  `0 12px 25px -15px ${theme.palette.primary.main}`,
                '&:hover': {
                  bgcolor: 'primary.dark',
                  transform: 'translateY(-1px)',
                  boxShadow: (theme) =>
                    `0 14px 28px -16px ${theme.palette.primary.dark}`,
                },
                '&.Mui-disabled': {
                  bgcolor: 'grey.300',
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
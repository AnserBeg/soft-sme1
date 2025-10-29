import React from 'react';
import { Box, Typography, Paper, Avatar, Stack, Button, Chip, Divider } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Person as PersonIcon, SmartToy as AIIcon, TaskAlt as TaskIcon } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import dayjs from 'dayjs';
import { Task } from '../types/task';
import { VoiceCallArtifact } from '../types/voice';
import VoiceCallSummaryList from './VoiceCallSummaryList';

export interface ChatMessageItem {
  id: number | string;
  role: 'user' | 'assistant';
  type: string;
  content?: string;
  summary?: string;
  task?: Task;
  link?: string;
  info?: string;
  chunks?: any[];
  citations?: Citation[];
  timestamp?: string;
  createdAt?: string;
  callArtifacts?: VoiceCallArtifact[];
}

interface Citation {
  title?: string;
  path?: string;
  score?: number;
}

interface ChatMessageProps {
  message: ChatMessageItem;
}

const formatTimestamp = (value?: string) => {
  if (!value) return '';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('MMM D, YYYY h:mm A') : '';
};

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const timestamp = formatTimestamp(message.timestamp || message.createdAt);
  const citations = Array.isArray(message.citations) ? message.citations : [];

  const renderCitations = () => {
    if (!citations.length) {
      return null;
    }

    return (
      <Box sx={{ mt: 1.75 }}>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            fontWeight: 600,
            color: 'text.secondary',
            mb: 0.5,
          }}
        >
          Sources:
        </Typography>
        <Stack spacing={0.75}>
          {citations.map((citation, index) => {
            const path = citation.path ?? '';
            const isLink = /^https?:\/\//i.test(path);
            const label = isLink
              ? citation.title || path || `Source ${index + 1}`
              : path || citation.title || `Source ${index + 1}`;
            const scoreLabel =
              typeof citation.score === 'number' && Number.isFinite(citation.score)
                ? citation.score.toFixed(1)
                : null;

            return (
              <Stack
                key={`${path || citation.title || 'citation'}-${index}`}
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ flexWrap: 'wrap', rowGap: 0.25 }}
              >
                {isLink ? (
                  <Typography
                    component="a"
                    href={path}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="caption"
                    sx={{
                      color: 'primary.main',
                      textDecoration: 'none',
                      '&:hover': { textDecoration: 'underline' },
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {label}
                  </Typography>
                ) : (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {label}
                  </Typography>
                )}
                {scoreLabel && (
                  <Typography variant="caption" color="text.disabled">
                    {scoreLabel}
                  </Typography>
                )}
              </Stack>
            );
          })}
        </Stack>
      </Box>
    );
  };

  const renderTaskCard = (type: string) => {
    if (!message.task) {
      return null;
    }
    const statusLabel = message.task.status.replace('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    return (
      <Paper
        variant="outlined"
        sx={{
          px: 2.5,
          py: 2,
          borderRadius: 3,
          borderColor: 'divider',
          backgroundColor: 'background.paper',
        }}
      >
        <Stack spacing={1.5}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <TaskIcon color="primary" fontSize="small" />
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {type === 'task_created' ? 'Task created' : type === 'task_updated' ? 'Task updated' : 'Task note'}
            </Typography>
          </Stack>
          <Box>
            <Typography variant="h6">{message.task.title}</Typography>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Chip label={statusLabel} size="small" />
              {message.task.dueDate && (
                <Chip
                  label={`Due ${dayjs(message.task.dueDate).format('MMM D')}`}
                  size="small"
                  color="warning"
                  variant="outlined"
                />
              )}
            </Stack>
          </Box>
          {message.summary && (
            <Typography variant="body2" color="text.secondary">
              {message.summary}
            </Typography>
          )}
          {message.link && (
            <Button
              component={RouterLink}
              to={message.link}
              variant="contained"
              size="small"
              sx={{ alignSelf: 'flex-start', textTransform: 'none', borderRadius: 999 }}
            >
              View task
            </Button>
          )}
        </Stack>
      </Paper>
    );
  };

  const renderDocs = () => {
    if (!message.chunks || message.chunks.length === 0) {
      return null;
    }
    return (
      <Paper
        variant="outlined"
        sx={{ px: 2, py: 1.75, borderRadius: 3, borderColor: 'divider', backgroundColor: 'background.paper' }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          {message.info || 'Relevant documentation'}
        </Typography>
        <Stack spacing={1.25}>
          {message.chunks.map((chunk: any, index: number) => (
            <Box key={index}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {chunk?.path || 'Documentation'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {chunk?.chunk || ''}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Paper>
    );
  };

  const renderContent = () => {
    if (message.type === 'task_created' || message.type === 'task_updated' || message.type === 'task_message') {
      return renderTaskCard(message.type);
    }
    if (message.type === 'docs') {
      return (
        <>
          {renderDocs()}
          {!isUser && citations.length > 0 ? renderCitations() : null}
        </>
      );
    }
    return (
      <>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
          {message.content || message.summary}
        </Typography>
        {!isUser && message.type === 'text' && citations.length > 0 ? renderCitations() : null}
      </>
    );
  };

  return (
    <Stack direction="row" justifyContent={isUser ? 'flex-end' : 'flex-start'} sx={{ width: '100%' }} spacing={1.5}>
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
          border: isUser ? 'none' : '1px solid rgba(148, 163, 184, 0.25)',
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
            {isUser ? 'You' : 'Workspace Copilot'}
          </Typography>
          {timestamp && (
            <Typography
              variant="caption"
              sx={{
                color: isUser ? alpha('#ffffff', 0.75) : 'text.disabled',
                whiteSpace: 'nowrap',
              }}
            >
              {timestamp}
            </Typography>
          )}
        </Box>

        {renderContent()}

        {!isUser && message.callArtifacts?.length ? (
          <Box sx={{ mt: 2 }}>
            <Divider sx={{ mb: 2, opacity: 0.4 }} />
            <VoiceCallSummaryList artifacts={message.callArtifacts} />
          </Box>
        ) : null}
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

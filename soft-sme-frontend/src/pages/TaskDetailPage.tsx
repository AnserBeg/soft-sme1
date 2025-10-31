import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Chip,
  Grid,
  CircularProgress,
  Avatar,
} from '@mui/material';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { toast } from 'react-toastify';
import TaskChat from '../components/TaskChat';
import { taskChatService } from '../services/taskChatService';
import { TaskDetailResponse } from '../types/tasks';

dayjs.extend(relativeTime);

const TaskDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const taskId = useMemo(() => {
    if (!id) return NaN;
    const parsed = Number(id);
    return Number.isFinite(parsed) ? parsed : NaN;
  }, [id]);

  const [detail, setDetail] = useState<TaskDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadTask = useCallback(async () => {
    if (!Number.isFinite(taskId)) {
      setError('Invalid task identifier');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const response = await taskChatService.getTaskDetail(taskId);
      setDetail(response);
    } catch (err: any) {
      console.error('Failed to load task details', err);
      const message = err?.response?.data?.message || 'Unable to load task details.';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    loadTask();
  }, [loadTask]);

  const handleUnreadChange = useCallback((count: number) => {
    setUnreadCount(count);
  }, []);

  if (!Number.isFinite(taskId)) {
    return (
      <Box p={3}>
        <Typography color="error">Invalid task identifier.</Typography>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box p={3} display="flex" alignItems="center" justifyContent="center" minHeight="40vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={3}>
        <Typography color="error">{error}</Typography>
      </Box>
    );
  }

  if (!detail) {
    return null;
  }

  const { task, participants } = detail;

  return (
    <Box p={3} display="flex" flexDirection="column" gap={3}>
      <Box display="flex" flexDirection={{ xs: 'column', md: 'row' }} gap={2} justifyContent="space-between">
        <Box>
          <Typography variant="h4" gutterBottom>
            {task.title}
          </Typography>
          <Box display="flex" flexWrap="wrap" gap={1} alignItems="center">
            <Chip label={task.status} color={task.status === 'completed' ? 'success' : 'default'} />
            <Chip label={`Priority: ${task.priority ?? 'N/A'}`} variant="outlined" />
            {task.dueDate && (
              <Chip label={`Due ${dayjs(task.dueDate).format('MMM D, YYYY')}`} color="warning" />
            )}
            {unreadCount > 0 && <Chip label={`${unreadCount} unread`} color="secondary" />}
          </Box>
        </Box>
        <Box textAlign={{ xs: 'left', md: 'right' }} color="text.secondary">
          {task.updatedAt && (
            <Typography variant="body2">Updated {dayjs(task.updatedAt).format('MMM D, YYYY h:mm A')}</Typography>
          )}
          {task.createdAt && (
            <Typography variant="body2">Created {dayjs(task.createdAt).format('MMM D, YYYY h:mm A')}</Typography>
          )}
        </Box>
      </Box>

      {task.description && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" gutterBottom>
            Description
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
            {task.description}
          </Typography>
        </Paper>
      )}

      <Grid container spacing={3} alignItems="stretch">
        <Grid item xs={12} md={4}>
          <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
            <Typography variant="subtitle1" gutterBottom>
              Participants
            </Typography>
            {participants.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No participants assigned.
              </Typography>
            ) : (
              <Box display="flex" flexDirection="column" gap={1.5}>
                {participants.map((participant) => {
                  const initials = (participant.name || participant.email || 'T')[0]?.toUpperCase();
                  return (
                    <Box key={participant.id} display="flex" alignItems="center" gap={1.5}>
                      <Avatar sx={{ bgcolor: 'primary.main' }}>{initials}</Avatar>
                      <Box flex={1}>
                        <Typography variant="body2">{participant.name || 'Unnamed user'}</Typography>
                        <Typography variant="caption" color="text.secondary" display="block">
                          {participant.email || 'No email'} · {participant.role || 'Participant'}
                        </Typography>
                        {participant.lastReadAt && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            Read {dayjs(participant.lastReadAt).fromNow()}
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} md={8}>
          <TaskChat taskId={taskId} onUnreadChange={handleUnreadChange} />
        </Grid>
      </Grid>
    </Box>
  );
};

export default TaskDetailPage;

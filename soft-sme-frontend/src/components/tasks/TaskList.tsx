import React from 'react';
import {
  Avatar,
  AvatarGroup,
  Box,
  Card,
  CardActionArea,
  CardActions,
  Chip,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import NotesIcon from '@mui/icons-material/Notes';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { Task } from '../../types/task';
import TaskCompletionToggle from './TaskCompletionToggle';

interface TaskListProps {
  tasks: Task[];
  onSelect: (task: Task) => void;
  onToggleComplete: (task: Task, completed: boolean) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

const STATUS_LABELS: Record<Task['status'], string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  archived: 'Archived',
};

const STATUS_COLOR: Record<Task['status'], 'default' | 'primary' | 'success' | 'error' | 'info' | 'warning'> = {
  pending: 'warning',
  in_progress: 'info',
  completed: 'success',
  archived: 'default',
};

const formatDate = (iso: string | null): string => {
  if (!iso) {
    return 'No due date';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
};

const relativeFormatter =
  typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl
    ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    : null;

const formatRelativeTime = (iso: string | null): string => {
  if (!iso) {
    return 'Never';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || !relativeFormatter) {
    return formatDate(iso);
  }
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 1000 * 60 * 60 * 24],
    ['hour', 1000 * 60 * 60],
    ['minute', 1000 * 60],
  ];
  for (const [unit, value] of units) {
    if (abs >= value || unit === 'minute') {
      const rounded = Math.round(diffMs / value);
      return relativeFormatter.format(rounded, unit);
    }
  }
  return relativeFormatter.format(0, 'minute');
};

const TaskList: React.FC<TaskListProps> = ({ tasks, onSelect, onToggleComplete, onEdit, onDelete }) => {
  if (tasks.length === 0) {
    return (
      <Box
        textAlign="center"
        py={6}
        color="text.secondary"
        sx={{
          border: '1px dashed',
          borderColor: 'divider',
          borderRadius: 3,
          backgroundColor: 'background.paper',
        }}
      >
        <NotesIcon sx={{ fontSize: 48, mb: 1 }} />
        <Typography variant="h6">No tasks found</Typography>
        <Typography variant="body2">
          Use the “New task” button above to create your first assignment.
        </Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={2.5}>
      {tasks.map((task) => {
        const dueDate = task.dueDate ? new Date(task.dueDate) : null;
        const now = Date.now();
        const isOverdue = Boolean(dueDate && dueDate.getTime() < now && task.status !== 'completed');
        const diffDays =
          dueDate && task.status !== 'completed'
            ? Math.ceil((dueDate.getTime() - now) / (1000 * 60 * 60 * 24))
            : null;
        const isDueSoon = typeof diffDays === 'number' && diffDays >= 0 && diffDays <= 3;
        const accentColor = isOverdue
          ? 'error.main'
          : task.status === 'completed'
            ? 'success.main'
            : isDueSoon
              ? 'warning.main'
              : 'info.main';

        return (
          <Card
            key={task.id}
            elevation={0}
            sx={{
              position: 'relative',
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              overflow: 'hidden',
              transition: 'all 0.2s ease-in-out',
              backgroundColor: 'background.paper',
              '&:hover': {
                boxShadow: 8,
                transform: 'translateY(-2px)',
              },
            }}
          >
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                bottom: 0,
                width: 6,
                bgcolor: accentColor,
              }}
            />

            <CardActionArea onClick={() => onSelect(task)} sx={{ alignSelf: 'stretch' }}>
              <Box sx={{ p: { xs: 2.5, sm: 3 } }}>
                <Stack spacing={2}>
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1.5}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', md: 'center' }}
                  >
                    <Typography variant="h6">{task.title}</Typography>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip
                        label={STATUS_LABELS[task.status]}
                        color={STATUS_COLOR[task.status]}
                        size="small"
                      />
                      {isOverdue && task.status !== 'completed' && (
                        <Chip label="Overdue" color="error" size="small" variant="outlined" />
                      )}
                      {task.status === 'completed' && (
                        <Chip
                          label={`Completed ${formatRelativeTime(task.completedAt)}`}
                          color="success"
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </Stack>
                  </Stack>

                  {task.description && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {task.description}
                    </Typography>
                  )}

                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={2}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', md: 'center' }}
                  >
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip
                        icon={<CalendarTodayIcon fontSize="small" />}
                        label={formatDate(task.dueDate)}
                        color={isOverdue ? 'error' : isDueSoon ? 'warning' : 'default'}
                        variant={task.dueDate ? 'filled' : 'outlined'}
                        size="small"
                      />
                      <Chip
                        icon={<NotesIcon fontSize="small" />}
                        label={`${task.noteCount} note${task.noteCount === 1 ? '' : 's'}`}
                        size="small"
                        variant="outlined"
                      />
                      <Chip
                        icon={<ScheduleIcon fontSize="small" />}
                        label={`Updated ${formatRelativeTime(task.updatedAt)}`}
                        size="small"
                        variant="outlined"
                      />
                    </Stack>

                    {task.assignees.length > 0 ? (
                      <AvatarGroup
                        max={4}
                        sx={{ '& .MuiAvatar-root': { width: 32, height: 32, fontSize: 14 } }}
                      >
                        {task.assignees.map((assignee) => (
                          <Tooltip
                            title={assignee.username || assignee.email}
                            key={`${task.id}-assignee-${assignee.id}`}
                          >
                            <Avatar>
                              {(assignee.username || assignee.email || '?').charAt(0).toUpperCase()}
                            </Avatar>
                          </Tooltip>
                        ))}
                      </AvatarGroup>
                    ) : (
                      <Chip label="Unassigned" size="small" variant="outlined" />
                    )}
                  </Stack>
                </Stack>
              </Box>
            </CardActionArea>

            <Divider />

            <CardActions
              sx={{
                px: { xs: 2, sm: 3 },
                py: 1.5,
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Box onClick={(event) => event.stopPropagation()} sx={{ display: 'flex', alignItems: 'center' }}>
                <TaskCompletionToggle
                  completed={task.status === 'completed'}
                  onToggle={(completed) => onToggleComplete(task, completed)}
                  label={task.status === 'completed' ? 'Completed' : 'Mark complete'}
                />
              </Box>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Tooltip title="Edit task">
                  <IconButton
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdit(task);
                    }}
                  >
                    <EditIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete task">
                  <IconButton
                    color="error"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(task);
                    }}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
            </CardActions>
          </Card>
        );
      })}
    </Stack>
  );
};

export default TaskList;

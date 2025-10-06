import React from 'react';
import {
  Avatar,
  AvatarGroup,
  Box,
  Chip,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemSecondaryAction,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import NotesIcon from '@mui/icons-material/Notes';
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

const TaskList: React.FC<TaskListProps> = ({ tasks, onSelect, onToggleComplete, onEdit, onDelete }) => {
  if (tasks.length === 0) {
    return (
      <Box textAlign="center" py={6} color="text.secondary">
        <NotesIcon sx={{ fontSize: 48, mb: 1 }} />
        <Typography variant="h6">No tasks found</Typography>
        <Typography variant="body2">Create a task to get started.</Typography>
      </Box>
    );
  }

  return (
    <List disablePadding>
      {tasks.map((task, index) => {
        const dueDate = task.dueDate ? new Date(task.dueDate) : null;
        const isOverdue = dueDate && dueDate.getTime() < Date.now() && task.status !== 'completed';
        return (
          <React.Fragment key={task.id}>
            <ListItem alignItems="flex-start" button onClick={() => onSelect(task)}>
              <ListItemText
                primary={
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Typography variant="h6" sx={{ flexGrow: 1 }}>
                      {task.title}
                    </Typography>
                    <Chip
                      label={STATUS_LABELS[task.status]}
                      color={STATUS_COLOR[task.status]}
                      size="small"
                    />
                  </Stack>
                }
                secondary={
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', md: 'center' }}>
                    <Typography variant="body2" color={isOverdue ? 'error.main' : 'text.secondary'}>
                      Due: {formatDate(task.dueDate)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {task.noteCount} note{task.noteCount === 1 ? '' : 's'}
                    </Typography>
                    {task.assignees.length > 0 && (
                      <AvatarGroup max={4} sx={{ '& .MuiAvatar-root': { width: 28, height: 28, fontSize: 14 } }}>
                        {task.assignees.map((assignee) => (
                          <Tooltip title={assignee.username || assignee.email} key={`${task.id}-assignee-${assignee.id}`}>
                            <Avatar>
                              {(assignee.username || assignee.email || '?').charAt(0).toUpperCase()}
                            </Avatar>
                          </Tooltip>
                        ))}
                      </AvatarGroup>
                    )}
                  </Stack>
                }
              />

              <ListItemSecondaryAction>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box onClick={(event) => event.stopPropagation()}>
                    <TaskCompletionToggle
                      completed={task.status === 'completed'}
                      onToggle={(completed) => onToggleComplete(task, completed)}
                      label=""
                    />
                  </Box>
                  <Tooltip title="Edit task">
                    <IconButton edge="end" onClick={(event) => { event.stopPropagation(); onEdit(task); }}>
                      <EditIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete task">
                    <IconButton edge="end" color="error" onClick={(event) => { event.stopPropagation(); onDelete(task); }}>
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </ListItemSecondaryAction>
            </ListItem>
            {index < tasks.length - 1 && <Divider component="li" />}
          </React.Fragment>
        );
      })}
    </List>
  );
};

export default TaskList;

import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import TaskCompletionToggle from './TaskCompletionToggle';
import { Task } from '../../types/task';

interface TaskDetailDialogProps {
  open: boolean;
  task: Task | null;
  loading?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onToggleComplete: (completed: boolean) => Promise<void> | void;
  onAddNote: (note: string) => Promise<void>;
}

const formatDateTime = (iso: string | null): string => {
  if (!iso) {
    return 'Not set';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).format(new Date(iso));
};

const TaskDetailDialog: React.FC<TaskDetailDialogProps> = ({
  open,
  task,
  loading,
  onClose,
  onEdit,
  onToggleComplete,
  onAddNote,
}) => {
  const [note, setNote] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  useEffect(() => {
    if (!open) {
      setNote('');
      setIsAddingNote(false);
      setIsToggling(false);
    }
  }, [open]);

  const handleAddNote = async () => {
    if (!note.trim()) {
      return;
    }
    setIsAddingNote(true);
    try {
      await onAddNote(note.trim());
      setNote('');
    } finally {
      setIsAddingNote(false);
    }
  };

  const handleToggle = async (completed: boolean) => {
    setIsToggling(true);
    try {
      await onToggleComplete(completed);
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h6">Task details</Typography>
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {loading && !task ? (
          <Typography variant="body2">Loading task details…</Typography>
        ) : task ? (
          <Stack spacing={3}>
            <Box>
              <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                <Typography variant="h5">{task.title}</Typography>
                <Chip label={task.status.replace('_', ' ')} color={task.status === 'completed' ? 'success' : 'default'} />
              </Stack>
              {task.description && (
                <Typography variant="body1" sx={{ mt: 1 }} color="text.secondary">
                  {task.description}
                </Typography>
              )}
            </Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Due date
                </Typography>
                <Typography variant="body1">{formatDateTime(task.dueDate)}</Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Last updated
                </Typography>
                <Typography variant="body1">{formatDateTime(task.updatedAt)}</Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Completed at
                </Typography>
                <Typography variant="body1">{formatDateTime(task.completedAt)}</Typography>
              </Box>
            </Stack>

            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Assigned team members
              </Typography>
              {task.assignees.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No assignees yet.
                </Typography>
              ) : (
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {task.assignees.map((assignee) => (
                    <Chip key={assignee.id} label={assignee.username || assignee.email} />
                  ))}
                </Stack>
              )}
            </Box>

            <Divider />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }}>
              <TaskCompletionToggle
                completed={task.status === 'completed'}
                onToggle={handleToggle}
                disabled={isToggling}
              />
              <Button variant="outlined" onClick={onEdit}>
                Edit task
              </Button>
            </Stack>

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Notes
              </Typography>
              {task.notes && task.notes.length > 0 ? (
                <List dense>
                  {task.notes.map((noteItem) => (
                    <ListItem key={noteItem.id} alignItems="flex-start" disableGutters>
                      <ListItemText
                        primary={noteItem.note}
                        secondary={
                          noteItem.authorName
                            ? `${noteItem.authorName} • ${formatDateTime(noteItem.createdAt)}`
                            : formatDateTime(noteItem.createdAt)
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No notes yet.
                </Typography>
              )}
            </Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <TextField
                label="Add a note"
                fullWidth
                value={note}
                onChange={(event) => setNote(event.target.value)}
                multiline
                minRows={2}
              />
              <Button
                variant="contained"
                onClick={handleAddNote}
                disabled={!note.trim() || isAddingNote}
              >
                Add note
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Typography variant="body2">Task not found.</Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default TaskDetailDialog;

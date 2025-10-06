import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Task, TaskAssignee, TaskStatus } from '../../types/task';

export interface TaskFormValues {
  title: string;
  description?: string;
  dueDate?: string | null;
  status?: TaskStatus;
  assigneeIds: number[];
  initialNote?: string;
}

interface TaskFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialTask?: Task | null;
  assignees: TaskAssignee[];
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (values: TaskFormValues) => Promise<void> | void;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

const formatDateForInput = (iso?: string | null): string => {
  if (!iso) {
    return '';
  }
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toISOString().slice(0, 10);
  } catch {
    return '';
  }
};

const TaskFormDialog: React.FC<TaskFormDialogProps> = ({
  open,
  mode,
  initialTask,
  assignees,
  submitting,
  onClose,
  onSubmit,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [selectedAssignees, setSelectedAssignees] = useState<number[]>([]);
  const [initialNote, setInitialNote] = useState('');
  const [errors, setErrors] = useState<{ title?: string }>({});

  useEffect(() => {
    if (open) {
      if (mode === 'edit' && initialTask) {
        setTitle(initialTask.title);
        setDescription(initialTask.description ?? '');
        setDueDate(formatDateForInput(initialTask.dueDate));
        setStatus(initialTask.status);
        setSelectedAssignees(initialTask.assignees.map((assignee) => assignee.id));
      } else {
        setTitle('');
        setDescription('');
        setDueDate('');
        setStatus('pending');
        setSelectedAssignees([]);
      }
      setInitialNote('');
      setErrors({});
    }
  }, [open, mode, initialTask]);

  const availableAssignees = useMemo(
    () =>
      [...assignees].sort((a, b) => (a.username || a.email || '').localeCompare(b.username || b.email || '')),
    [assignees]
  );

  const handleSubmit = async () => {
    if (!title.trim()) {
      setErrors({ title: 'Title is required' });
      return;
    }

    const payload: TaskFormValues = {
      title: title.trim(),
      description: description.trim() || undefined,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      status,
      assigneeIds: selectedAssignees,
    };

    if (mode === 'create' && initialNote.trim()) {
      payload.initialNote = initialNote.trim();
    }

    await onSubmit(payload);
  };

  const dialogTitle = mode === 'create' ? 'Create task' : 'Edit task';

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{dialogTitle}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          <TextField
            label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            error={Boolean(errors.title)}
            helperText={errors.title}
            required
            autoFocus
          />

          <TextField
            label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            multiline
            minRows={3}
          />

          <TextField
            label="Due date"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            InputLabelProps={{ shrink: true }}
          />

          <FormControl fullWidth>
            <InputLabel id="task-status-select">Status</InputLabel>
            <Select
              labelId="task-status-select"
              value={status}
              label="Status"
              onChange={(event) => setStatus(event.target.value as TaskStatus)}
            >
              {STATUS_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel id="task-assignees-label">Assign to</InputLabel>
            <Select
              labelId="task-assignees-label"
              multiple
              value={selectedAssignees.map(String)}
              onChange={(event) => {
                const value = event.target.value;
                const ids = typeof value === 'string' ? value.split(',') : value;
                setSelectedAssignees(ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id)));
              }}
              input={<OutlinedInput label="Assign to" />}
              renderValue={(selected) => {
                const ids = selected as string[];
                if (ids.length === 0) {
                  return 'No assignees';
                }
                return ids
                  .map((id) => {
                    const match = availableAssignees.find((assignee) => assignee.id === Number(id));
                    return match?.username || match?.email || id;
                  })
                  .join(', ');
              }}
            >
              {availableAssignees.map((assignee) => (
                <MenuItem key={assignee.id} value={String(assignee.id)}>
                  <ListItemText primary={assignee.username || assignee.email} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {mode === 'create' && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Initial note (optional)
              </Typography>
              <TextField
                placeholder="Share context with your team"
                value={initialNote}
                onChange={(event) => setInitialNote(event.target.value)}
                fullWidth
                multiline
                minRows={2}
              />
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={submitting}>
          {mode === 'create' ? 'Create task' : 'Save changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TaskFormDialog;

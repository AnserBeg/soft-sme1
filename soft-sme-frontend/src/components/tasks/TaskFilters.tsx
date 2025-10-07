import React from 'react';
import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  SelectChangeEvent,
  Stack,
  TextField,
} from '@mui/material';
import { TaskAssignee, TaskFilters, TaskStatus } from '../../types/task';

interface TaskFiltersProps {
  filters: TaskFilters;
  assignees: TaskAssignee[];
  onChange: (filters: TaskFilters) => void;
  onReset?: () => void;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

const TaskFiltersComponent: React.FC<TaskFiltersProps> = ({ filters, assignees, onChange, onReset }) => {
  const handleStatusChange = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value;
    const status = typeof value === 'string' ? value.split(',') : value;
    onChange({ ...filters, status: status.filter(Boolean) as TaskStatus[] });
  };

  const handleAssignedChange = (event: SelectChangeEvent<string>) => {
    const value = event.target.value;
    onChange({ ...filters, assignedTo: value ? Number(value) : undefined });
  };

  const handleInputChange = (field: keyof TaskFilters) => (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...filters, [field]: event.target.value || undefined });
  };

  const handleCheckboxChange = (field: keyof TaskFilters) => (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...filters, [field]: event.target.checked });
  };

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'flex-end' }}>
        <FormControl sx={{ minWidth: 200 }} size="small">
          <InputLabel id="task-status-label">Status</InputLabel>
          <Select
            labelId="task-status-label"
            multiple
            value={filters.status ?? []}
            onChange={handleStatusChange}
            input={<OutlinedInput label="Status" />}
            renderValue={(selected) =>
              (selected as TaskStatus[])
                .map((status) => STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status)
                .join(', ')
            }
          >
            {STATUS_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                <Checkbox checked={filters.status?.includes(option.value) ?? false} />
                <ListItemText primary={option.label} />
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl sx={{ minWidth: 200 }} size="small">
          <InputLabel id="task-assigned-label">Assigned To</InputLabel>
          <Select
            labelId="task-assigned-label"
            value={filters.assignedTo ? String(filters.assignedTo) : ''}
            label="Assigned To"
            onChange={handleAssignedChange}
          >
            <MenuItem value="">
              <em>All team members</em>
            </MenuItem>
            {assignees.map((assignee) => (
              <MenuItem key={assignee.id} value={assignee.id}>
                {assignee.username || assignee.email}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          label="Search"
          size="small"
          value={filters.search ?? ''}
          onChange={handleInputChange('search')}
        />

        <TextField
          label="Due from"
          type="date"
          size="small"
          value={filters.dueFrom?.slice(0, 10) ?? ''}
          onChange={handleInputChange('dueFrom')}
          InputLabelProps={{ shrink: true }}
        />

        <TextField
          label="Due to"
          type="date"
          size="small"
          value={filters.dueTo?.slice(0, 10) ?? ''}
          onChange={handleInputChange('dueTo')}
          InputLabelProps={{ shrink: true }}
        />

        <FormControlLabel
          control={<Checkbox checked={filters.includeCompleted ?? false} onChange={handleCheckboxChange('includeCompleted')} />}
          label="Show completed"
        />

        <FormControlLabel
          control={<Checkbox checked={filters.includeArchived ?? false} onChange={handleCheckboxChange('includeArchived')} />}
          label="Show archived"
        />

        {onReset && (
          <Button variant="text" onClick={onReset} color="secondary">
            Reset
          </Button>
        )}
      </Stack>
    </Box>
  );
};

export default TaskFiltersComponent;

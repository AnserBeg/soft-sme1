import React from 'react';
import { FormControlLabel, Switch, Tooltip } from '@mui/material';

interface TaskCompletionToggleProps {
  completed: boolean;
  disabled?: boolean;
  onToggle: (completed: boolean) => void;
  label?: string;
}

const TaskCompletionToggle: React.FC<TaskCompletionToggleProps> = ({ completed, disabled, onToggle, label }) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onToggle(event.target.checked);
  };

  return (
    <Tooltip title={completed ? 'Mark as incomplete' : 'Mark as completed'}>
      <FormControlLabel
        control={
          <Switch
            checked={completed}
            onChange={handleChange}
            disabled={disabled}
            color="success"
            size="small"
          />
        }
        label={label ?? (completed ? 'Completed' : 'Mark complete')}
      />
    </Tooltip>
  );
};

export default TaskCompletionToggle;

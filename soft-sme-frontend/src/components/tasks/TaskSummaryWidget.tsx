import React from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck';
import { TaskSummary } from '../../types/task';

interface TaskSummaryWidgetProps {
  summary: TaskSummary | null;
  loading?: boolean;
  onRefresh?: () => void;
  onViewTasks?: () => void;
}

const METRIC_CONFIG = [
  {
    key: 'open' as const,
    label: 'Open Tasks',
    icon: <PendingActionsIcon color="info" fontSize="large" />,
  },
  {
    key: 'completed' as const,
    label: 'Completed',
    icon: <AssignmentTurnedInIcon color="success" fontSize="large" />,
  },
  {
    key: 'overdue' as const,
    label: 'Overdue',
    icon: <EventBusyIcon color="error" fontSize="large" />,
  },
  {
    key: 'dueToday' as const,
    label: 'Due Today',
    icon: <EventAvailableIcon color="warning" fontSize="large" />,
  },
  {
    key: 'dueSoon' as const,
    label: 'Due in 7 Days',
    icon: <PlaylistAddCheckIcon color="secondary" fontSize="large" />,
  },
];

const TaskSummaryWidget: React.FC<TaskSummaryWidgetProps> = ({ summary, loading, onRefresh, onViewTasks }) => {
  return (
    <Card sx={{ borderRadius: 3, boxShadow: 4 }}>
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={2}>
          <Box>
            <Typography variant="h5" gutterBottom>
              Task Overview
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Stay on top of the work that needs attention.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            {onRefresh && (
              <Button variant="outlined" startIcon={<RefreshIcon />} onClick={onRefresh} disabled={loading}>
                Refresh
              </Button>
            )}
            {onViewTasks && (
              <Button variant="contained" onClick={onViewTasks}>
                View tasks
              </Button>
            )}
          </Stack>
        </Stack>

        <Box sx={{ mt: 3 }}>
          {loading ? (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress />
            </Box>
          ) : summary ? (
            <Grid container spacing={2}>
              {METRIC_CONFIG.map((metric) => (
                <Grid item xs={12} sm={6} md={2} key={metric.key}>
                  <Box
                    sx={{
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      p: 2,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      textAlign: 'center',
                      gap: 1,
                    }}
                  >
                    {metric.icon}
                    <Typography variant="h6">
                      {summary[metric.key] ?? 0}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {metric.label}
                    </Typography>
                  </Box>
                </Grid>
              ))}
            </Grid>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Task data is not available yet. Create your first task to populate this overview.
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

export default TaskSummaryWidget;

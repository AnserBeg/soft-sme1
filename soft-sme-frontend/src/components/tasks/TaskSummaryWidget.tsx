import React from 'react';
import { Box, Button, Card, CardContent, CircularProgress, Stack, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AssignmentLateIcon from '@mui/icons-material/AssignmentLate';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import { alpha } from '@mui/material/styles';
import { TaskSummary } from '../../types/task';

interface TaskSummaryWidgetProps {
  summary: TaskSummary | null;
  loading?: boolean;
  onRefresh?: () => void;
  onViewTasks?: () => void;
}

const METRIC_CONFIG: {
  key: keyof Pick<
    TaskSummary,
    'myOpen' | 'myDueToday' | 'myOverdue' | 'assignedByMeOverdue' | 'allOverdue'
  >;
  label: string;
  icon: React.ReactNode;
  palette: 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error';
}[] = [
  {
    key: 'myOpen',
    label: 'My open tasks',
    icon: <AssignmentIndIcon fontSize="large" />,
    palette: 'info',
  },
  {
    key: 'myDueToday',
    label: 'My tasks due today',
    icon: <CalendarTodayIcon fontSize="large" />,
    palette: 'warning',
  },
  {
    key: 'myOverdue',
    label: 'My overdue tasks',
    icon: <WarningAmberIcon fontSize="large" />,
    palette: 'error',
  },
  {
    key: 'assignedByMeOverdue',
    label: 'Overdue tasks I assigned',
    icon: <AssignmentLateIcon fontSize="large" />,
    palette: 'secondary',
  },
  {
    key: 'allOverdue',
    label: 'All overdue tasks',
    icon: <ReportProblemIcon fontSize="large" />,
    palette: 'error',
  },
];

const TaskSummaryWidget: React.FC<TaskSummaryWidgetProps> = ({ summary, loading, onRefresh, onViewTasks }) => {
  const totalTasks = summary?.total ?? 0;

  return (
    <Card
      sx={{
        borderRadius: 3,
        overflow: 'hidden',
        position: 'relative',
        boxShadow: '0 24px 60px -32px rgba(15, 23, 42, 0.45)',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(140deg, rgba(59, 130, 246, 0.12) 0%, rgba(99, 102, 241, 0.08) 45%, rgba(168, 85, 247, 0.05) 100%)',
          pointerEvents: 'none',
        }}
      />
      <CardContent sx={{ position: 'relative', p: { xs: 3, md: 4 } }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
          spacing={3}
        >
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2 }}>
              Team workload snapshot
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 600 }}>
              Task overview
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
              Tracking <strong>{totalTasks}</strong> task{totalTasks === 1 ? '' : 's'} across your workspace.
            </Typography>
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} width={{ xs: '100%', sm: 'auto' }}>
            {onRefresh && (
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={onRefresh}
                disabled={loading}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                Refresh
              </Button>
            )}
            {onViewTasks && (
              <Button
                variant="contained"
                onClick={onViewTasks}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                View tasks
              </Button>
            )}
          </Stack>
        </Stack>

        <Box sx={{ mt: 4 }}>
          {loading ? (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress />
            </Box>
          ) : summary ? (
            <Box
              sx={{
                display: 'grid',
                gap: 2.5,
                gridTemplateColumns: {
                  xs: 'repeat(1, minmax(0, 1fr))',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  md: 'repeat(3, minmax(0, 1fr))',
                  lg: 'repeat(5, minmax(0, 1fr))',
                },
              }}
            >
              {METRIC_CONFIG.map((metric) => (
                <Box
                  key={metric.key}
                  sx={(theme) => ({
                    borderRadius: 3,
                    p: 3,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                    border: `1px solid ${alpha(theme.palette[metric.palette].main, 0.28)}`,
                    background: `linear-gradient(135deg, ${alpha(theme.palette[metric.palette].main, 0.18)} 0%, ${alpha(theme.palette[metric.palette].main, 0.06)} 100%)`,
                    boxShadow: `0 12px 30px -20px ${alpha(theme.palette[metric.palette].main, 0.6)}`,
                    color: theme.palette.text.primary,
                  })}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                    <Box
                      sx={(theme) => ({
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        backgroundColor: alpha(theme.palette[metric.palette].main, 0.2),
                        color: theme.palette[metric.palette].dark,
                      })}
                    >
                      {metric.icon}
                    </Box>
                    <Typography variant="subtitle2" color="text.secondary">
                      {metric.label}
                    </Typography>
                  </Box>
                  <Typography variant="h4" sx={{ fontWeight: 600 }}>
                    {summary[metric.key] ?? 0}
                  </Typography>
                </Box>
              ))}
            </Box>
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

import React, { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import dayjs, { Dayjs } from 'dayjs';
import { DateCalendar, PickersDay, PickersDayProps } from '@mui/x-date-pickers';
import type { Task } from '../../types/task';

interface TaskCalendarProps {
  tasks: Task[];
  loading?: boolean;
  onSelectTask?: (task: Task) => void;
}

type DayKey = string;

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

const TaskCalendar: React.FC<TaskCalendarProps> = ({ tasks, loading, onSelectTask }) => {
  const tasksByDate = useMemo(() => {
    const map = new Map<DayKey, Task[]>();
    tasks.forEach((task) => {
      if (!task.dueDate) {
        return;
      }
      const due = dayjs(task.dueDate);
      if (!due.isValid()) {
        return;
      }
      const key = due.format('YYYY-MM-DD');
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    });

    map.forEach((list) => {
      list.sort((a, b) => {
        const first = dayjs(a.dueDate ?? 0).valueOf();
        const second = dayjs(b.dueDate ?? 0).valueOf();
        return first - second;
      });
    });

    return map;
  }, [tasks]);

  const initialDate = useMemo(() => {
    if (tasksByDate.size === 0) {
      return dayjs();
    }
    const todayKey = dayjs().format('YYYY-MM-DD');
    if (tasksByDate.has(todayKey)) {
      return dayjs();
    }
    const firstKey = Array.from(tasksByDate.keys()).sort()[0];
    return firstKey ? dayjs(firstKey) : dayjs();
  }, [tasksByDate]);

  const [selectedDate, setSelectedDate] = useState<Dayjs>(initialDate);

  useEffect(() => {
    const key = selectedDate.format('YYYY-MM-DD');
    if (tasksByDate.size === 0) {
      return;
    }
    if (tasksByDate.has(key)) {
      return;
    }
    const today = dayjs();
    const todayKey = today.format('YYYY-MM-DD');
    if (tasksByDate.has(todayKey)) {
      setSelectedDate(today);
      return;
    }
    const firstKey = Array.from(tasksByDate.keys()).sort()[0];
    if (firstKey) {
      setSelectedDate(dayjs(firstKey));
    }
  }, [selectedDate, tasksByDate]);

  const selectedKey = selectedDate.format('YYYY-MM-DD');
  const selectedTasks = tasksByDate.get(selectedKey) ?? [];
  const anyDueDates = tasksByDate.size > 0;
  const now = dayjs();

  const DayWithIndicators = (dayProps: PickersDayProps<Dayjs>) => {
    const key = dayProps.day.format('YYYY-MM-DD');
    const dayTasks = tasksByDate.get(key) ?? [];
    const hasTasks = dayTasks.length > 0;
    const hasOverdue = dayTasks.some(
      (task) => task.dueDate && dayjs(task.dueDate).isBefore(now) && task.status !== 'completed',
    );

    return (
      <Badge
        key={key}
        overlap="circular"
        variant={hasTasks ? 'dot' : 'standard'}
        color={hasOverdue ? 'error' : 'primary'}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <PickersDay
          {...dayProps}
          sx={{
            ...(hasTasks
              ? {
                  fontWeight: 600,
                }
              : null),
          }}
        />
      </Badge>
    );
  };

  return (
    <Card
      sx={{
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: '0 24px 60px -36px rgba(15, 23, 42, 0.35)',
      }}
    >
      <CardContent sx={{ p: { xs: 3, md: 4 } }}>
        <Stack direction="row" spacing={1.5} alignItems="center" mb={2}>
          <CalendarMonthIcon color="primary" />
          <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
            Due date calendar
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Visualize upcoming deadlines and jump directly to the tasks that need your attention.
        </Typography>

        <Stack
          direction={{ xs: 'column', lg: 'row' }}
          spacing={{ xs: 3, lg: 4 }}
          mt={3}
          alignItems={{ xs: 'stretch', lg: 'flex-start' }}
        >
          <DateCalendar
            value={selectedDate}
            onChange={(value) => value && setSelectedDate(value)}
            views={['day']}
            slots={{ day: DayWithIndicators }}
            sx={{
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
              p: 1.5,
            }}
          />

          <Box sx={{ flex: 1, width: '100%' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {selectedDate.format('MMMM D, YYYY')}
            </Typography>

            {loading ? (
              <Box display="flex" justifyContent="center" py={4}>
                <CircularProgress size={28} />
              </Box>
            ) : !anyDueDates ? (
              <Box
                sx={{
                  mt: 2,
                  p: 3,
                  borderRadius: 2,
                  border: '1px dashed',
                  borderColor: 'divider',
                  textAlign: 'center',
                  color: 'text.secondary',
                }}
              >
                <Typography variant="body2">
                  None of your tasks have due dates yet. Add due dates to see them on the calendar.
                </Typography>
              </Box>
            ) : selectedTasks.length === 0 ? (
              <Box
                sx={{
                  mt: 2,
                  p: 3,
                  borderRadius: 2,
                  border: '1px dashed',
                  borderColor: 'divider',
                  textAlign: 'center',
                  color: 'text.secondary',
                }}
              >
                <Typography variant="body2">
                  No tasks are due on this day. Select another date to explore upcoming work.
                </Typography>
              </Box>
            ) : (
              <Stack spacing={1.5} mt={2}>
                {selectedTasks.map((task) => {
                  const dueDate = dayjs(task.dueDate);
                  const isOverdue = task.dueDate && dueDate.isBefore(now) && task.status !== 'completed';

                  return (
                    <Box
                      key={task.id}
                      onClick={() => onSelectTask?.(task)}
                      role={onSelectTask ? 'button' : undefined}
                      tabIndex={onSelectTask ? 0 : undefined}
                      onKeyDown={(event) => {
                        if (!onSelectTask) {
                          return;
                        }
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelectTask(task);
                        }
                      }}
                      sx={{
                        p: 2.25,
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: 'divider',
                        backgroundColor: 'background.paper',
                        cursor: onSelectTask ? 'pointer' : 'default',
                        transition: 'all 0.2s ease-in-out',
                        '&:hover': onSelectTask
                          ? {
                              borderColor: 'primary.main',
                              boxShadow: 3,
                            }
                          : undefined,
                      }}
                    >
                      <Stack spacing={1}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                          {task.title}
                        </Typography>
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
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Chip
                            label={STATUS_LABELS[task.status]}
                            color={STATUS_COLOR[task.status]}
                            size="small"
                          />
                          {isOverdue && (
                            <Chip label="Overdue" color="error" size="small" variant="outlined" />
                          )}
                          {task.dueDate && (
                            <Chip
                              label={`Due ${dueDate.format('MMM D, YYYY')}`}
                              color="info"
                              size="small"
                              variant="outlined"
                            />
                          )}
                        </Stack>
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default TaskCalendar;

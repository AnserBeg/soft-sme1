import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import { toast } from 'react-toastify';
import TaskFiltersComponent from '../components/tasks/TaskFilters';
import TaskList from '../components/tasks/TaskList';
import TaskDetailDialog from '../components/tasks/TaskDetailDialog';
import TaskFormDialog, { TaskFormValues } from '../components/tasks/TaskFormDialog';
import TaskSummaryWidget from '../components/tasks/TaskSummaryWidget';
import TaskCalendar from '../components/tasks/TaskCalendar';
import {
  addTaskNote,
  createTask,
  deleteTask,
  getAssignableUsers,
  getTaskById,
  getTaskSummary,
  getTasks,
  toggleTaskCompletion,
  updateTask,
  updateTaskAssignments,
} from '../services/taskService';
import { Task, TaskAssignee, TaskFilters, TaskSummary } from '../types/task';

const sortIds = (ids: number[]): number[] => [...ids].sort((a, b) => a - b);

const areIdListsEqual = (a: number[], b: number[]): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = sortIds(a);
  const sortedB = sortIds(b);
  return sortedA.every((value, index) => value === sortedB[index]);
};

const DEFAULT_FILTERS: TaskFilters = {
  includeCompleted: false,
  includeArchived: false,
};

const TasksDashboardPage: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen] = useState<boolean>(false);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [formOpen, setFormOpen] = useState<boolean>(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [formSubmitting, setFormSubmitting] = useState<boolean>(false);
  const [taskForForm, setTaskForForm] = useState<Task | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasksData, summaryData] = await Promise.all([getTasks(filters), getTaskSummary()]);
      setTasks(tasksData);
      setSummary(summaryData);
    } catch (err) {
      console.error(err);
      setError('Failed to load tasks. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const refreshSummary = useCallback(async () => {
    try {
      const summaryData = await getTaskSummary();
      setSummary(summaryData);
    } catch (err) {
      console.error('Failed to refresh task summary', err);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const fetchAssignees = async () => {
      try {
        const assigneeList = await getAssignableUsers();
        setAssignees(assigneeList);
      } catch (err) {
        console.error(err);
        toast.error('Unable to load team members');
      }
    };
    fetchAssignees();
  }, []);

  const handleFiltersChange = (nextFilters: TaskFilters) => {
    setFilters(nextFilters);
  };

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
  };

  const handleRefresh = () => {
    loadTasks();
  };

  const openCreateForm = () => {
    setFormMode('create');
    setTaskForForm(null);
    setFormOpen(true);
  };

  const openEditForm = (task: Task) => {
    setFormMode('edit');
    setTaskForForm(task);
    setFormOpen(true);
  };

  const handleSelectTask = async (task: Task) => {
    setDetailLoading(true);
    try {
      const fullTask = await getTaskById(task.id);
      setSelectedTask(fullTask);
      setDetailOpen(true);
    } catch (err) {
      console.error(err);
      toast.error('Unable to load task details');
    } finally {
      setDetailLoading(false);
    }
  };

  const upsertTaskInList = useCallback((updated: Task) => {
    setTasks((prev) => {
      const exists = prev.some((task) => task.id === updated.id);
      if (exists) {
        return prev.map((task) => (task.id === updated.id ? { ...task, ...updated } : task));
      }
      return [updated, ...prev];
    });
  }, []);

  const handleFormSubmit = async (values: TaskFormValues) => {
    try {
      setFormSubmitting(true);
      if (formMode === 'create') {
        const created = await createTask({
          ...values,
          description: values.description ?? null,
        });
        toast.success('Task created successfully');
        setFormOpen(false);
        setTaskForForm(null);
        upsertTaskInList(created);
      } else if (formMode === 'edit' && taskForForm) {
        const updatedTask = await updateTask(taskForForm.id, {
          title: values.title,
          description: values.description ?? null,
          status: values.status,
          dueDate: values.dueDate ?? null,
        });
        const existingAssignees = taskForForm.assignees?.map((assignee) => assignee.id) ?? [];
        const shouldUpdateAssignments = !areIdListsEqual(existingAssignees, values.assigneeIds);

        const updated = shouldUpdateAssignments
          ? await updateTaskAssignments(taskForForm.id, values.assigneeIds)
          : { ...updatedTask, assignees: taskForForm.assignees };
        toast.success('Task updated successfully');
        setFormOpen(false);
        setTaskForForm(null);
        upsertTaskInList(updated);
        setSelectedTask((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated, notes: prev.notes } : prev));
      }
      await loadTasks();
    } catch (err) {
      console.error(err);
      toast.error('Failed to save task changes');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleToggleComplete = async (task: Task, completed: boolean) => {
    try {
      const updated = await toggleTaskCompletion(task.id, completed);
      upsertTaskInList(updated);
      setSelectedTask((prev) =>
        prev && prev.id === updated.id ? { ...prev, ...updated, notes: prev.notes } : prev
      );
      toast.success(completed ? 'Task marked as completed' : 'Task reopened');
      await refreshSummary();
    } catch (err) {
      console.error(err);
      toast.error('Failed to update task status');
    }
  };

  const handleDelete = async (task: Task) => {
    const confirm = window.confirm(`Delete task "${task.title}"? This action cannot be undone.`);
    if (!confirm) {
      return;
    }
    try {
      await deleteTask(task.id);
      setTasks((prev) => prev.filter((item) => item.id !== task.id));
      if (selectedTask?.id === task.id) {
        setDetailOpen(false);
        setSelectedTask(null);
      }
      toast.success('Task deleted');
      await loadTasks();
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete task');
    }
  };

  const handleAddNote = async (note: string) => {
    if (!selectedTask) {
      return;
    }
    try {
      const createdNote = await addTaskNote(selectedTask.id, note);
      setSelectedTask((prev) =>
        prev
          ? {
              ...prev,
              notes: [createdNote, ...(prev.notes ?? [])],
              noteCount: (prev.noteCount ?? 0) + 1,
              lastNoteAt: createdNote.createdAt,
            }
          : prev
      );
      setTasks((prev) =>
        prev.map((task) =>
          task.id === selectedTask.id
            ? { ...task, noteCount: task.noteCount + 1, lastNoteAt: createdNote.createdAt }
            : task
        )
      );
      toast.success('Note added');
    } catch (err) {
      console.error(err);
      toast.error('Failed to add note');
    }
  };

  const filtersMemo = useMemo(() => filters, [filters]);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <TaskSummaryWidget
          summary={summary}
          loading={loading && tasks.length === 0}
          onRefresh={handleRefresh}
        />

        <TaskCalendar tasks={tasks} loading={loading && tasks.length === 0} onSelectTask={handleSelectTask} />

        <Paper
          sx={{
            p: { xs: 2.5, md: 4 },
            borderRadius: 3,
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: '0 24px 60px -36px rgba(15, 23, 42, 0.45)',
            background: 'linear-gradient(145deg, rgba(15, 118, 110, 0.04) 0%, rgba(30, 64, 175, 0.05) 100%)',
          }}
        >
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
            <Box>
              <Typography variant="h4" gutterBottom>
                Tasks
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Manage assignments, due dates, and shared notes for your team.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" startIcon={<RefreshIcon />} onClick={handleRefresh}>
                Refresh
              </Button>
              <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateForm}>
                New task
              </Button>
            </Stack>
          </Stack>

          <Box sx={{ mt: 3 }}>
            <TaskFiltersComponent
              filters={filtersMemo}
              assignees={assignees}
              onChange={handleFiltersChange}
              onReset={resetFilters}
            />
          </Box>

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}

          <Box sx={{ mt: 3 }}>
            {loading && tasks.length === 0 ? (
              <Box display="flex" justifyContent="center" py={6}>
                <CircularProgress />
              </Box>
            ) : (
              <TaskList
                tasks={tasks}
                onSelect={handleSelectTask}
                onToggleComplete={handleToggleComplete}
                onEdit={openEditForm}
                onDelete={handleDelete}
              />
            )}
          </Box>
        </Paper>
      </Stack>

      <TaskDetailDialog
        open={detailOpen}
        task={selectedTask}
        loading={detailLoading}
        onClose={() => setDetailOpen(false)}
        onEdit={() => {
          if (selectedTask) {
            openEditForm(selectedTask);
          }
        }}
        onToggleComplete={(completed) =>
          selectedTask ? handleToggleComplete(selectedTask, completed) : Promise.resolve()
        }
        onAddNote={handleAddNote}
      />

      <TaskFormDialog
        open={formOpen}
        mode={formMode}
        initialTask={taskForForm}
        assignees={assignees}
        submitting={formSubmitting}
        onClose={() => setFormOpen(false)}
        onSubmit={handleFormSubmit}
      />
    </Container>
  );
};

export default TasksDashboardPage;

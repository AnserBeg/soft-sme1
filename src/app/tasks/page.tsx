"use client";

import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useMemo, useState } from "react";

type TaskStatus = "TODO" | "IN_PROGRESS" | "COMPLETED";
type TaskPriority = "LOW" | "MEDIUM" | "HIGH";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
};

type CreateTaskInput = {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
};

type UpdateTaskInput = Partial<Omit<CreateTaskInput, "title">> & {
  title?: string;
};

const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: "TODO", label: "To do" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
];

const priorityOptions: { value: TaskPriority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

function formatDate(dateString: string | null) {
  if (!dateString) {
    return "No due date";
  }

  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return "No due date";
  }

  return date.toLocaleDateString();
}

async function fetchTasks(): Promise<Task[]> {
  const response = await fetch("/api/tasks", {
    credentials: "include",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.error === "string" ? payload.error : "Failed to load tasks";
    throw new Error(message);
  }

  return response.json();
}

async function createTask(task: CreateTaskInput): Promise<Task> {
  const response = await fetch("/api/tasks", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(task),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.error === "string" ? payload.error : "Failed to create task";
    throw new Error(message);
  }

  return response.json();
}

async function updateTask(id: string, updates: UpdateTaskInput): Promise<Task> {
  const response = await fetch(`/api/tasks/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.error === "string" ? payload.error : "Failed to update task";
    throw new Error(message);
  }

  return response.json();
}

async function deleteTask(id: string): Promise<void> {
  const response = await fetch(`/api/tasks/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = typeof payload.error === "string" ? payload.error : "Failed to delete task";
    throw new Error(message);
  }
}

export default function TasksPage() {
  const { data: session, status } = useSession();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "ALL">("ALL");

  const {
    data: tasks,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["tasks"],
    queryFn: fetchTasks,
    enabled: status === "authenticated",
  });

  const createMutation = useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setTitle("");
      setDescription("");
      setDueDate("");
      setPriority("MEDIUM");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: UpdateTaskInput }) => updateTask(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const filteredTasks = useMemo(() => {
    if (!tasks) {
      return [];
    }

    if (statusFilter === "ALL") {
      return tasks;
    }

    return tasks.filter((task) => task.status === statusFilter);
  }, [tasks, statusFilter]);

  const handleCreateTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!title.trim()) {
      return;
    }

    const payload: CreateTaskInput = {
      title: title.trim(),
      description: description.trim() ? description.trim() : undefined,
      priority,
    };

    if (dueDate) {
      payload.dueDate = new Date(dueDate).toISOString();
    }

    createMutation.mutate(payload);
  };

  if (status === "loading") {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold text-gray-900">Task management</h1>
        <p className="text-gray-600">Checking your session…</p>
      </div>
    );
  }

  if (status === "unauthenticated" || !session) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold text-gray-900">Task management</h1>
        <p className="text-gray-600">
          Please sign in to create and manage your tasks.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <section className="rounded-lg bg-white p-6 shadow">
        <h1 className="text-3xl font-semibold text-gray-900">Task management</h1>
        <p className="mt-2 text-gray-600">
          Create new tasks, track their status, and stay on top of your priorities.
        </p>

        <form onSubmit={handleCreateTask} className="mt-6 space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="md:col-span-2">
              <label htmlFor="task-title" className="block text-sm font-medium text-gray-700">
                Task title
              </label>
              <input
                id="task-title"
                name="title"
                type="text"
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-2 w-full rounded-md border border-gray-300 px-4 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="What do you need to do?"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="task-description" className="block text-sm font-medium text-gray-700">
                Description (optional)
              </label>
              <textarea
                id="task-description"
                name="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                className="mt-2 w-full rounded-md border border-gray-300 px-4 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Add details that will help you complete this task."
              />
            </div>

            <div>
              <label htmlFor="task-priority" className="block text-sm font-medium text-gray-700">
                Priority
              </label>
              <select
                id="task-priority"
                name="priority"
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
                className="mt-2 w-full rounded-md border border-gray-300 px-4 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {priorityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="task-due-date" className="block text-sm font-medium text-gray-700">
                Due date
              </label>
              <input
                id="task-due-date"
                name="dueDate"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="mt-2 w-full rounded-md border border-gray-300 px-4 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {createMutation.error instanceof Error && (
            <p className="text-sm text-red-600">{createMutation.error.message}</p>
          )}

          <button
            type="submit"
            disabled={createMutation.isPending}
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {createMutation.isPending ? "Creating…" : "Add task"}
          </button>
        </form>
      </section>

      <section className="rounded-lg bg-white p-6 shadow">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">Your tasks</h2>
            <p className="text-gray-600">Review progress and keep everything moving forward.</p>
          </div>

          <div>
            <label htmlFor="status-filter" className="sr-only">
              Filter tasks by status
            </label>
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as TaskStatus | "ALL")}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="ALL">All statuses</option>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {isLoading && <p className="text-gray-600">Loading your tasks…</p>}

          {isError && error instanceof Error && (
            <p className="text-sm text-red-600">{error.message}</p>
          )}

          {!isLoading && !isError && filteredTasks.length === 0 && (
            <p className="text-gray-600">No tasks found. Add a task to get started.</p>
          )}

          {filteredTasks.map((task) => (
            <article
              key={task.id}
              className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition hover:border-blue-400"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">{task.title}</h3>
                  {task.description && (
                    <p className="mt-1 text-gray-600">{task.description}</p>
                  )}

                  <dl className="mt-3 grid gap-3 text-sm text-gray-600 sm:grid-cols-2">
                    <div>
                      <dt className="font-medium text-gray-500">Status</dt>
                      <dd className="mt-0.5 capitalize text-gray-900">
                        {statusOptions.find((option) => option.value === task.status)?.label ?? task.status}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">Priority</dt>
                      <dd className="mt-0.5 capitalize text-gray-900">
                        {priorityOptions.find((option) => option.value === task.priority)?.label ?? task.priority}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">Due</dt>
                      <dd className="mt-0.5 text-gray-900">{formatDate(task.dueDate)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-gray-500">Last updated</dt>
                      <dd className="mt-0.5 text-gray-900">{formatDate(task.updatedAt)}</dd>
                    </div>
                  </dl>
                </div>

                <div className="flex flex-col gap-3 md:w-56">
                  <div>
                    <label htmlFor={`status-${task.id}`} className="block text-sm font-medium text-gray-700">
                      Update status
                    </label>
                    <select
                      id={`status-${task.id}`}
                      value={task.status}
                      onChange={(event) =>
                        updateMutation.mutate({
                          id: task.id,
                          updates: { status: event.target.value as TaskStatus },
                        })
                      }
                      disabled={updateMutation.isPending}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {statusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor={`priority-${task.id}`} className="block text-sm font-medium text-gray-700">
                      Update priority
                    </label>
                    <select
                      id={`priority-${task.id}`}
                      value={task.priority}
                      onChange={(event) =>
                        updateMutation.mutate({
                          id: task.id,
                          updates: { priority: event.target.value as TaskPriority },
                        })
                      }
                      disabled={updateMutation.isPending}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {priorityOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(task.id)}
                    disabled={deleteMutation.isPending}
                    className="inline-flex items-center justify-center rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {deleteMutation.isPending ? "Removing…" : "Delete task"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

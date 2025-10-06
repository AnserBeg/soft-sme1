# Task Chat Messaging

The task messaging system enables team members assigned to a task to collaborate through a real-time chat panel. This document summarizes the backend schema, API endpoints, and frontend usage patterns introduced with the chat feature.

## Database schema

The migration `20240901000000_create_task_messages_table.sql` introduces the following tables:

- `tasks` – stores the core task metadata (title, status, priority, due dates, etc.).
- `task_participants` – links users to tasks, including read tracking fields (`last_read_at` and `last_read_message_id`).
- `task_messages` – stores chat messages for a task. Each message references both the parent task and the posting participant. JSONB columns support metadata and lightweight attachment payloads.

Triggers ensure `tasks.updated_at` is touched whenever a message is inserted, enabling chronological sorting and change detection.

## Backend endpoints

Routes are exposed under `/api/tasks` (see `soft-sme-backend/src/routes/taskRoutes.ts`). All endpoints require authentication, scope access to the caller’s company, and verify that the caller is assigned to the task via `task_participants`.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/tasks/:taskId` | Returns the task record, participant roster, and the caller’s participant entry. |
| `GET` | `/api/tasks/:taskId/messages` | Lists chat messages for the task. Supports incremental polling via the optional `after` query parameter. Response includes unread counts. |
| `POST` | `/api/tasks/:taskId/messages` | Posts a new chat message. Sanitizes metadata and attachment payloads. Automatically marks the sender’s messages as read. |
| `POST` | `/api/tasks/:taskId/messages/mark-read` | Updates read tracking for the caller and returns the latest unread count. |

See `TaskMessageService` for data-access helpers (ensuring participants exist, returning mapped DTOs, and maintaining read state).

## Frontend usage

`TaskDetailPage` embeds the `TaskChat` component next to the task metadata. The chat component:

- Polls `/api/tasks/:id/messages` on mount and every 15 seconds by default.
- Displays unread badges and surfaces toast notifications for incoming messages from other participants.
- Marks messages as read when the panel is active, keeping the unread indicator in sync with the backend.
- Provides manual refresh controls and handles optimistic scrolling for a conversation-style experience.

Shared types are available in `src/types/tasks.ts`, and API utilities live in `src/services/taskChatService.ts`.

### Running the migration manually

If you are applying the schema changes directly (for example, through pgAdmin), execute the SQL in `soft-sme-backend/migrations/20240901000000_create_task_messages_table.sql`. The script is idempotent and can be re-run safely; copy the full contents into a pgAdmin query window and run it against the application database.

## Testing

Automated coverage was added in `TaskMessageService.test.ts`, validating participant access checks, message mapping, message creation flows, and read-tracking behavior using a mocked query interface.

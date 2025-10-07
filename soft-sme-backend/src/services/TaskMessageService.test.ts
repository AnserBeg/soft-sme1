import { QueryResult, QueryResultRow } from 'pg';
import { TaskMessageService, TaskAccessError, TaskParticipant, Queryable } from './TaskMessageService';

describe('TaskMessageService', () => {
  class MockQueryable implements Queryable {
    public queryFn = jest.fn<Promise<QueryResult<QueryResultRow>>, [string, (any[] | undefined)]>();

    query<T extends QueryResultRow = QueryResultRow>(queryText: string, params?: any[]): Promise<QueryResult<T>> {
      return this.queryFn(queryText, params) as Promise<QueryResult<T>>;
    }
  }

  const participant: TaskParticipant = {
    id: 21,
    taskId: 42,
    userId: 7,
    role: 'participant',
    isWatcher: false,
    lastReadAt: null,
    lastReadMessageId: null,
    companyId: 3,
    taskTitle: 'Demo Task',
    taskStatus: 'open',
  };

  let mockDb: MockQueryable;
  let service: TaskMessageService;

  beforeEach(() => {
    mockDb = new MockQueryable();
    service = new TaskMessageService(mockDb);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('maps participant rows correctly', async () => {
    const now = new Date('2024-08-31T12:00:00Z');
    mockDb.queryFn.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          participant_id: participant.id,
          task_id: participant.taskId,
          user_id: participant.userId,
          role: participant.role,
          is_watcher: participant.isWatcher,
          last_read_at: now,
          last_read_message_id: 12,
          company_id: participant.companyId,
          task_title: participant.taskTitle,
          task_status: participant.taskStatus,
        },
      ],
    } as any);

    const result = await service.ensureParticipant(participant.taskId, participant.userId);
    expect(result).toEqual({
      ...participant,
      lastReadAt: now.toISOString(),
      lastReadMessageId: 12,
    });
    expect(mockDb.queryFn).toHaveBeenCalledWith(expect.stringContaining('FROM task_participants'), [participant.taskId, participant.userId]);
  });

  it('throws TaskAccessError when user is not participant', async () => {
    mockDb.queryFn.mockResolvedValueOnce({ rowCount: 0, rows: [] } as any);
    await expect(service.ensureParticipant(participant.taskId, participant.userId)).rejects.toBeInstanceOf(TaskAccessError);
  });

  it('returns formatted messages and unread count', async () => {
    const createdAt = new Date('2024-08-30T10:00:00Z');
    mockDb.queryFn
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 5,
            task_id: participant.taskId,
            participant_id: participant.id,
            content: 'Hello team',
            is_system: false,
            attachments: [],
            metadata: { kind: 'note' },
            created_at: createdAt,
            updated_at: createdAt,
            user_id: participant.userId,
            sender_name: 'Demo User',
            sender_email: 'demo@example.com',
          },
        ],
      } as any)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ unread: 2 }] } as any);

    const result = await service.listMessages(participant.taskId, participant);
    expect(result.unreadCount).toBe(2);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: 5,
      taskId: participant.taskId,
      participantId: participant.id,
      content: 'Hello team',
      metadata: { kind: 'note' },
      sender: {
        participantId: participant.id,
        userId: participant.userId,
        name: 'Demo User',
        email: 'demo@example.com',
      },
    });
  });

  it('creates a new message, touches task, and marks as read', async () => {
    const createdAt = new Date('2024-08-31T12:34:00Z');
    mockDb.queryFn
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 9,
            task_id: participant.taskId,
            participant_id: participant.id,
            content: 'New update',
            is_system: false,
            attachments: [],
            metadata: {},
            created_at: createdAt,
            updated_at: createdAt,
            user_id: participant.userId,
            sender_name: 'Demo User',
            sender_email: 'demo@example.com',
          },
        ],
      } as any)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] } as any)
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          { last_read_at: createdAt, last_read_message_id: 9 },
        ],
      } as any);

    const message = await service.createMessage(participant.taskId, participant, 'New update');
    expect(mockDb.queryFn).toHaveBeenCalledTimes(3);
    expect(mockDb.queryFn.mock.calls[0][0]).toContain('WITH inserted AS');
    expect(mockDb.queryFn.mock.calls[1][0]).toContain('UPDATE tasks');
    expect(mockDb.queryFn.mock.calls[2][0]).toContain('UPDATE task_participants');
    expect(message.content).toBe('New update');
    expect(message.id).toBe(9);
  });

  it('markRead resolves latest message when id is omitted', async () => {
    const latest = new Date('2024-08-31T13:00:00Z');
    mockDb.queryFn
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ max_id: 11 }] } as any)
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ last_read_at: latest, last_read_message_id: 11 }],
      } as any);

    const response = await service.markRead(participant);
    expect(mockDb.queryFn).toHaveBeenNthCalledWith(1, expect.stringContaining('SELECT MAX'), [participant.taskId]);
    expect(mockDb.queryFn).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE task_participants'), [11, participant.id]);
    expect(response).toEqual({ lastReadAt: latest.toISOString(), lastReadMessageId: 11 });
  });
});

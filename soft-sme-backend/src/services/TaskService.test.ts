import { TaskService, ServiceError } from './TaskService';

describe('TaskService validation', () => {
  const mockPool = {
    query: jest.fn(),
    connect: jest.fn(),
  } as any;
  const service = new TaskService(mockPool);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires a task title when creating', async () => {
    await expect(service.createTask(1, 1, { title: '   ' })).rejects.toThrow(ServiceError);
  });

  it('rejects an invalid status update', async () => {
    await expect(
      service.updateTask(1, 1, { status: 'invalid-status' as any })
    ).rejects.toThrow('Invalid task status');
  });

  it('rejects update requests without fields', async () => {
    await expect(service.updateTask(1, 1, {})).rejects.toThrow('No updates provided');
  });

  it('rejects invalid due date input', async () => {
    await expect(service.updateDueDate(1, 1, 'not-a-date')).rejects.toThrow('Invalid dueDate');
  });

  it('throws when toggling completion for missing task', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    await expect(service.toggleCompletion(10, 999, true)).rejects.toThrow('Task not found');
  });

  it('validates assignees when updating assignments', async () => {
    const mockClient = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT 1 FROM tasks')) {
          return { rows: [{ exists: true }] };
        }
        if (sql.includes('SELECT id FROM users')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };

    mockPool.connect.mockResolvedValue(mockClient);

    await expect(service.updateAssignments(1, 5, [3], 2)).rejects.toThrow('Invalid assignee');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

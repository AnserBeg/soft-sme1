import { buildTaskQueryParams } from './taskService';
import { TaskFilters } from '../types/task';

describe('buildTaskQueryParams', () => {
  it('returns empty object for undefined filters', () => {
    expect(buildTaskQueryParams()).toEqual({});
  });

  it('serializes filters into query parameters', () => {
    const filters: TaskFilters = {
      status: ['pending', 'in_progress'],
      assignedTo: 7,
      dueFrom: '2025-01-01',
      includeCompleted: true,
    };

    expect(buildTaskQueryParams(filters)).toEqual({
      status: 'pending,in_progress',
      assignedTo: '7',
      dueFrom: '2025-01-01',
      includeCompleted: 'true',
    });
  });

  it('omits falsy values and trims search input', () => {
    const filters: TaskFilters = {
      search: ' quote ',
      dueTo: '',
      includeArchived: false,
    };

    expect(buildTaskQueryParams(filters)).toEqual({
      search: 'quote',
      includeArchived: 'false',
    });
  });
});

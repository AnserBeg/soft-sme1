import { sanitizePlannerStreamEvent } from './plannerStreamService';

describe('plannerStreamService sanitizePlannerStreamEvent', () => {
  it('returns null for malformed planner_stream payloads', () => {
    const raw = ['id: 7', 'event: planner_stream', 'data: "None"'].join('\n');
    expect(sanitizePlannerStreamEvent(raw)).toBeNull();
  });

  it('normalizes valid planner_stream events', () => {
    const raw = ['id: 8', 'event: planner_stream', 'data: {"type":"event_batch","events":[]}'].join('\n');
    expect(sanitizePlannerStreamEvent(raw)).toBe(
      ['id: 8', 'event: planner_stream', 'data: {"type":"event_batch","events":[]}'].join('\n')
    );
  });

  it('ensures heartbeat events always include data', () => {
    expect(sanitizePlannerStreamEvent('event: heartbeat')).toBe('event: heartbeat\ndata: {}');
  });

  it('preserves error messages', () => {
    const raw = ['event: error', 'data: {"message":"planner exploded"}'].join('\n');
    expect(sanitizePlannerStreamEvent(raw)).toBe(
      ['event: error', 'data: {"message":"planner exploded"}'].join('\n')
    );
  });
});

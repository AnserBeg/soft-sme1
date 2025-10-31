import { buildPlannerUpdates } from '../plannerUpdates';
import type { PlannerStreamEvent } from '../../hooks/usePlannerStream';

describe('buildPlannerUpdates', () => {
  const baseEvent = (overrides: Partial<PlannerStreamEvent>): PlannerStreamEvent => ({
    sessionId: 'session-1',
    planStepId: overrides.planStepId ?? 'plan-1',
    sequence: overrides.sequence ?? 1,
    type: overrides.type ?? 'subagent_result',
    timestamp: overrides.timestamp ?? '2024-01-01T00:00:00Z',
    content: overrides.content ?? {},
    telemetry: overrides.telemetry ?? { trace_id: 'abc', span_id: 'def' },
  });

  it('derives updates for subagent results with revision awareness', () => {
    const events: PlannerStreamEvent[] = [
      baseEvent({
        sequence: 1,
        content: {
          stage: 'documentation',
          status: 'partial',
          revision: 1,
          summary: 'Drafted outline',
          result_key: 'docs',
        },
      }),
      baseEvent({
        sequence: 2,
        content: {
          stage: 'documentation',
          status: 'completed',
          revision: 2,
          summary: 'Finalized answer',
          result_key: 'docs',
        },
      }),
    ];

    const updates = buildPlannerUpdates(events);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      resultKey: 'docs',
      revision: 1,
      status: 'partial',
      summary: 'Drafted outline',
    });
    expect(updates[1]).toMatchObject({
      resultKey: 'docs',
      revision: 2,
      status: 'completed',
      summary: 'Finalized answer',
    });
  });

  it('deduplicates identical revision events and prefers latest sequence', () => {
    const events: PlannerStreamEvent[] = [
      baseEvent({
        sequence: 3,
        content: {
          stage: 'row_selection',
          status: 'partial',
          revision: 1,
          summary: 'Initial rows',
        },
      }),
      baseEvent({
        sequence: 4,
        content: {
          stage: 'row_selection',
          status: 'partial',
          revision: 1,
          summary: 'Refined rows',
        },
      }),
    ];

    const updates = buildPlannerUpdates(events);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      stageKey: 'row_selection',
      revision: 1,
      summary: 'Refined rows',
      sequence: 4,
    });
  });

  it('falls back to stage key when result key missing', () => {
    const events: PlannerStreamEvent[] = [
      baseEvent({
        sequence: 5,
        content: {
          key: 'action',
          status: 'completed',
          message: 'Performed action',
        },
      }),
    ];

    const [update] = buildPlannerUpdates(events);
    expect(update.resultKey).toBe('action');
    expect(update.message).toBe('Performed action');
  });

  it('normalizes latest revision updates with stable identifiers', () => {
    const events: PlannerStreamEvent[] = [
      baseEvent({
        sequence: 6,
        content: {
          stage: 'workflow',
          status: 'completed',
          summary: 'Ready for review',
        },
      }),
      baseEvent({
        sequence: 7,
        content: {
          stage: 'workflow',
          status: 'completed',
          summary: 'Ready for review',
        },
      }),
    ];

    const updates = buildPlannerUpdates(events);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      id: 'plan-1::workflow::latest',
      resultKey: 'workflow',
      summary: 'Ready for review',
      sequence: 7,
    });
  });

  it('preserves latest sequence when replayed events arrive out of order', () => {
    const replayedEvents: PlannerStreamEvent[] = [
      baseEvent({
        sequence: 10,
        content: {
          stage: 'documentation',
          status: 'completed',
          revision: 3,
          summary: 'Final answer',
        },
      }),
      baseEvent({
        sequence: 8,
        content: {
          stage: 'documentation',
          status: 'partial',
          revision: 3,
          summary: 'Stale replay',
        },
      }),
    ];

    const updates = buildPlannerUpdates(replayedEvents);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      summary: 'Final answer',
      sequence: 10,
      revision: 3,
    });
  });
});

import {
  applyPlannerEvents,
  initialPlannerStreamSummary,
  PlannerStreamEvent,
} from '../usePlannerStream';

describe('applyPlannerEvents', () => {
  const baseSummary = initialPlannerStreamSummary;

  const buildEvent = (overrides: Partial<PlannerStreamEvent>): PlannerStreamEvent => ({
    sessionId: '123',
    planStepId: 'step-1',
    sequence: overrides.sequence ?? 1,
    type: overrides.type ?? 'subagent_result',
    timestamp: overrides.timestamp ?? '2024-01-01T00:00:00Z',
    content: overrides.content ?? {},
    telemetry: overrides.telemetry ?? {},
  });

  it('hydrates expected subagents on step_started', () => {
    const stepEvent = buildEvent({
      sequence: 1,
      type: 'step_started',
      content: {
        status: 'pending',
        expected_subagents: [
          { key: 'documentation', result_key: 'docs' },
          { key: 'row_selection', result_key: null },
        ],
      },
    });

    const summary = applyPlannerEvents(baseSummary, [stepEvent]);

    expect(summary.subagentOrder).toEqual(['documentation', 'row_selection']);
    expect(summary.subagentsByKey.documentation).toMatchObject({
      key: 'documentation',
      status: 'pending',
      resultKey: 'docs',
    });
    expect(summary.subagentsByKey.row_selection).toMatchObject({
      key: 'row_selection',
      status: 'pending',
    });
    expect(summary.stepStatus).toBe('pending');
  });

  it('updates subagent status and payload on subagent_result', () => {
    const startEvent = buildEvent({
      sequence: 1,
      type: 'step_started',
      content: {
        status: 'pending',
        expected_subagents: [{ key: 'documentation' }],
      },
    });

    const resultEvent = buildEvent({
      sequence: 2,
      type: 'subagent_result',
      content: {
        stage: 'documentation',
        status: 'completed',
        payload: { answer: 'Ready' },
        revision: 2,
        result_key: 'docs-final',
      },
    });

    const summary = applyPlannerEvents(baseSummary, [startEvent, resultEvent]);

    expect(summary.subagentsByKey.documentation).toMatchObject({
      key: 'documentation',
      status: 'completed',
      payload: { answer: 'Ready' },
      revision: 2,
      resultKey: 'docs-final',
    });
    expect(summary.events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it('records completion payload on plan_step_completed', () => {
    const completionEvent = buildEvent({
      sequence: 3,
      type: 'plan_step_completed',
      content: {
        status: 'success',
        payload: { summary: 'done' },
      },
    });

    const summary = applyPlannerEvents(baseSummary, [completionEvent]);

    expect(summary.stepStatus).toBe('success');
    expect(summary.completedPayload).toEqual({ summary: 'done' });
  });

  it('ignores replayed events with duplicate sequence numbers', () => {
    const resultEvent = buildEvent({
      sequence: 4,
      type: 'subagent_result',
      content: {
        stage: 'action',
        status: 'completed',
      },
    });

    const firstPass = applyPlannerEvents(baseSummary, [resultEvent]);
    const replayed = applyPlannerEvents(firstPass, [resultEvent]);

    expect(replayed.events).toHaveLength(1);
    expect(replayed.events[0].sequence).toBe(4);
    expect(replayed.subagentsByKey.action).toMatchObject({ status: 'completed' });
  });

  it('retains newer optimistic payloads when replay arrives with older status', () => {
    const pending = buildEvent({
      sequence: 5,
      type: 'subagent_result',
      content: {
        stage: 'documentation',
        status: 'partial',
        payload: { summary: 'Draft 1' },
      },
    });

    const completed = buildEvent({
      sequence: 6,
      type: 'subagent_result',
      content: {
        stage: 'documentation',
        status: 'completed',
        payload: { summary: 'Final copy' },
      },
    });

    const summary = applyPlannerEvents(baseSummary, [pending, completed]);
    const replayedPending = applyPlannerEvents(summary, [pending]);

    expect(replayedPending.subagentsByKey.documentation).toMatchObject({
      status: 'completed',
      payload: { summary: 'Final copy' },
    });
    expect(replayedPending.events.map((event) => event.sequence)).toEqual([5, 6]);
  });
});

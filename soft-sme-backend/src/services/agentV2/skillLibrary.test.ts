import type { Pool } from 'pg';
import { AgentSkillLibraryService } from './skillLibrary';

describe('AgentSkillLibraryService', () => {
  const queryMock = jest.fn();
  const pool = { query: queryMock } as unknown as Pool;

  beforeEach(() => {
    queryMock.mockReset();
  });

  it('lists workflows ordered by updated_at', async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          id: 'wf-1',
          name: 'purchase_follow_up',
          version: 2,
          description: 'Follow up on vendor pickup',
          entrypoint: 'updatePickupDetails',
          parameters: { status: 'ready' },
          created_at: '2025-03-21T01:02:03Z',
          updated_at: '2025-03-22T04:05:06Z',
        },
      ],
    } as any);

    const service = new AgentSkillLibraryService(pool);
    const workflows = await service.listWorkflows();

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('FROM skill_workflows'),
    );
    expect(workflows).toEqual([
      expect.objectContaining({
        id: 'wf-1',
        name: 'purchase_follow_up',
        entrypoint: 'updatePickupDetails',
      }),
    ]);
  });

  it('upserts workflows with defaults', async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          id: 'wf-2',
          name: 'confirm_vendor_pickup',
          version: 1,
          description: null,
          entrypoint: 'updatePickupDetails',
          parameters: JSON.stringify({ pickup_ready: true }),
          created_at: '2025-03-21T02:00:00Z',
          updated_at: '2025-03-21T02:00:00Z',
        },
      ],
    } as any);

    const service = new AgentSkillLibraryService(pool);
    const workflow = await service.upsertWorkflow({
      name: ' confirm_vendor_pickup ',
      entrypoint: ' updatePickupDetails ',
      parameters: { pickup_ready: true },
    });

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (name, version)'),
      expect.arrayContaining(['confirm_vendor_pickup', 1, null, 'updatePickupDetails', JSON.stringify({ pickup_ready: true })])
    );
    expect(workflow).toEqual(
      expect.objectContaining({
        id: 'wf-2',
        name: 'confirm_vendor_pickup',
        version: 1,
      })
    );
  });

  it('records run reflections', async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          id: 'rr-1',
          skill_workflow_id: 'wf-1',
          run_id: 'run-123',
          outcome: 'completed',
          success: true,
          verification_payload: JSON.stringify({ status: 'success' }),
          latency_ms: 5200,
          created_at: '2025-03-21T03:00:00Z',
        },
      ],
    } as any);

    const service = new AgentSkillLibraryService(pool);
    const reflection = await service.recordRunReflection({
      skillWorkflowId: 'wf-1',
      runId: 'run-123',
      outcome: 'completed',
      success: true,
      verificationPayload: { status: 'success' },
      latencyMs: 5200,
    });

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO skill_run_reflections'),
      expect.arrayContaining(['wf-1', 'run-123', 'completed', true])
    );
    expect(reflection).toEqual(
      expect.objectContaining({
        runId: 'run-123',
        success: true,
        latencyMs: 5200,
      })
    );
  });
});

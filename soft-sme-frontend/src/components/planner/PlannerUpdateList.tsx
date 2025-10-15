import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Stack, Typography } from '@mui/material';
import type { PlannerStreamEvent } from '../../hooks/usePlannerStream';
import PlannerUpdateCard, { PlannerUpdateActionState } from './PlannerUpdateCard';
import { buildPlannerUpdates, PlannerUpdateItem } from '../../utils/plannerUpdates';
import { isPlannerActionableStatus } from '../../utils/plannerStatus';
import plannerService from '../../services/plannerService';
import plannerUiLogger from '../../utils/plannerUiLogger';

interface PlannerUpdateListProps {
  sessionId?: string | number | null;
  planStepId?: string | null;
  events: PlannerStreamEvent[];
}

type PlannerUpdateStateMap = Record<string, PlannerUpdateActionState>;

const PlannerUpdateList: React.FC<PlannerUpdateListProps> = ({ sessionId, planStepId, events }) => {
  const normalizedSessionId = sessionId != null ? String(sessionId) : undefined;
  const normalizedPlanStepId = planStepId != null ? String(planStepId) : undefined;

  const updates = useMemo<PlannerUpdateItem[]>(() => buildPlannerUpdates(events), [events]);
  const [actionStates, setActionStates] = useState<PlannerUpdateStateMap>({});

  useEffect(() => {
    setActionStates((current) => {
      const next: PlannerUpdateStateMap = {};
      for (const update of updates) {
        next[update.id] = current[update.id] ?? { pendingAction: null, acknowledged: false, dismissed: false, error: null };
      }
      return next;
    });
  }, [updates]);

  const handleAction = useCallback(
    async (update: PlannerUpdateItem, action: 'ack' | 'dismiss') => {
      setActionStates((current) => ({
        ...current,
        [update.id]: {
          ...current[update.id],
          pendingAction: action,
          error: null,
        },
      }));

      if (!normalizedSessionId || !normalizedPlanStepId) {
        setActionStates((current) => ({
          ...current,
          [update.id]: {
            ...current[update.id],
            pendingAction: null,
            error: 'Planner session is unavailable. Please retry after the stream reconnects.',
          },
        }));
        return;
      }

      const details = {
        sessionId: normalizedSessionId,
        planStepId: normalizedPlanStepId,
        resultKey: update.resultKey,
        revision: update.revision ?? null,
        sequence: update.sequence,
        status: update.status,
        stageKey: update.stageKey,
      };

      try {
        if (action === 'ack') {
          plannerUiLogger.action('planner_ui.ack_start', details);
          await plannerService.acknowledge({
            sessionId: normalizedSessionId,
            planStepId: normalizedPlanStepId,
            resultKey: update.resultKey,
            revision: update.revision,
            telemetry: update.telemetry,
            sequence: update.sequence,
          });
          plannerUiLogger.action('planner_ui.ack_success', details);
        } else {
          plannerUiLogger.action('planner_ui.dismiss_start', details);
          await plannerService.dismiss({
            sessionId: normalizedSessionId,
            planStepId: normalizedPlanStepId,
            resultKey: update.resultKey,
            revision: update.revision,
            telemetry: update.telemetry,
            sequence: update.sequence,
          });
          plannerUiLogger.action('planner_ui.dismiss_success', details);
        }

        setActionStates((current) => ({
          ...current,
          [update.id]: {
            ...current[update.id],
            pendingAction: null,
            acknowledged: action === 'ack' ? true : current[update.id]?.acknowledged,
            dismissed: action === 'dismiss' ? true : current[update.id]?.dismissed,
            error: null,
          },
        }));
      } catch (error) {
        plannerUiLogger.error(
          action === 'ack' ? 'planner_ui.ack_error' : 'planner_ui.dismiss_error',
          error,
          details
        );
        setActionStates((current) => ({
          ...current,
          [update.id]: {
            ...current[update.id],
            pendingAction: null,
            error:
              action === 'ack'
                ? 'Failed to acknowledge update. Please try again.'
                : 'Failed to dismiss update. Please try again.',
          },
        }));
      }
    },
    [normalizedSessionId, normalizedPlanStepId]
  );

  if (updates.length === 0) {
    return null;
  }

  return (
    <Stack spacing={1.5} sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary', pl: 0.5 }}>
        Planner updates
      </Typography>
      {updates.map((update) => {
        const state = actionStates[update.id];
        const baseDisabled = !normalizedSessionId || !normalizedPlanStepId;
        const actionable = isPlannerActionableStatus(update.status);
        const disabled = baseDisabled || !actionable;
        return (
          <PlannerUpdateCard
            key={update.id}
            update={update}
            disabled={disabled}
            onAcknowledge={() => handleAction(update, 'ack')}
            onDismiss={() => handleAction(update, 'dismiss')}
            actionState={state}
          />
        );
      })}
    </Stack>
  );
};

export default PlannerUpdateList;

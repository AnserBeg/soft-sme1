import React from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
  ChipProps,
} from '@mui/material';
import dayjs from 'dayjs';
import {
  PlannerStreamConnectionState,
  PlannerSubagentState,
} from '../hooks/usePlannerStream';
import {
  formatPlannerStageLabel,
  resolvePlannerStatusVisual,
} from '../utils/plannerStatus';

interface PlannerProgressPanelProps {
  subagents: PlannerSubagentState[];
  connectionState: PlannerStreamConnectionState;
  stepStatus?: string;
  plannerContext?: Record<string, any> | null;
  completedPayload?: Record<string, any> | null;
  replayComplete: boolean;
  lastHeartbeatAt?: string | null;
  isTerminal: boolean;
}

const connectionChip: Record<PlannerStreamConnectionState, { label: string; color: ChipProps['color'] }> = {
  idle: { label: 'Idle', color: 'default' },
  connecting: { label: 'Connecting…', color: 'info' },
  open: { label: 'Live', color: 'success' },
  reconnecting: { label: 'Reconnecting…', color: 'warning' },
  closed: { label: 'Closed', color: 'default' },
  error: { label: 'Error', color: 'error' },
};

const formatTimestamp = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return null;
  }
  return parsed.format('MMM D, YYYY h:mm:ss A');
};

const PlannerProgressPanel: React.FC<PlannerProgressPanelProps> = ({
  subagents,
  connectionState,
  stepStatus,
  plannerContext,
  completedPayload,
  replayComplete,
  lastHeartbeatAt,
  isTerminal,
}) => {
  const connection = connectionChip[connectionState];
  const hasSubagents = subagents.length > 0;
  const heartbeatLabel = formatTimestamp(lastHeartbeatAt);

  const overallStatus = stepStatus ? resolvePlannerStatusVisual(stepStatus) : null;

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 3,
        borderColor: 'divider',
        px: 2.5,
        py: 2,
        backgroundColor: 'background.paper',
        mb: 2,
      }}
    >
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Stack spacing={0.5}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Planner progress
            </Typography>
            {plannerContext?.plan_summary && (
              <Typography variant="caption" color="text.secondary">
                {plannerContext.plan_summary}
              </Typography>
            )}
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            {!replayComplete && connectionState !== 'error' && connectionState !== 'closed' ? (
              <CircularProgress size={18} thickness={5} />
            ) : null}
            <Chip size="small" variant="outlined" color={connection.color} label={connection.label} />
          </Stack>
        </Stack>

        {heartbeatLabel && (
          <Typography variant="caption" color="text.secondary">
            Last heartbeat: {heartbeatLabel}
          </Typography>
        )}

        <Stack spacing={1.25}>
          {hasSubagents ? (
            subagents.map((subagent) => {
              const details = resolvePlannerStatusVisual(subagent.status);
              return (
                <Paper
                  key={subagent.key}
                  variant="outlined"
                  sx={{
                    borderRadius: 2,
                    borderColor: 'divider',
                    px: 1.5,
                    py: 1,
                    backgroundColor: 'background.default',
                  }}
                >
                  <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between">
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <Box
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          backgroundColor: (theme) =>
                            theme.palette[details.color === 'default' ? 'grey' : details.color].light,
                          color: (theme) =>
                            theme.palette[details.color === 'default' ? 'grey' : details.color].main,
                        }}
                      >
                        {details.icon}
                      </Box>
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {formatPlannerStageLabel(subagent.key)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {details.label}
                          {subagent.resultKey ? ` · ${subagent.resultKey}` : ''}
                        </Typography>
                      </Box>
                    </Stack>
                    {subagent.payload && Object.keys(subagent.payload).length > 0 ? (
                      <Tooltip title={<pre style={{ margin: 0 }}>{JSON.stringify(subagent.payload, null, 2)}</pre>}>
                        <Chip size="small" label="Payload" variant="outlined" />
                      </Tooltip>
                    ) : null}
                  </Stack>
                </Paper>
              );
            })
          ) : (
            <Typography variant="body2" color="text.secondary">
              Waiting for planner updates…
            </Typography>
          )}
        </Stack>

        {overallStatus && (
          <Stack direction="row" spacing={1} alignItems="center">
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: '50%',
                backgroundColor: (theme) =>
                  theme.palette[overallStatus.color === 'default' ? 'grey' : overallStatus.color].light,
                color: (theme) =>
                  theme.palette[overallStatus.color === 'default' ? 'grey' : overallStatus.color].main,
              }}
            >
              {overallStatus.icon}
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Step status: {overallStatus.label}
            </Typography>
          </Stack>
        )}

        {isTerminal && completedPayload && Object.keys(completedPayload).length > 0 && (
          <Paper
            variant="outlined"
            sx={{
              borderRadius: 2,
              borderColor: 'divider',
              backgroundColor: 'background.default',
              px: 1.5,
              py: 1,
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              Final payload
            </Typography>
            <Typography
              variant="body2"
              sx={{ mt: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {completedPayload.summary ?? JSON.stringify(completedPayload, null, 2)}
            </Typography>
          </Paper>
        )}
      </Stack>
    </Paper>
  );
};

export default PlannerProgressPanel;

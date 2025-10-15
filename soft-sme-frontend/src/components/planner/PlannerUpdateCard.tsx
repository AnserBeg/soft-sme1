import React from 'react';
import {
  Box,
  Button,
  Chip,
  Fade,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import dayjs from 'dayjs';
import { formatPlannerStageLabel, resolvePlannerStatusVisual } from '../../utils/plannerStatus';
import type { PlannerUpdateItem } from '../../utils/plannerUpdates';

export interface PlannerUpdateActionState {
  pendingAction?: 'ack' | 'dismiss' | null;
  acknowledged?: boolean;
  dismissed?: boolean;
  error?: string | null;
}

interface PlannerUpdateCardProps {
  update: PlannerUpdateItem;
  onAcknowledge: () => void;
  onDismiss: () => void;
  disabled?: boolean;
  actionState?: PlannerUpdateActionState;
}

const PlannerUpdateCard: React.FC<PlannerUpdateCardProps> = ({
  update,
  onAcknowledge,
  onDismiss,
  disabled = false,
  actionState,
}) => {
  const visuals = resolvePlannerStatusVisual(update.status);
  const timestamp = dayjs(update.timestamp);
  const formattedTimestamp = timestamp.isValid() ? timestamp.format('MMM D, YYYY h:mm A') : null;
  const summary = update.summary || update.message || update.payload?.summary;
  const secondary = update.payload?.details || update.payload?.description || update.payload?.notes;

  const acknowledged = Boolean(actionState?.acknowledged);
  const dismissed = Boolean(actionState?.dismissed);
  const pendingAction = actionState?.pendingAction;
  const errorMessage = actionState?.error;

  const acknowledgeDisabled =
    disabled || dismissed || acknowledged || pendingAction === 'dismiss' || pendingAction === 'ack';
  const dismissDisabled =
    disabled || dismissed || acknowledged || pendingAction === 'ack' || pendingAction === 'dismiss';

  const payloadTooltip = update.payload && Object.keys(update.payload).length > 0 ? (
    <Tooltip
      title={
        <pre style={{ margin: 0, maxWidth: 320, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {JSON.stringify(update.payload, null, 2)}
        </pre>
      }
      placement="top"
      arrow
    >
      <Chip size="small" variant="outlined" label="Payload" />
    </Tooltip>
  ) : null;

  return (
    <Fade in timeout={300}>
      <Paper
        variant="outlined"
        sx={{
          borderRadius: 3,
          borderColor: dismissed ? 'error.light' : 'divider',
          backgroundColor: dismissed ? 'error.lighter' : 'background.paper',
          px: 2.5,
          py: 2,
        }}
      >
        <Stack spacing={1.5}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
            <Stack direction="row" spacing={1.25} alignItems="center">
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  backgroundColor: (theme) =>
                    theme.palette[visuals.color === 'default' ? 'grey' : visuals.color].light,
                  color: (theme) => theme.palette[visuals.color === 'default' ? 'grey' : visuals.color].main,
                }}
              >
                {visuals.icon}
              </Box>
              <Stack>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {formatPlannerStageLabel(update.stageKey)}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip size="small" color={visuals.color} label={visuals.label} variant="outlined" />
                  {update.revision != null && (
                    <Chip size="small" label={`Revision ${update.revision}`} variant="outlined" />
                  )}
                  {typeof update.retryCount === 'number' && update.retryCount > 0 && (
                    <Chip size="small" color="warning" label={`Retry ${update.retryCount}`} variant="outlined" />
                  )}
                  {payloadTooltip}
                </Stack>
              </Stack>
            </Stack>
            {formattedTimestamp && (
              <Typography variant="caption" color="text.secondary">
                {formattedTimestamp}
              </Typography>
            )}
          </Stack>

          {summary && (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {summary}
            </Typography>
          )}

          {secondary && (
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
              {secondary}
            </Typography>
          )}

          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant={acknowledged ? 'contained' : 'outlined'}
              color="success"
              disabled={acknowledgeDisabled}
              onClick={onAcknowledge}
              sx={{ textTransform: 'none', borderRadius: 999, px: 2 }}
            >
              {acknowledged ? 'Acknowledged' : pendingAction === 'ack' ? 'Acknowledging…' : 'Acknowledge'}
            </Button>
            <Button
              size="small"
              variant={dismissed ? 'contained' : 'outlined'}
              color="error"
              disabled={dismissDisabled}
              onClick={onDismiss}
              sx={{ textTransform: 'none', borderRadius: 999, px: 2 }}
            >
              {dismissed ? 'Dismissed' : pendingAction === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
            </Button>
          </Stack>

          {errorMessage && (
            <Typography variant="caption" color="error">
              {errorMessage}
            </Typography>
          )}
        </Stack>
      </Paper>
    </Fade>
  );
};

export default PlannerUpdateCard;

import React from 'react';
import type { ChipProps } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorIcon from '@mui/icons-material/ErrorOutline';
import HourglassIcon from '@mui/icons-material/HourglassEmpty';
import PendingIcon from '@mui/icons-material/Pending';
import WarningIcon from '@mui/icons-material/WarningAmber';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import AutorenewIcon from '@mui/icons-material/Autorenew';

export interface PlannerStatusVisual {
  icon: React.ReactNode;
  color: ChipProps['color'];
  label: string;
}

const STATUS_MAP: Record<string, PlannerStatusVisual> = {
  pending: { icon: <PendingIcon fontSize="small" />, color: 'default', label: 'Pending' },
  in_progress: { icon: <AutorenewIcon fontSize="small" />, color: 'info', label: 'In progress' },
  running: { icon: <AutorenewIcon fontSize="small" />, color: 'info', label: 'In progress' },
  partial: { icon: <WarningIcon fontSize="small" />, color: 'warning', label: 'Partial' },
  partial_success: { icon: <WarningIcon fontSize="small" />, color: 'warning', label: 'Partial' },
  completed: { icon: <CheckCircleIcon fontSize="small" />, color: 'success', label: 'Completed' },
  success: { icon: <CheckCircleIcon fontSize="small" />, color: 'success', label: 'Completed' },
  timeout: { icon: <HourglassIcon fontSize="small" />, color: 'warning', label: 'Timed out' },
  error: { icon: <ErrorIcon fontSize="small" />, color: 'error', label: 'Error' },
  failed: { icon: <ErrorIcon fontSize="small" />, color: 'error', label: 'Error' },
  failure: { icon: <ErrorIcon fontSize="small" />, color: 'error', label: 'Error' },
  degraded: { icon: <WarningIcon fontSize="small" />, color: 'warning', label: 'Degraded' },
  cancelled: { icon: <WarningIcon fontSize="small" />, color: 'warning', label: 'Cancelled' },
  canceled: { icon: <WarningIcon fontSize="small" />, color: 'warning', label: 'Cancelled' },
  retry: { icon: <AutorenewIcon fontSize="small" />, color: 'warning', label: 'Retrying' },
};

export const resolvePlannerStatusVisual = (status?: string): PlannerStatusVisual => {
  const normalized = (status || '').trim().toLowerCase();
  if (normalized && STATUS_MAP[normalized]) {
    return STATUS_MAP[normalized];
  }
  return {
    icon: <FiberManualRecordIcon fontSize="small" />,
    color: 'default',
    label: status || 'Unknown',
  };
};

export const formatPlannerStageLabel = (value: string): string => {
  if (!value) {
    return 'Subagent';
  }
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

export const isPlannerActionableStatus = (status?: string): boolean => {
  if (!status) {
    return false;
  }
  const normalized = status.trim().toLowerCase();
  return ['partial', 'partial_success', 'completed', 'success', 'error', 'failed', 'failure', 'degraded'].includes(normalized);
};


interface PlannerUiLogPayload {
  action: string;
  details?: Record<string, any>;
  level?: 'info' | 'error';
  error?: unknown;
}

const emitLog = ({ action, details = {}, level = 'info', error }: PlannerUiLogPayload) => {
  const payload = {
    action,
    ...details,
    timestamp: new Date().toISOString(),
  };

  if (level === 'error') {
    if (import.meta.env.DEV) {
      console.error('[planner-ui]', action, payload, error);
    }
    return;
  }

  if (import.meta.env.DEV) {
    console.debug('[planner-ui]', action, payload);
  }
};

export const plannerUiLogger = {
  action(action: string, details?: Record<string, any>) {
    emitLog({ action, details, level: 'info' });
  },
  error(action: string, error: unknown, details?: Record<string, any>) {
    emitLog({ action, details, level: 'error', error });
  },
};

export default plannerUiLogger;

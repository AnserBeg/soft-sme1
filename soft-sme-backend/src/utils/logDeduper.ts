import { logger } from './logger';

type Level = 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'fatal';

interface State {
  lastLoggedAt: number;
  suppressed: number;
}

const states = new Map<string, State>();
const DEFAULT_INTERVAL_MS = Number(process.env.LOG_DEDUPE_INTERVAL_MS || 30000);

export function dedupedLog(
  key: string,
  level: Level,
  msg: string,
  meta?: Record<string, any>,
  minIntervalMs: number = DEFAULT_INTERVAL_MS
) {
  const now = Date.now();
  const st = states.get(key);

  if (!st) {
    states.set(key, { lastLoggedAt: now, suppressed: 0 });
    (logger as any)[level](msg, meta);
    return;
  }

  if (now - st.lastLoggedAt >= minIntervalMs) {
    const suppressedInfo = st.suppressed > 0 ? ` (suppressed ${st.suppressed} repeats)` : '';
    st.lastLoggedAt = now;
    st.suppressed = 0;
    (logger as any)[level](`${msg}${suppressedInfo}`, meta);
  } else {
    st.suppressed += 1;
  }
}

export function dedupedError(
  key: string,
  msg: string,
  err?: unknown,
  extra?: Record<string, any>,
  minIntervalMs?: number
) {
  const meta = {
    ...extra,
    err: logger.serializeError(err),
  };
  dedupedLog(key, 'error', msg, meta, minIntervalMs);
}


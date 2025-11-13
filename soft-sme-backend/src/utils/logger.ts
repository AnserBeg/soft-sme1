import { inspect } from 'util';

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const levelOrder: Record<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

const envLevel = (process.env.LOG_LEVEL || process.env.NODE_ENV === 'production' ? 'info' : 'debug') as LogLevel;
const currentLevel = levelOrder[envLevel] ?? levelOrder.info;

const REDACT_KEYS = new Set([
  'password',
  'authorization',
  'cookie',
  'set-cookie',
  'sessiontoken',
  'refreshtoken',
  'token',
  'apikey',
  'api-key',
]);

function redactValue(key: string, value: any): any {
  if (REDACT_KEYS.has(key.toLowerCase())) {
    return '[REDACTED]';
  }
  // Heuristic: keys containing token/key/secret
  const lowered = key.toLowerCase();
  if (lowered.includes('token') || lowered.includes('secret') || lowered.includes('key')) {
    return '[REDACTED]';
  }
  return value;
}

function redact(obj: any, depth = 0): any {
  if (obj == null) return obj;
  if (typeof obj !== 'object') return obj;
  if (depth > 4) return '[Object]';

  if (Array.isArray(obj)) return obj.map((v) => redact(v, depth + 1));

  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = redactValue(k, redact(v, depth + 1));
  }
  return out;
}

function serializeError(err: unknown): Record<string, any> {
  if (!err) return { message: 'Unknown error' };
  if (err instanceof Error) {
    const anyErr = err as any;
    return redact({
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: anyErr.code,
      detail: anyErr.detail,
      hint: anyErr.hint,
      severity: anyErr.severity,
      position: anyErr.position,
    });
  }
  if (typeof err === 'object') return redact(err);
  return { message: String(err) };
}

function log(level: LogLevel, msg: string, meta?: Record<string, any>) {
  if (levelOrder[level] > currentLevel) return;
  const time = new Date().toISOString();
  const base = { level, time, msg } as Record<string, any>;
  const payload = meta ? { ...base, ...redact(meta) } : base;
  // Structured JSON for production; pretty-ish for dev
  if (process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  } else {
    const colored = `[${payload.time}] ${level.toUpperCase()} ${payload.msg}`;
    // eslint-disable-next-line no-console
    console.log(colored, inspect(payload, { depth: 4, colors: false }));
  }
}

export const logger = {
  level: envLevel,
  fatal: (msg: string, meta?: Record<string, any>) => log('fatal', msg, meta),
  error: (msg: string, meta?: Record<string, any>) => log('error', msg, meta),
  warn: (msg: string, meta?: Record<string, any>) => log('warn', msg, meta),
  info: (msg: string, meta?: Record<string, any>) => log('info', msg, meta),
  debug: (msg: string, meta?: Record<string, any>) => log('debug', msg, meta),
  trace: (msg: string, meta?: Record<string, any>) => log('trace', msg, meta),
  serializeError,
};

export type Logger = typeof logger;


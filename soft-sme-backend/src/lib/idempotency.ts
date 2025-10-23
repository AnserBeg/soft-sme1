import { createHash } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const EXCLUDED_KEYS = new Set(
  [
    'idempotency_key',
    'x-idempotency-key',
    'request_id',
    'trace_id',
    'client_timestamp',
    'client_time',
  ].map((key) => key.toLowerCase())
);

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface IdempotentWriteArgs<TWorkResult, TDeterministicResult> {
  db: Pool;
  client?: PoolClient;
  toolName: string;
  tenantId?: string | null;
  targetId?: string | null;
  idempotencyKey: string;
  requestPayload: unknown;
  work: () => Promise<TWorkResult>;
  buildDeterministicResult: (
    workResult: TWorkResult
  ) => TDeterministicResult | Promise<TDeterministicResult>;
  timeoutMs?: number;
}

export type IdempotentWriteResult<T> = T | { status: 'processing' };

export class IdempotencyError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'IdempotencyError';
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeValue(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return collapseWhitespace(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item)) as JsonValue[];
  }

  if (typeof value === 'object') {
    const normalizedEntries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !EXCLUDED_KEYS.has(key.toLowerCase()))
      .filter(([, val]) => typeof val !== 'undefined')
      .map(([key, val]) => [key, normalizeValue(val)] as [string, JsonValue])
      .sort(([a], [b]) => a.localeCompare(b));

    const ordered: Record<string, JsonValue> = {};
    for (const [key, val] of normalizedEntries) {
      ordered[key] = val;
    }

    return ordered;
  }

  return collapseWhitespace(String(value));
}

export function canonicalizePayload(input: unknown): string {
  const normalized = normalizeValue(input);
  return JSON.stringify(normalized);
}

export function hashCanonicalPayload(json: string): string {
  return createHash('sha256').update(json).digest('hex');
}

export function extractIdempotencyKeyFromArgs(
  args: Record<string, unknown> | null | undefined
): string {
  if (args && typeof args === 'object') {
    const rawSnake = args['idempotency_key'];
    if (typeof rawSnake === 'string' && rawSnake.trim().length > 0) {
      return rawSnake.trim();
    }

    const rawCamel = (args as Record<string, unknown>)['idempotencyKey'];
    if (typeof rawCamel === 'string' && rawCamel.trim().length > 0) {
      return rawCamel.trim();
    }
  }

  return uuidv4();
}

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[idempotency] rollback failed', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

const IDEMPOTENCY_STATUS = {
  IN_PROGRESS: 'in_progress',
  SUCCEEDED: 'succeeded',
  FAILED_PERMANENT: 'failed_permanent',
} as const;

type IdempotencyRow = {
  id: number;
  tenant_id: string | null;
  tool_name: string;
  target_id: string | null;
  idempotency_key: string;
  request_hash: string;
  status: string;
  result_json: any;
};

function parseResultJson(value: unknown): any {
  if (value === null || typeof value === 'undefined') {
    return null;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      return value;
    }
  }

  return value;
}

async function fetchIdempotencyRow(
  pool: Pool,
  toolName: string,
  idempotencyKey: string
): Promise<IdempotencyRow | null> {
  const result = await pool.query<IdempotencyRow>(
    `SELECT id, tenant_id, tool_name, target_id, idempotency_key, request_hash, status, result_json
       FROM idempotency_keys
      WHERE tool_name = $1 AND idempotency_key = $2`,
    [toolName, idempotencyKey]
  );
  if (result.rowCount === 0) {
    return null;
  }
  const row = result.rows[0];
  return {
    ...row,
    result_json: parseResultJson(row.result_json),
  };
}

function isBusinessError(error: unknown): error is { message: string; statusCode?: number } {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybe = error as { statusCode?: unknown };
  if (typeof maybe.statusCode === 'number') {
    return maybe.statusCode >= 400 && maybe.statusCode < 500;
  }

  return false;
}

function ensureMatchingHash(existing: IdempotencyRow, requestHash: string): void {
  if (existing.request_hash !== requestHash) {
    throw new IdempotencyError(409, 'Idempotency key already used with different payload');
  }
}

async function pollForResult<T>(
  pool: Pool,
  toolName: string,
  idempotencyKey: string,
  requestHash: string,
  timeoutMs: number
): Promise<IdempotentWriteResult<T>> {
  const deadline = Date.now() + timeoutMs;
  const interval = Math.min(250, Math.max(50, timeoutMs / 10));

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    const row = await fetchIdempotencyRow(pool, toolName, idempotencyKey);
    if (!row) {
      continue;
    }

    ensureMatchingHash(row, requestHash);

    if (row.status === IDEMPOTENCY_STATUS.SUCCEEDED) {
      return row.result_json as T;
    }

    if (row.status === IDEMPOTENCY_STATUS.FAILED_PERMANENT) {
      const errorPayload = row.result_json || {};
      const message =
        typeof errorPayload?.error?.message === 'string'
          ? errorPayload.error.message
          : 'Request previously failed';
      const statusCode =
        typeof errorPayload?.error?.statusCode === 'number'
          ? errorPayload.error.statusCode
          : 400;
      throw new IdempotencyError(statusCode, message);
    }
  }

  return { status: 'processing' };
}

async function updateStatus(
  runner: Pool | PoolClient,
  toolName: string,
  idempotencyKey: string,
  status: string,
  resultPayload: unknown,
  targetId?: string | null
): Promise<void> {
  const sets: string[] = ['status = $1', 'result_json = $2'];
  const params: unknown[] = [status, resultPayload ?? null];

  if (typeof targetId !== 'undefined') {
    sets.push(`target_id = $${sets.length + 1}`);
    params.push(targetId);
  }

  const updateQuery = `
    UPDATE idempotency_keys
       SET ${sets.join(', ')}, updated_at = NOW()
     WHERE tool_name = $${params.length + 1}
       AND idempotency_key = $${params.length + 2}
  `;

  params.push(toolName, idempotencyKey);

  await runner.query(updateQuery, params);
}

export async function idempotentWrite<TWorkResult, TDeterministicResult>(
  args: IdempotentWriteArgs<TWorkResult, TDeterministicResult>
): Promise<IdempotentWriteResult<TDeterministicResult>> {
  const {
    db,
    client,
    toolName,
    tenantId = null,
    targetId,
    idempotencyKey,
    requestPayload,
    work,
    buildDeterministicResult,
    timeoutMs = 2000,
  } = args;

  const canonicalPayload = canonicalizePayload(requestPayload);
  const requestHash = hashCanonicalPayload(canonicalPayload);

  const runner = client ?? db;

  const insertResult = await runner.query<IdempotencyRow>(
    `INSERT INTO idempotency_keys (tenant_id, tool_name, target_id, idempotency_key, request_hash, status, result_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tool_name, idempotency_key) DO NOTHING
     RETURNING id, tenant_id, tool_name, target_id, idempotency_key, request_hash, status, result_json`,
    [tenantId, toolName, targetId ?? null, idempotencyKey, requestHash, IDEMPOTENCY_STATUS.IN_PROGRESS, null]
  );

  if (insertResult.rowCount === 0) {
    const existing = await fetchIdempotencyRow(db, toolName, idempotencyKey);
    if (!existing) {
      throw new IdempotencyError(500, 'Failed to load existing idempotency record');
    }

    ensureMatchingHash(existing, requestHash);

    if (existing.status === IDEMPOTENCY_STATUS.SUCCEEDED) {
      return existing.result_json as TDeterministicResult;
    }

    if (existing.status === IDEMPOTENCY_STATUS.FAILED_PERMANENT) {
      const payload = existing.result_json || {};
      const message =
        typeof payload?.error?.message === 'string'
          ? payload.error.message
          : 'Request previously failed';
      const statusCode =
        typeof payload?.error?.statusCode === 'number'
          ? payload.error.statusCode
          : 400;
      throw new IdempotencyError(statusCode, message);
    }

    return pollForResult<TDeterministicResult>(db, toolName, idempotencyKey, requestHash, timeoutMs);
  }

  const insertedRow = insertResult.rows[0];
  const baseRow: IdempotencyRow = {
    ...insertedRow,
    result_json: parseResultJson(insertedRow.result_json),
  };

  ensureMatchingHash(baseRow, requestHash);

  try {
    const workResult = await work();
    const deterministic = await buildDeterministicResult(workResult);

    await updateStatus(runner, toolName, idempotencyKey, IDEMPOTENCY_STATUS.SUCCEEDED, deterministic, targetId);

    return deterministic;
  } catch (error) {
    const isBizError = isBusinessError(error);
    const statusCode = isBizError ? (error as { statusCode?: number }).statusCode ?? 400 : 500;
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'Unexpected error during idempotent work';

    const payload = { error: { message, statusCode } };

    await updateStatus(
      runner,
      toolName,
      idempotencyKey,
      IDEMPOTENCY_STATUS.FAILED_PERMANENT,
      payload,
      targetId
    );

    if (isBizError) {
      throw new IdempotencyError(statusCode, message);
    }

    throw error;
  }
}

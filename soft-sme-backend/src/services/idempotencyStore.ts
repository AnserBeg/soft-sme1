import { pool } from '../db';
import { hashCanonicalJson } from './safeWrite';

export interface IdempotencyRecord {
  scope: string;
  key: string;
  requestHash: string;
  response: unknown | null;
  createdAt: Date;
}

type SchemaMode = 'simple' | 'legacy';

let schemaModePromise: Promise<SchemaMode> | null = null;

async function detectSchemaMode(): Promise<SchemaMode> {
  if (!schemaModePromise) {
    schemaModePromise = (async () => {
      try {
        const result = await pool.query<{
          column_name: string;
        }>(
          `SELECT column_name
             FROM information_schema.columns
            WHERE table_name = 'idempotency_keys'
              AND column_name IN ('scope', 'key')`
        );
        const columnNames = new Set(result.rows.map((row) => row.column_name));
        if (columnNames.has('scope') && columnNames.has('key')) {
          return 'simple';
        }
      } catch (error) {
        console.warn('[idempotencyStore] Failed to inspect idempotency_keys schema', error);
      }
      return 'legacy';
    })();
  }

  return schemaModePromise;
}

function parseResponse(value: unknown): unknown {
  if (value === null || value === undefined) {
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

function serializeResponse(response: unknown): string | null {
  if (response === undefined || response === null) {
    return null;
  }

  return JSON.stringify(response);
}

export function hashRequestBody(body: unknown): string {
  return hashCanonicalJson(body);
}

export async function get(scope: string, key: string): Promise<IdempotencyRecord | null> {
  const mode = await detectSchemaMode();

  if (mode === 'simple') {
    const result = await pool.query<{
      scope: string;
      key: string;
      request_hash: string;
      response: unknown;
      created_at: Date;
    }>(
      'SELECT scope, "key", request_hash, response, created_at FROM idempotency_keys WHERE scope = $1 AND "key" = $2',
      [scope, key]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      scope: row.scope,
      key: row.key,
      requestHash: row.request_hash,
      response: parseResponse(row.response),
      createdAt: new Date(row.created_at),
    };
  }

  const result = await pool.query<{
    scope: string;
    key: string;
    request_hash: string;
    response: unknown;
    created_at: Date;
  }>(
    `SELECT tool_name AS scope,
            idempotency_key AS key,
            request_hash,
            result_json AS response,
            created_at
       FROM idempotency_keys
      WHERE tool_name = $1 AND idempotency_key = $2`,
    [scope, key]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    scope: row.scope,
    key: row.key,
    requestHash: row.request_hash,
    response: parseResponse(row.response),
    createdAt: new Date(row.created_at),
  };
}

export async function put(
  scope: string,
  key: string,
  requestHash: string,
  response: unknown
): Promise<IdempotencyRecord> {
  const mode = await detectSchemaMode();
  const responseJson = serializeResponse(response);

  if (mode === 'simple') {
    const result = await pool.query<{
      scope: string;
      key: string;
      request_hash: string;
      response: unknown;
      created_at: Date;
    }>(
      `INSERT INTO idempotency_keys (scope, "key", request_hash, response)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (scope, "key") DO UPDATE
         SET request_hash = EXCLUDED.request_hash,
             response = EXCLUDED.response
       RETURNING scope, "key", request_hash, response, created_at`,
      [scope, key, requestHash, responseJson]
    );

    const row = result.rows[0];
    return {
      scope: row.scope,
      key: row.key,
      requestHash: row.request_hash,
      response: parseResponse(row.response),
      createdAt: new Date(row.created_at),
    };
  }

  const result = await pool.query<{
    scope: string;
    key: string;
    request_hash: string;
    response: unknown;
    created_at: Date;
  }>(
    `INSERT INTO idempotency_keys (tenant_id, tool_name, target_id, idempotency_key, request_hash, status, result_json)
     VALUES (NULL, $1, NULL, $2, $3, 'succeeded', $4::jsonb)
     ON CONFLICT (tool_name, idempotency_key) DO UPDATE
       SET request_hash = EXCLUDED.request_hash,
           status = 'succeeded',
           result_json = EXCLUDED.result_json,
           updated_at = NOW()
     RETURNING tool_name AS scope,
               idempotency_key AS key,
               request_hash,
               result_json AS response,
               created_at`,
    [scope, key, requestHash, responseJson]
  );

  const row = result.rows[0];
  return {
    scope: row.scope,
    key: row.key,
    requestHash: row.request_hash,
    response: parseResponse(row.response),
    createdAt: new Date(row.created_at),
  };
}

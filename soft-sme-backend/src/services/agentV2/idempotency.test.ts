import type { Pool } from 'pg';
import { idempotentWrite } from '../../lib/idempotency';

let newDb: any;
let pgMemAvailable = true;
try {
  ({ newDb } = require('pg-mem'));
} catch (error) {
  pgMemAvailable = false;
  console.warn('pg-mem is not available; skipping idempotency smoke tests.');
}

const createIdempotencyTable = (db: any) => {
  db.public.none(`
    CREATE TABLE idempotency_keys (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NULL,
      tool_name TEXT NOT NULL,
      target_id TEXT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX idx_idem_unique ON idempotency_keys(tool_name, idempotency_key);
  `);
};

describe('agent idempotency smoke tests', () => {
  if (!pgMemAvailable) {
    it.skip('skipped due to missing pg-mem dependency', () => {
      expect(true).toBe(true);
    });
    return;
  }

  const db = newDb({ autoCreateForeignKeyIndices: true });
  createIdempotencyTable(db);
  const pg = db.adapters.createPg();
  const pool = new pg.Pool() as unknown as Pool;

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE idempotency_keys RESTART IDENTITY');
  });

  const basePayload = {
    customer_id: 1,
    product_name: 'Custom Bed',
    estimated_cost: 5000,
  };

  const runWrite = (payload = basePayload) =>
    idempotentWrite({
      db: pool,
      toolName: 'quote.create',
      idempotencyKey: 'key-1',
      requestPayload: payload,
      work: async () => ({
        quote_id: 42,
        quote_number: 'QO-TEST',
        total: 5000,
      }),
      buildDeterministicResult: (result) => ({
        id: result.quote_id,
        number: result.quote_number,
        status: 'Open',
        total: result.total,
      }),
    });

  it('reuses stored results when the payload is identical', async () => {
    let workCalls = 0;
    const write = () =>
      idempotentWrite({
        db: pool,
        toolName: 'quote.create',
        idempotencyKey: 'key-1',
        requestPayload: basePayload,
        work: async () => {
          workCalls += 1;
          return {
            quote_id: 42,
            quote_number: 'QO-TEST',
            total: 5000,
          };
        },
        buildDeterministicResult: (result) => ({
          id: result.quote_id,
          number: result.quote_number,
          status: 'Open',
          total: result.total,
        }),
      });

    const first = await write();
    const second = await write();

    expect(workCalls).toBe(1);
    expect(second).toEqual(first);

    const rows = await pool.query('SELECT result_json FROM idempotency_keys WHERE tool_name = $1', ['quote.create']);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].result_json).toEqual(first);
  });

  it('rejects conflicting payloads for the same key', async () => {
    await runWrite();

    await expect(
      runWrite({ ...basePayload, estimated_cost: 6000 })
    ).rejects.toEqual(expect.objectContaining({ statusCode: 409 }));

    const rows = await pool.query('SELECT result_json FROM idempotency_keys');
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].result_json.total).toBe(5000);
  });
});

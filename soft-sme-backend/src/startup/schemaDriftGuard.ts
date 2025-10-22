import type { PoolClient } from 'pg';
import { pool } from '../db';

const REQUIRED_COLUMNS: Record<string, string[]> = {
  quotes: [
    'quote_id',
    'quote_number',
    'customer_id',
    'quote_date',
    'valid_until',
    'product_name',
    'product_description',
    'estimated_cost',
    'status',
    'sequence_number',
    'terms',
    'customer_po_number',
    'vin_number',
    'vehicle_make',
    'vehicle_model',
    'notes',
    'updated_at',
  ],
  salesorderhistory: [
    'sales_order_id',
    'sales_order_number',
    'customer_id',
    'sales_date',
    'product_name',
    'product_description',
    'terms',
    'customer_po_number',
    'vin_number',
    'vehicle_make',
    'vehicle_model',
    'invoice_status',
    'subtotal',
    'total_gst_amount',
    'total_amount',
    'status',
    'estimated_cost',
    'sequence_number',
    'quote_id',
    'source_quote_number',
    'due_date',
    'notes',
    'created_at',
    'updated_at',
  ],
  purchasehistory: [
    'purchase_id',
    'vendor_id',
    'purchase_number',
    'purchase_date',
    'bill_number',
    'status',
    'subtotal',
    'total_gst_amount',
    'total_amount',
    'gst_rate',
    'pickup_notes',
    'pickup_time',
    'pickup_location',
    'pickup_contact_person',
    'pickup_phone',
    'pickup_instructions',
    'created_at',
    'updated_at',
  ],
};

const EXPECTED_INVOICE_STATUS_VALUES = ['needed', 'done'];

async function ensureInvoiceStatusEnum(client: PoolClient): Promise<void> {
  const columnResult = await client.query<{
    data_type: string;
    udt_name: string;
  }>(
    `SELECT data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'salesorderhistory'
        AND column_name = 'invoice_status'`
  );

  if (columnResult.rowCount === 0) {
    throw new Error("salesorderhistory.invoice_status column is missing");
  }

  const { data_type, udt_name } = columnResult.rows[0];
  if (data_type !== 'USER-DEFINED') {
    throw new Error(
      `salesorderhistory.invoice_status is expected to be an enum but is ${data_type}`
    );
  }

  const enumValuesResult = await client.query<{ enumlabel: string }>(
    `SELECT enumlabel
       FROM pg_enum e
       JOIN pg_type t ON e.enumtypid = t.oid
      WHERE t.typname = $1`,
    [udt_name]
  );

  const enumValues = new Set(enumValuesResult.rows.map(row => row.enumlabel));
  const missingValues = EXPECTED_INVOICE_STATUS_VALUES.filter(
    value => !enumValues.has(value)
  );

  if (missingValues.length > 0) {
    throw new Error(
      `salesorderhistory.invoice_status enum is missing expected values: ${missingValues.join(', ')}`
    );
  }
}

async function ensureTableColumns(client: PoolClient, table: string, columns: string[]): Promise<void> {
  const columnResult = await client.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1`,
    [table]
  );

  if (columnResult.rowCount === 0) {
    throw new Error(`Table ${table} is missing`);
  }

  const availableColumns = new Set(columnResult.rows.map(row => row.column_name));
  const missingColumns = columns.filter(column => !availableColumns.has(column));

  if (missingColumns.length > 0) {
    throw new Error(
      `Table ${table} is missing required columns: ${missingColumns.join(', ')}`
    );
  }
}

export async function runSchemaDriftGuard(): Promise<void> {
  console.log('[SchemaDriftGuard] Validating database schema...');
  const client = await pool.connect();

  try {
    await ensureInvoiceStatusEnum(client);

    await Promise.all(
      Object.entries(REQUIRED_COLUMNS).map(([table, columns]) =>
        ensureTableColumns(client, table, columns)
      )
    );

    console.log('[SchemaDriftGuard] Database schema validation passed');
  } catch (error) {
    console.error('[SchemaDriftGuard] Schema drift detected:', error);
    throw error;
  } finally {
    client.release();
  }
}

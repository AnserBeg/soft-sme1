import { Pool, PoolClient } from 'pg';
import { getNextQuoteSequenceNumberForYear } from '../utils/sequence';
import {
  QuoteUpdateArgs as QuoteUpdateArgsSchema,
  type QuoteUpdateArgs as QuoteUpdateArgsType,
} from './agentV2/toolSchemas';

export interface CreateQuoteInput {
  customer_id: number | string;
  quote_date: string | Date;
  valid_until: string | Date;
  product_name: string;
  product_description?: string | null;
  estimated_cost: number | string;
  status?: string | null;
  terms?: string | null;
  customer_po_number?: string | null;
  vin_number?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
}

export interface CreateQuoteResult {
  quote_id: number;
  quote_number: string;
  [key: string]: any;
}

export class QuoteService {
  constructor(private pool: Pool) {}

  private parseQuotePatch(quoteId: number, patch: unknown) {
    const parsed = QuoteUpdateArgsSchema.parse({ quote_id: quoteId, patch: patch ?? {} });
    const validatedPatch = parsed.patch as QuoteUpdateArgsType['patch'];
    if (Object.keys(validatedPatch ?? {}).length === 0) {
      throw new Error('No valid fields provided for quote update');
    }
    return validatedPatch;
  }

  async applyPatch(
    quoteId: number,
    patch: unknown,
    clientArg?: PoolClient
  ): Promise<{ updated: true }> {
    const client = clientArg ?? (await this.pool.connect());
    let startedTransaction = false;

    try {
      const validatedPatch = this.parseQuotePatch(quoteId, patch);

      if (!clientArg) {
        await client.query('BEGIN');
        startedTransaction = true;
      }

      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (Object.prototype.hasOwnProperty.call(validatedPatch, 'valid_until')) {
        const value = validatedPatch.valid_until;
        if (value === undefined) {
          fields.push(`valid_until = NULL`);
        } else {
          fields.push(`valid_until = $${idx}`);
          values.push(new Date(value));
          idx += 1;
        }
      }

      if (validatedPatch.status !== undefined) {
        fields.push(`status = $${idx}`);
        values.push(validatedPatch.status);
        idx += 1;
      }

      if (validatedPatch.notes !== undefined) {
        fields.push(`notes = $${idx}`);
        values.push(validatedPatch.notes ?? null);
        idx += 1;
      }

      fields.push('updated_at = NOW()');
      values.push(quoteId);

      await client.query(
        `UPDATE quotes SET ${fields.join(', ')} WHERE quote_id = $${idx}`,
        values
      );

      if (startedTransaction) {
        await client.query('COMMIT');
      }

      return { updated: true };
    } catch (error) {
      if (startedTransaction) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      if (!clientArg) {
        client.release();
      }
    }
  }

  async createQuote(input: CreateQuoteInput, clientArg?: PoolClient): Promise<CreateQuoteResult> {
    const client = clientArg ?? (await this.pool.connect());
    let startedTransaction = false;

    try {
      if (!clientArg) {
        await client.query('BEGIN');
        startedTransaction = true;
      }

      const customerIdRaw = input.customer_id;
      const customerId = customerIdRaw !== undefined && customerIdRaw !== null ? Number(customerIdRaw) : NaN;
      if (!Number.isFinite(customerId)) {
        throw new Error('customer_id is required to create a quote');
      }

      if (!input.quote_date) {
        throw new Error('quote_date is required to create a quote');
      }

      if (!input.valid_until) {
        throw new Error('valid_until is required to create a quote');
      }

      const productName = (input.product_name ?? '').toString().trim();
      if (!productName) {
        throw new Error('product_name is required to create a quote');
      }

      const estimatedCost = Number(input.estimated_cost);
      if (!Number.isFinite(estimatedCost)) {
        throw new Error('estimated_cost must be a number');
      }

      const quoteDateIso = new Date(input.quote_date).toISOString();
      const validUntilIso = new Date(input.valid_until).toISOString();

      const status = typeof input.status === 'string' && input.status.trim()
        ? input.status.trim()
        : 'Open';

      const terms = input.terms ? String(input.terms) : null;
      const customerPoNumber = input.customer_po_number ? String(input.customer_po_number) : null;
      const vinNumber = input.vin_number ? String(input.vin_number) : null;
      const vehicleMake = input.vehicle_make ? String(input.vehicle_make) : null;
      const vehicleModel = input.vehicle_model ? String(input.vehicle_model) : null;
      const productDescription = input.product_description ? String(input.product_description) : null;

      const customerCheck = await client.query('SELECT customer_id FROM customermaster WHERE customer_id = $1', [customerId]);
      if (customerCheck.rowCount === 0) {
        throw new Error(`Customer with ID ${customerId} not found`);
      }

      const currentYear = new Date().getFullYear();
      const { sequenceNumber, nnnnn } = await getNextQuoteSequenceNumberForYear(currentYear);
      const quoteNumber = `QO-${currentYear}-${nnnnn.toString().padStart(5, '0')}`;

      const result = await client.query(
        `INSERT INTO quotes (
          quote_number, customer_id, quote_date, valid_until, product_name, product_description,
          estimated_cost, status, sequence_number, terms, customer_po_number, vin_number,
          vehicle_make, vehicle_model
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING quote_id, quote_number`,
        [
          quoteNumber,
          customerId,
          quoteDateIso,
          validUntilIso,
          productName,
          productDescription,
          estimatedCost,
          status,
          sequenceNumber,
          terms,
          customerPoNumber,
          vinNumber,
          vehicleMake,
          vehicleModel,
        ]
      );

      if (startedTransaction) {
        await client.query('COMMIT');
      }

      const created = result.rows[0];
      return created as CreateQuoteResult;
    } catch (error) {
      if (startedTransaction) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      if (!clientArg) {
        client.release();
      }
    }
  }
}

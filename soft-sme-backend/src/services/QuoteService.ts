import { Pool, PoolClient } from 'pg';
import { getNextQuoteSequenceNumberForYear } from '../utils/sequence';
import { sanitizePlainText } from '../utils/htmlSanitizer';

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
  vehicle_year?: string | number | null;
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

      const productName = sanitizePlainText(input.product_name ?? '').trim();
      if (!productName) {
        throw new Error('product_name is required to create a quote');
      }

      const estimatedCost = Number(input.estimated_cost);
      if (!Number.isFinite(estimatedCost)) {
        throw new Error('estimated_cost must be a number');
      }

      const quoteDateIso = new Date(input.quote_date).toISOString();
      const validUntilIso = new Date(input.valid_until).toISOString();

      const sanitizedStatus = sanitizePlainText(input.status).trim();
      const status = sanitizedStatus || 'Open';

      const terms = sanitizePlainText(input.terms).trim() || null;
      const customerPoNumber = sanitizePlainText(input.customer_po_number).trim() || null;
      const vinNumber = sanitizePlainText(input.vin_number).trim() || null;
      const vehicleYearRaw = sanitizePlainText(input.vehicle_year).trim();
      const vehicleYear = vehicleYearRaw ? Number(vehicleYearRaw) : null;
      const vehicleMake = sanitizePlainText(input.vehicle_make).trim() || null;
      const vehicleModel = sanitizePlainText(input.vehicle_model).trim() || null;
      const productDescription = sanitizePlainText(input.product_description).trim() || null;

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
          vehicle_year, vehicle_make, vehicle_model
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
          Number.isFinite(vehicleYear as number) ? vehicleYear : null,
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

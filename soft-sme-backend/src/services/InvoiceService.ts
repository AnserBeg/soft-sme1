import { Pool, PoolClient } from 'pg';
import { getNextInvoiceSequenceNumberForYear } from '../utils/sequence';

export type InvoiceStatus = 'Paid' | 'Unpaid';

export interface InvoiceLineItemInput {
  invoice_line_item_id?: number;
  part_id?: number | null;
  part_number?: string;
  part_description?: string;
  quantity?: number | string;
  unit?: string;
  unit_price?: number | string;
  line_amount?: number | string;
}

export interface InvoiceInput {
  customer_id: number;
  sales_order_id?: number | null;
  source_sales_order_number?: string | null;
  invoice_date?: string | Date | null;
  due_date?: string | Date | null;
  payment_terms_in_days?: number | null;
  status?: InvoiceStatus;
  notes?: string | null;
  line_items: InvoiceLineItemInput[];
}

export interface InvoiceListResult {
  invoices: any[];
  summary: {
    totalReceivables: number;
    totalOverdue: number;
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const toNumber = (value: any) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const normalizeStatus = (value: any): InvoiceStatus => {
  if (typeof value === 'string' && value.trim().toLowerCase() === 'paid') return 'Paid';
  return 'Unpaid';
};

const parseDate = (value: string | Date | null | undefined, fallback: Date): Date => {
  if (!value) return fallback;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? fallback : parsed;
};

export class InvoiceService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private async getCustomerTerms(client: PoolClient, customerId: number): Promise<number> {
    const res = await client.query(
      'SELECT default_payment_terms_in_days FROM customermaster WHERE customer_id = $1',
      [customerId]
    );
    if (res.rows.length === 0) {
      throw new Error(`Customer ${customerId} not found`);
    }
    const raw = res.rows[0].default_payment_terms_in_days;
    const terms = Number(raw);
    return Number.isFinite(terms) && terms > 0 ? terms : 30;
  }

  private calcTotals(lineItems: InvoiceLineItemInput[]) {
    const subtotal = round2(
      lineItems.reduce((sum, item) => {
        const quantity = toNumber(item.quantity);
        const unitPrice = toNumber(item.unit_price);
        const lineAmount = item.line_amount !== undefined ? toNumber(item.line_amount) : quantity * unitPrice;
        return sum + lineAmount;
      }, 0)
    );
    const total_gst_amount = round2(subtotal * 0.05);
    const total_amount = round2(subtotal + total_gst_amount);
    return { subtotal, total_gst_amount, total_amount };
  }

  private normalizeLineItems(rawItems: InvoiceLineItemInput[]): Required<InvoiceLineItemInput>[] {
    return (rawItems || []).map((item) => {
      const quantity = toNumber(item.quantity);
      const unit_price = toNumber(item.unit_price);
      const line_amount =
        item.line_amount !== undefined && item.line_amount !== null
          ? toNumber(item.line_amount)
          : round2(quantity * unit_price);
      return {
        invoice_line_item_id: item.invoice_line_item_id,
        part_id: item.part_id ?? null,
        part_number: item.part_number ? String(item.part_number).trim() : '',
        part_description: item.part_description ? String(item.part_description).trim() : '',
        quantity,
        unit: item.unit ? String(item.unit).trim() : '',
        unit_price,
        line_amount: round2(line_amount),
      };
    });
  }

  private addDays(date: Date, days: number) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  async createInvoiceFromSalesOrder(salesOrderId: number) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const soRes = await client.query(
        `SELECT sales_order_id, sales_order_number, customer_id, status
         FROM salesorderhistory
         WHERE sales_order_id = $1`,
        [salesOrderId]
      );
      if (soRes.rows.length === 0) {
        throw new Error('Sales order not found');
      }
      const salesOrder = soRes.rows[0];
      if ((salesOrder.status || '').toLowerCase() !== 'closed') {
        throw new Error('Invoice can only be created from a closed sales order');
      }

      const terms = await this.getCustomerTerms(client, salesOrder.customer_id);

      const lineItemsRes = await client.query(
        `SELECT part_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount
         FROM salesorderlineitems
         WHERE sales_order_id = $1`,
        [salesOrderId]
      );

      const lineItems = this.normalizeLineItems(
        lineItemsRes.rows.map((row) => ({
          part_id: row.part_id ?? null,
          part_number: row.part_number,
          part_description: row.part_description,
          quantity: row.quantity_sold,
          unit: row.unit,
          unit_price: row.unit_price,
          line_amount: row.line_amount,
        }))
      );

      const { subtotal, total_gst_amount, total_amount } = this.calcTotals(lineItems);
      const invoiceDate = new Date();
      const { sequenceNumber, nnnnn } = await getNextInvoiceSequenceNumberForYear(invoiceDate.getFullYear());
      const invoiceNumber = `INV-${invoiceDate.getFullYear()}-${nnnnn.toString().padStart(5, '0')}`;
      const dueDate = this.addDays(invoiceDate, terms);

      const insertInvoice = await client.query(
        `INSERT INTO invoices (
          invoice_number, sequence_number, customer_id, sales_order_id, source_sales_order_number,
          status, invoice_date, due_date, payment_terms_in_days, subtotal, total_gst_amount, total_amount, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING invoice_id, invoice_number, due_date`,
        [
          invoiceNumber,
          sequenceNumber,
          salesOrder.customer_id,
          salesOrder.sales_order_id,
          salesOrder.sales_order_number,
          'Unpaid',
          invoiceDate,
          dueDate,
          terms,
          subtotal,
          total_gst_amount,
          total_amount,
          null,
        ]
      );

      const invoiceId = insertInvoice.rows[0].invoice_id;

      for (const item of lineItems) {
        await client.query(
          `INSERT INTO invoicelineitems
           (invoice_id, part_id, part_number, part_description, quantity, unit, unit_price, line_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            invoiceId,
            item.part_id,
            item.part_number,
            item.part_description,
            item.quantity,
            item.unit,
            item.unit_price,
            item.line_amount,
          ]
        );
      }

      await client.query('COMMIT');
      return insertInvoice.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createInvoice(payload: InvoiceInput) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const invoiceDate = parseDate(payload.invoice_date, new Date());
      const status = normalizeStatus(payload.status);
      const lineItems = this.normalizeLineItems(payload.line_items || []);
      const terms =
        payload.payment_terms_in_days && Number.isFinite(Number(payload.payment_terms_in_days))
          ? Number(payload.payment_terms_in_days)
          : await this.getCustomerTerms(client, payload.customer_id);
      const dueDate = parseDate(payload.due_date, this.addDays(invoiceDate, terms));

      const { subtotal, total_gst_amount, total_amount } = this.calcTotals(lineItems);
      const { sequenceNumber, nnnnn } = await getNextInvoiceSequenceNumberForYear(invoiceDate.getFullYear());
      const invoiceNumber = `INV-${invoiceDate.getFullYear()}-${nnnnn.toString().padStart(5, '0')}`;

      const insertInvoice = await client.query(
        `INSERT INTO invoices (
          invoice_number, sequence_number, customer_id, sales_order_id, source_sales_order_number,
          status, invoice_date, due_date, payment_terms_in_days, subtotal, total_gst_amount, total_amount, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING invoice_id, invoice_number`,
        [
          invoiceNumber,
          sequenceNumber,
          payload.customer_id,
          payload.sales_order_id ?? null,
          payload.source_sales_order_number ?? null,
          status,
          invoiceDate,
          dueDate,
          terms,
          subtotal,
          total_gst_amount,
          total_amount,
          payload.notes ?? null,
        ]
      );

      const invoiceId = insertInvoice.rows[0].invoice_id;
      for (const item of lineItems) {
        await client.query(
          `INSERT INTO invoicelineitems
           (invoice_id, part_id, part_number, part_description, quantity, unit, unit_price, line_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            invoiceId,
            item.part_id,
            item.part_number,
            item.part_description,
            item.quantity,
            item.unit,
            item.unit_price,
            item.line_amount,
          ]
        );
      }

      await client.query('COMMIT');
      return insertInvoice.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateInvoice(invoiceId: number, payload: Partial<InvoiceInput>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const currentRes = await client.query('SELECT * FROM invoices WHERE invoice_id = $1', [invoiceId]);
      if (currentRes.rows.length === 0) {
        throw new Error('Invoice not found');
      }

      const current = currentRes.rows[0];
      const invoiceDate = parseDate(payload.invoice_date ?? current.invoice_date, new Date());
      const status = normalizeStatus(payload.status ?? current.status);
      const lineItems = this.normalizeLineItems(payload.line_items ?? []);
      const terms =
        payload.payment_terms_in_days && Number.isFinite(Number(payload.payment_terms_in_days))
          ? Number(payload.payment_terms_in_days)
          : current.payment_terms_in_days || (await this.getCustomerTerms(client, payload.customer_id ?? current.customer_id));
      const dueDate = parseDate(payload.due_date ?? current.due_date, this.addDays(invoiceDate, terms));
      const customerId = payload.customer_id ?? current.customer_id;
      const notes = payload.notes ?? current.notes;

      const { subtotal, total_gst_amount, total_amount } = this.calcTotals(lineItems);

      await client.query(
        `UPDATE invoices
         SET customer_id = $1,
             sales_order_id = $2,
             source_sales_order_number = $3,
             status = $4,
             invoice_date = $5,
             due_date = $6,
             payment_terms_in_days = $7,
             subtotal = $8,
             total_gst_amount = $9,
             total_amount = $10,
             notes = $11,
             updated_at = NOW()
         WHERE invoice_id = $12`,
        [
          customerId,
          payload.sales_order_id ?? current.sales_order_id,
          payload.source_sales_order_number ?? current.source_sales_order_number,
          status,
          invoiceDate,
          dueDate,
          terms,
          subtotal,
          total_gst_amount,
          total_amount,
          notes,
          invoiceId,
        ]
      );

      await client.query('DELETE FROM invoicelineitems WHERE invoice_id = $1', [invoiceId]);
      for (const item of lineItems) {
        await client.query(
          `INSERT INTO invoicelineitems
           (invoice_id, part_id, part_number, part_description, quantity, unit, unit_price, line_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            invoiceId,
            item.part_id,
            item.part_number,
            item.part_description,
            item.quantity,
            item.unit,
            item.unit_price,
            item.line_amount,
          ]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteInvoice(invoiceId: number) {
    await this.pool.query('DELETE FROM invoices WHERE invoice_id = $1', [invoiceId]);
  }

  async getInvoice(invoiceId: number) {
    const client = await this.pool.connect();
    try {
      const invoiceRes = await client.query(
        `SELECT i.*, c.customer_name, c.default_payment_terms_in_days
         FROM invoices i
         JOIN customermaster c ON i.customer_id = c.customer_id
         WHERE i.invoice_id = $1`,
        [invoiceId]
      );
      if (invoiceRes.rows.length === 0) {
        throw new Error('Invoice not found');
      }
      const linesRes = await client.query(
        `SELECT * FROM invoicelineitems WHERE invoice_id = $1 ORDER BY invoice_line_item_id`,
        [invoiceId]
      );
      const invoice = invoiceRes.rows[0];
      invoice.subtotal = toNumber(invoice.subtotal);
      invoice.total_gst_amount = toNumber(invoice.total_gst_amount);
      invoice.total_amount = toNumber(invoice.total_amount);
      return { invoice, lineItems: linesRes.rows };
    } finally {
      client.release();
    }
  }

  async listInvoices(filters?: { customer_id?: number; status?: InvoiceStatus }): Promise<InvoiceListResult> {
    const clauses: string[] = [];
    const params: any[] = [];

    if (filters?.customer_id) {
      params.push(filters.customer_id);
      clauses.push(`i.customer_id = $${params.length}`);
    }

    if (filters?.status) {
      params.push(filters.status);
      clauses.push(`LOWER(i.status) = LOWER($${params.length})`);
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const query = `
      SELECT i.*, c.customer_name
      FROM invoices i
      JOIN customermaster c ON i.customer_id = c.customer_id
      ${whereClause}
      ORDER BY i.invoice_date DESC, i.invoice_id DESC`;

    const res = await this.pool.query(query, params);
    const invoices = res.rows.map((row) => ({
      ...row,
      subtotal: toNumber(row.subtotal),
      total_gst_amount: toNumber(row.total_gst_amount),
      total_amount: toNumber(row.total_amount),
    }));

    const now = new Date();
    const totalReceivables = invoices
      .filter((inv) => normalizeStatus(inv.status) === 'Unpaid')
      .reduce((sum, inv) => sum + toNumber(inv.total_amount), 0);
    const totalOverdue = invoices
      .filter((inv) => normalizeStatus(inv.status) === 'Unpaid' && inv.due_date && new Date(inv.due_date) < now)
      .reduce((sum, inv) => sum + toNumber(inv.total_amount), 0);

    return {
      invoices,
      summary: {
        totalReceivables: round2(totalReceivables),
        totalOverdue: round2(totalOverdue),
      },
    };
  }
}

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
  product_name?: string | null;
  product_description?: string | null;
  vin_number?: string | null;
  unit_number?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  mileage?: number | null;
}

export interface InvoiceListResult {
  invoices: any[];
  summary: {
    totalReceivables: number;
    totalOverdue: number;
  };
  hasMore: boolean;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const toNumber = (value: any) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};
const toNullableNumber = (value: any): number | null => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

  private async getMarginSchedule(client: PoolClient) {
    const res = await client.query(
      `SELECT margin_id, product_id, cost_lower_bound, cost_upper_bound, margin_factor
       FROM marginschedule
       ORDER BY cost_lower_bound ASC, margin_id ASC`
    );
    return res.rows.map((row) => ({
      margin_id: row.margin_id,
      product_id: row.product_id ?? null,
      cost_lower_bound: Number(row.cost_lower_bound ?? 0),
      cost_upper_bound: row.cost_upper_bound === null ? null : Number(row.cost_upper_bound),
      margin_factor: Number(row.margin_factor ?? 1),
    }));
  }

  private pickMarginFactor(
    schedule: {
      product_id: number | null;
      cost_lower_bound: number;
      cost_upper_bound: number | null;
      margin_factor: number;
    }[],
    cost: number,
    productId: number | null
  ) {
    const findFactor = (rows: typeof schedule) => {
      for (const row of rows) {
        const lower = Number(row.cost_lower_bound ?? 0);
        const upper = row.cost_upper_bound === null ? null : Number(row.cost_upper_bound);
        const factor = Number(row.margin_factor ?? 1);
        if (cost >= lower && (upper === null || cost < upper)) {
          return Number.isFinite(factor) && factor > 0 ? factor : 1;
        }
      }
      return 1;
    };

    const productMatches = schedule.filter((row) => row.product_id === productId);
    const general = schedule.filter((row) => row.product_id === null);

    const productFactor = productMatches.length ? findFactor(productMatches) : null;
    if (productFactor && productFactor !== 1) return productFactor;
    return findFactor(productMatches.length ? productMatches : general);
  }

  private async applyMarginToLineItems(
    client: PoolClient,
    items: Required<InvoiceLineItemInput>[]
  ): Promise<Required<InvoiceLineItemInput>[]> {
    if (!items.length) return items;

    const schedule = await this.getMarginSchedule(client);
    if (!schedule.length) return items;

    const partIds = Array.from(
      new Set(items.map((item) => item.part_id).filter((id): id is number => Number.isFinite(Number(id))))
    );
    const partNumbers = Array.from(
      new Set(
        items
          .filter((item) => !item.part_id && item.part_number)
          .map((item) => item.part_number.trim())
          .filter(Boolean)
      )
    );

    const inventoryMap = new Map<
      number,
      { part_id: number; part_number: string; last_unit_cost: number; part_type: string | null }
    >();
    const inventoryByNumber = new Map<string, { part_id: number; last_unit_cost: number; part_type: string | null }>();

    if (partIds.length) {
      const res = await client.query(
        'SELECT part_id, part_number, last_unit_cost, part_type FROM inventory WHERE part_id = ANY($1)',
        [partIds]
      );
      for (const row of res.rows) {
        const cost = Number(row.last_unit_cost ?? 0);
        const partType = row.part_type ? String(row.part_type).toLowerCase() : null;
        inventoryMap.set(row.part_id, {
          part_id: row.part_id,
          part_number: row.part_number,
          last_unit_cost: Number.isFinite(cost) ? cost : 0,
          part_type: partType,
        });
        inventoryByNumber.set(row.part_number, {
          part_id: row.part_id,
          last_unit_cost: Number.isFinite(cost) ? cost : 0,
          part_type: partType,
        });
      }
    }

    if (partNumbers.length) {
      const res = await client.query(
        'SELECT part_id, part_number, last_unit_cost, part_type FROM inventory WHERE part_number = ANY($1)',
        [partNumbers]
      );
      for (const row of res.rows) {
        if (!inventoryByNumber.has(row.part_number)) {
          const cost = Number(row.last_unit_cost ?? 0);
          const partType = row.part_type ? String(row.part_type).toLowerCase() : null;
          inventoryByNumber.set(row.part_number, {
            part_id: row.part_id,
            last_unit_cost: Number.isFinite(cost) ? cost : 0,
            part_type: partType,
          });
        }
      }
    }

    const shouldSkipMargin = (item: Required<InvoiceLineItemInput>, partType: string | null) => {
      const pn = (item.part_number || '').trim().toUpperCase();
      if (pn === 'LABOUR' || pn === 'LABOR' || pn === 'OVERHEAD' || pn === 'SUPPLY') return true;
      const normalizedType = (partType || '').toLowerCase();
      return normalizedType === 'labour' || normalizedType === 'labor' || normalizedType === 'overhead' || normalizedType === 'supply';
    };

    return items.map((item) => {
      const inventory =
        (item.part_id ? inventoryMap.get(item.part_id) : null) ||
        (item.part_number ? inventoryByNumber.get(item.part_number) : null) ||
        null;

      if (shouldSkipMargin(item, inventory?.part_type ?? null)) return item;

      const baseCost = Number(inventory?.last_unit_cost ?? NaN);
      if (!Number.isFinite(baseCost) || baseCost <= 0) return item;

      const factor = this.pickMarginFactor(schedule, baseCost, inventory?.part_id ?? null);
      const unit_price = round2(baseCost * factor);
      const line_amount = round2(unit_price * Number(item.quantity ?? 0));

      return {
        ...item,
        unit_price,
        line_amount,
      };
    });
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
                , product_name, product_description, vin_number, unit_number, vehicle_make, vehicle_model, terms, mileage
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
        `SELECT 
            soli.part_id,
            soli.part_number,
            soli.part_description,
            soli.quantity_sold,
            soli.unit,
            soli.unit_price,
            soli.line_amount,
            inv.part_description AS inventory_part_description,
            inv.unit AS inventory_unit,
            inv.last_unit_cost AS inventory_last_unit_cost
         FROM salesorderlineitems soli
         LEFT JOIN inventory inv
           ON (soli.part_id IS NOT NULL AND inv.part_id = soli.part_id)
           OR (soli.part_id IS NULL AND inv.part_number = soli.part_number)
         WHERE soli.sales_order_id = $1`,
        [salesOrderId]
      );

      // Preserve sales order details; fall back to inventory data/line totals if a field is missing
      const lineItems = this.normalizeLineItems(
        lineItemsRes.rows.map((row) => {
          const quantity = toNullableNumber(row.quantity_sold) ?? 0;
          const unitPriceFromSO = toNullableNumber(row.unit_price);
          const lineAmountFromSO = toNullableNumber(row.line_amount);
          const inventoryCost = toNullableNumber(row.inventory_last_unit_cost);
          const inferredUnitPrice =
            unitPriceFromSO ??
            (lineAmountFromSO !== null && quantity > 0 ? round2(lineAmountFromSO / quantity) : null) ??
            inventoryCost ??
            0;
          const lineAmount = lineAmountFromSO ?? round2(inferredUnitPrice * quantity);

          return {
            part_id: row.part_id ?? null,
            part_number: row.part_number,
            part_description:
              ((row.part_description || row.inventory_part_description || '').trim() || row.part_number || '').trim(),
            quantity,
            unit: (row.unit || row.inventory_unit || '').trim(),
            unit_price: inferredUnitPrice,
            line_amount: lineAmount,
          };
        })
      );

      const marginAdjustedItems = await this.applyMarginToLineItems(client, lineItems);

      const { subtotal, total_gst_amount, total_amount } = this.calcTotals(marginAdjustedItems);
      const invoiceDate = new Date();
      const { sequenceNumber, nnnnn } = await getNextInvoiceSequenceNumberForYear(invoiceDate.getFullYear());
      const invoiceNumber = `INV-${invoiceDate.getFullYear()}-${nnnnn.toString().padStart(5, '0')}`;
      const dueDate = this.addDays(invoiceDate, terms);

      const insertInvoice = await client.query(
        `INSERT INTO invoices (
          invoice_number, sequence_number, customer_id, sales_order_id, source_sales_order_number,
          status, invoice_date, due_date, payment_terms_in_days, subtotal, total_gst_amount, total_amount, notes,
          product_name, product_description, vin_number, unit_number, vehicle_make, vehicle_model, mileage
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
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
          salesOrder.terms ?? null,
          salesOrder.product_name,
          salesOrder.product_description,
          salesOrder.vin_number,
          salesOrder.unit_number,
          salesOrder.vehicle_make,
          salesOrder.vehicle_model,
          salesOrder.mileage ?? null,
        ]
      );

      const invoiceId = insertInvoice.rows[0].invoice_id;

      for (const item of marginAdjustedItems) {
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

      // Mark sales order invoice status as done if applicable
      if (salesOrder.sales_order_id) {
        await client.query(
          'UPDATE salesorderhistory SET invoice_status = $1, updated_at = NOW() WHERE sales_order_id = $2',
          ['done', salesOrder.sales_order_id]
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
      const marginAdjustedItems = await this.applyMarginToLineItems(client, lineItems);
      const terms =
        payload.payment_terms_in_days && Number.isFinite(Number(payload.payment_terms_in_days))
          ? Number(payload.payment_terms_in_days)
          : await this.getCustomerTerms(client, payload.customer_id);
      const dueDate = parseDate(payload.due_date, this.addDays(invoiceDate, terms));
      const mileage = payload.mileage !== undefined && payload.mileage !== null ? Number(payload.mileage) : null;

      const { subtotal, total_gst_amount, total_amount } = this.calcTotals(marginAdjustedItems);
      const { sequenceNumber, nnnnn } = await getNextInvoiceSequenceNumberForYear(invoiceDate.getFullYear());
      const invoiceNumber = `INV-${invoiceDate.getFullYear()}-${nnnnn.toString().padStart(5, '0')}`;

      const insertInvoice = await client.query(
        `INSERT INTO invoices (
          invoice_number, sequence_number, customer_id, sales_order_id, source_sales_order_number,
          status, invoice_date, due_date, payment_terms_in_days, subtotal, total_gst_amount, total_amount, notes,
          product_name, product_description, vin_number, unit_number, vehicle_make, vehicle_model, mileage
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
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
          payload.product_name ?? null,
          payload.product_description ?? null,
          payload.vin_number ?? null,
          payload.unit_number ?? null,
          payload.vehicle_make ?? null,
          payload.vehicle_model ?? null,
          mileage,
        ]
      );

      const invoiceId = insertInvoice.rows[0].invoice_id;
      for (const item of marginAdjustedItems) {
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

      if (payload.sales_order_id) {
        await client.query(
          'UPDATE salesorderhistory SET invoice_status = $1, updated_at = NOW() WHERE sales_order_id = $2',
          ['done', payload.sales_order_id]
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
      const mileage = payload.mileage !== undefined && payload.mileage !== null ? Number(payload.mileage) : current.mileage ?? null;

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
             product_name = $12,
             product_description = $13,
             vin_number = $14,
             unit_number = $15,
             vehicle_make = $16,
             vehicle_model = $17,
             mileage = $18,
             updated_at = NOW()
         WHERE invoice_id = $19`,
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
          payload.product_name ?? current.product_name,
          payload.product_description ?? current.product_description,
          payload.vin_number ?? current.vin_number,
          payload.unit_number ?? current.unit_number,
          payload.vehicle_make ?? current.vehicle_make,
          payload.vehicle_model ?? current.vehicle_model,
          mileage,
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

      if (payload.sales_order_id ?? current.sales_order_id) {
        await client.query(
          'UPDATE salesorderhistory SET invoice_status = $1, updated_at = NOW() WHERE sales_order_id = $2',
          ['done', payload.sales_order_id ?? current.sales_order_id]
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
        `SELECT i.*, 
                c.customer_name, 
                c.default_payment_terms_in_days,
              c.street_address,
              c.city,
              c.province,
              c.country,
              c.postal_code,
              c.telephone_number,
              c.email,
              so.sales_order_number AS so_sales_order_number,
              so.product_name AS so_product_name,
              so.product_description AS so_product_description,
              so.vin_number AS so_vin_number,
              so.unit_number AS so_unit_number,
              so.vehicle_make AS so_vehicle_make,
              so.vehicle_model AS so_vehicle_model,
              so.mileage AS so_mileage,
              so.terms AS so_terms
       FROM invoices i
       JOIN customermaster c ON i.customer_id = c.customer_id
       LEFT JOIN salesorderhistory so ON i.sales_order_id = so.sales_order_id
       WHERE i.invoice_id = $1`,
      [invoiceId]
    );
      if (invoiceRes.rows.length === 0) {
        throw new Error('Invoice not found');
      }
      const linesRes = await client.query(
        `SELECT 
            li.*,
            inv.part_description AS inventory_part_description,
            inv.unit AS inventory_unit
         FROM invoicelineitems li
         LEFT JOIN inventory inv
           ON (li.part_id IS NOT NULL AND inv.part_id = li.part_id)
           OR (li.part_id IS NULL AND inv.part_number = li.part_number)
         WHERE li.invoice_id = $1
         ORDER BY li.invoice_line_item_id`,
        [invoiceId]
      );
      const invoice = invoiceRes.rows[0];
      const mergedInvoice = {
        ...invoice,
        product_name: invoice.product_name ?? invoice.so_product_name ?? invoice.product_name ?? null,
        product_description:
          invoice.product_description ?? invoice.so_product_description ?? invoice.product_description ?? null,
        vin_number: invoice.vin_number ?? invoice.so_vin_number ?? invoice.vin_number ?? null,
        unit_number: invoice.unit_number ?? invoice.so_unit_number ?? invoice.unit_number ?? null,
        vehicle_make: invoice.vehicle_make ?? invoice.so_vehicle_make ?? invoice.vehicle_make ?? null,
        vehicle_model: invoice.vehicle_model ?? invoice.so_vehicle_model ?? invoice.vehicle_model ?? null,
        mileage: invoice.mileage ?? invoice.so_mileage ?? invoice.mileage ?? null,
        sales_order_number: invoice.so_sales_order_number ?? invoice.sales_order_number ?? null,
        subtotal: toNumber(invoice.subtotal),
        total_gst_amount: toNumber(invoice.total_gst_amount),
        total_amount: toNumber(invoice.total_amount),
      };
      const normalizedLineItems = linesRes.rows.map((row) => {
        const quantity = toNumber(row.quantity);
        const unitPrice = toNumber(row.unit_price);
        const lineAmountRaw = row.line_amount !== undefined && row.line_amount !== null ? toNumber(row.line_amount) : null;
        const lineAmount = lineAmountRaw !== null ? lineAmountRaw : round2(unitPrice * quantity);

        return {
          invoice_line_item_id: row.invoice_line_item_id,
          part_id: row.part_id ?? null,
          part_number: row.part_number || '',
          part_description:
            ((row.part_description || row.inventory_part_description || '').trim() || row.part_number || '').trim(),
          quantity,
          unit: (row.unit || row.inventory_unit || '').trim(),
          unit_price: unitPrice,
          line_amount: lineAmount,
        };
      });
      return { invoice: mergedInvoice, lineItems: normalizedLineItems };
    } finally {
      client.release();
    }
  }

  async listInvoices(filters?: { customer_id?: number; status?: InvoiceStatus; limit?: number; offset?: number }): Promise<InvoiceListResult> {
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
    const limit =
      filters?.limit !== undefined
        ? Math.min(Math.max(filters.limit, 1), 500)
        : undefined;
    const offset = filters?.offset !== undefined ? Math.max(filters.offset, 0) : undefined;
    const effectiveLimit = limit !== undefined ? limit + 1 : undefined; // fetch one extra to detect hasMore
    const limitClause =
      effectiveLimit !== undefined
        ? `LIMIT $${params.length + 1}${offset !== undefined ? ` OFFSET $${params.length + 2}` : ''}`
        : '';
    const query = `
      SELECT 
        i.*,
        c.customer_name,
        i.product_name AS invoice_product_name,
        i.product_description AS invoice_product_description,
        i.vin_number AS invoice_vin_number,
        i.unit_number AS invoice_unit_number,
        i.vehicle_make AS invoice_vehicle_make,
        i.vehicle_model AS invoice_vehicle_model,
        i.mileage AS invoice_mileage,
        so.sales_order_number AS so_sales_order_number,
        so.product_name AS so_product_name,
        so.product_description AS so_product_description,
        so.vin_number AS so_vin_number,
        so.unit_number AS so_unit_number,
        so.vehicle_make AS so_vehicle_make,
        so.vehicle_model AS so_vehicle_model,
        so.mileage AS so_mileage,
        so.terms AS so_terms
      FROM invoices i
      JOIN customermaster c ON i.customer_id = c.customer_id
      LEFT JOIN salesorderhistory so ON i.sales_order_id = so.sales_order_id
      ${whereClause}
      ORDER BY i.invoice_date DESC, i.invoice_id DESC
      ${limitClause}`;

    const queryParams =
      effectiveLimit !== undefined
        ? offset !== undefined
          ? [...params, effectiveLimit, offset]
          : [...params, effectiveLimit]
        : params;
    const res = await this.pool.query(query, queryParams);
    let invoices = res.rows.map((row) => ({
      ...row,
      product_name: row.invoice_product_name ?? row.so_product_name ?? row.product_name ?? null,
      product_description: row.invoice_product_description ?? row.so_product_description ?? row.product_description ?? null,
      vin_number: row.invoice_vin_number ?? row.so_vin_number ?? row.vin_number ?? null,
      unit_number: row.invoice_unit_number ?? row.so_unit_number ?? row.unit_number ?? null,
      vehicle_make: row.invoice_vehicle_make ?? row.so_vehicle_make ?? row.vehicle_make ?? null,
      vehicle_model: row.invoice_vehicle_model ?? row.so_vehicle_model ?? row.vehicle_model ?? null,
      mileage: row.invoice_mileage ?? row.so_mileage ?? row.mileage ?? null,
      sales_order_number: row.so_sales_order_number ?? row.sales_order_number ?? null,
      subtotal: toNumber(row.subtotal),
      total_gst_amount: toNumber(row.total_gst_amount),
      total_amount: toNumber(row.total_amount),
    }));
    let hasMore = false;
    if (effectiveLimit !== undefined && limit !== undefined && invoices.length > limit) {
      hasMore = true;
      invoices = invoices.slice(0, limit);
    }

    const summaryQuery = `
      SELECT
        COALESCE(SUM(CASE WHEN LOWER(i.status) <> 'paid' THEN i.total_amount ELSE 0 END), 0) AS total_receivables,
        COALESCE(SUM(CASE WHEN LOWER(i.status) <> 'paid' AND i.due_date < NOW() THEN i.total_amount ELSE 0 END), 0) AS total_overdue
      FROM invoices i
      JOIN customermaster c ON i.customer_id = c.customer_id
      LEFT JOIN salesorderhistory so ON i.sales_order_id = so.sales_order_id
      ${whereClause}`;
    const summaryRes = await this.pool.query(summaryQuery, params);
    const summaryRow = summaryRes.rows[0] || { total_receivables: 0, total_overdue: 0 };

    return {
      invoices,
      summary: {
        totalReceivables: round2(toNumber(summaryRow.total_receivables)),
        totalOverdue: round2(toNumber(summaryRow.total_overdue)),
      },
      hasMore,
    };
  }
}

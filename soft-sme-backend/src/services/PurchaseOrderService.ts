import { Pool, PoolClient } from 'pg';
import { PurchaseOrderCalculationService } from './PurchaseOrderCalculationService';

export interface CreatePurchaseOrderInput {
  vendor_id: number | string;
  bill_number?: string | null;
  bill_date?: string | Date | null;
  subtotal?: number | string | null;
  total_gst_amount?: number | string | null;
  total_amount?: number | string | null;
  global_gst_rate?: number | string | null;
  gst_rate?: number | string | null;
  pickup_notes?: string | null;
  pickup_time?: string | null;
  pickup_location?: string | null;
  pickup_contact_person?: string | null;
  pickup_phone?: string | null;
  pickup_instructions?: string | null;
  lineItems?: any[];
}

export interface CreatePurchaseOrderResult {
  purchase_id: number;
  purchase_number: string;
}

export class PurchaseOrderService {
  private calculationService: PurchaseOrderCalculationService;

  constructor(private pool: Pool) {
    this.calculationService = new PurchaseOrderCalculationService(pool);
  }

  async createPurchaseOrder(input: CreatePurchaseOrderInput, clientArg?: PoolClient): Promise<CreatePurchaseOrderResult> {
    const client = clientArg ?? (await this.pool.connect());
    let startedTransaction = false;

    try {
      if (!clientArg) {
        await client.query('BEGIN');
        startedTransaction = true;
      }

      const vendorIdRaw = input.vendor_id;
      const vendorId = vendorIdRaw !== undefined && vendorIdRaw !== null ? Number(vendorIdRaw) : NaN;
      if (!Number.isFinite(vendorId)) {
        throw new Error('vendor_id is required');
      }

      const lineItemsArray = Array.isArray(input.lineItems) ? input.lineItems : [];
      const trimmedLineItems = lineItemsArray.map((item: any) => ({
        ...item,
        part_number: item?.part_number ? String(item.part_number).trim() : '',
        part_description: item?.part_description ? String(item.part_description).trim() : '',
        unit: item?.unit ? String(item.unit).trim() : '',
      }));

      const billNumber = input.bill_number ? String(input.bill_number).trim() : '';

      if (billNumber) {
        const duplicateCheck = await client.query(
          'SELECT COUNT(*) as count FROM purchasehistory WHERE bill_number = $1',
          [billNumber]
        );
        if (parseInt(duplicateCheck.rows[0].count, 10) > 0) {
          throw new Error(`Bill number "${billNumber}" already exists in another purchase order.`);
        }
      }

      let purchaseNumber = '';
      let retryCount = 0;
      const maxRetries = 5;

      do {
        const now = new Date();
        const year = now.getFullYear();

        const existingPOsResult = await client.query(
          `SELECT purchase_number FROM purchasehistory WHERE purchase_number LIKE $1 ORDER BY purchase_number`,
          [`PO-${year}-%`]
        );

        const existingNumbers = existingPOsResult.rows
          .map((row) => parseInt(row.purchase_number.substring(8), 10))
          .filter((n) => !Number.isNaN(n))
          .sort((a, b) => a - b);

        let nextNumber = 1;
        for (const num of existingNumbers) {
          if (num !== nextNumber) {
            break;
          }
          nextNumber++;
        }

        purchaseNumber = `PO-${year}-${nextNumber.toString().padStart(5, '0')}`;

        const exists = await client.query(
          'SELECT COUNT(*) as count FROM purchasehistory WHERE purchase_number = $1',
          [purchaseNumber]
        );

        if (parseInt(exists.rows[0].count, 10) === 0) {
          break;
        }

        retryCount++;

        if (retryCount >= maxRetries) {
          const emergencyNumber = Date.now() % 100000;
          purchaseNumber = `PO-${year}-${emergencyNumber.toString().padStart(5, '0')}`;
          break;
        }
      } while (retryCount < maxRetries);

      const purchaseDate = input.bill_date ? new Date(input.bill_date) : new Date();
      const effectiveGstRate = this.parseRate(input.gst_rate, input.global_gst_rate, 5.0);

      const subtotal = input.subtotal !== undefined && input.subtotal !== null ? Number(input.subtotal) : 0;
      const totalGstAmount = input.total_gst_amount !== undefined && input.total_gst_amount !== null
        ? Number(input.total_gst_amount)
        : 0;
      const totalAmount = input.total_amount !== undefined && input.total_amount !== null ? Number(input.total_amount) : 0;

      const purchaseResult = await client.query(
        `INSERT INTO purchasehistory (
          vendor_id, purchase_number, purchase_date, date, bill_number, status, subtotal, total_gst_amount,
          total_amount, gst_rate, pickup_notes, pickup_time, pickup_location, pickup_contact_person,
          pickup_phone, pickup_instructions, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW()) RETURNING purchase_id`,
        [
          vendorId,
          purchaseNumber,
          purchaseDate,
          purchaseDate,
          billNumber,
          'Open',
          subtotal,
          totalGstAmount,
          totalAmount,
          effectiveGstRate,
          input.pickup_notes ?? null,
          input.pickup_time ?? null,
          input.pickup_location ?? null,
          input.pickup_contact_person ?? null,
          input.pickup_phone ?? null,
          input.pickup_instructions ?? null,
        ]
      );

      const purchaseId = Number(purchaseResult.rows[0].purchase_id);

      for (const item of lineItemsArray) {
        const lineTotal = item?.line_total !== undefined && item?.line_total !== null
          ? Number(item.line_total)
          : (Number(item?.quantity ?? 0) * Number(item?.unit_cost ?? 0));
        const gstAmount = lineTotal * (effectiveGstRate / 100);

        const trimmedItem = trimmedLineItems.find((ti: any) => ti.part_number === (item?.part_number ? String(item.part_number).trim() : ''));

        await client.query(
          `INSERT INTO purchaselineitems (
            purchase_id, part_number, part_description, unit, quantity, unit_cost, gst_amount, line_total
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            purchaseId,
            trimmedItem?.part_number ?? '',
            trimmedItem?.part_description ?? '',
            trimmedItem?.unit ?? '',
            Number(item?.quantity ?? 0),
            Number(item?.unit_cost ?? 0),
            gstAmount,
            lineTotal,
          ]
        );
      }

      try {
        await this.calculationService.recalculateAndUpdateTotals(purchaseId, client);
      } catch (error) {
        console.error(`Error recalculating totals for PO ${purchaseId}:`, error);
      }

      if (startedTransaction) {
        await client.query('COMMIT');
      }

      return {
        purchase_id: purchaseId,
        purchase_number: purchaseNumber,
      };
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

  private parseRate(primary: any, fallback: any, defaultRate: number): number {
    const primaryNum = primary !== undefined && primary !== null ? Number(primary) : NaN;
    if (!Number.isNaN(primaryNum) && Number.isFinite(primaryNum)) {
      return primaryNum;
    }

    const fallbackNum = fallback !== undefined && fallback !== null ? Number(fallback) : NaN;
    if (!Number.isNaN(fallbackNum) && Number.isFinite(fallbackNum)) {
      return fallbackNum;
    }

    return defaultRate;
  }
}

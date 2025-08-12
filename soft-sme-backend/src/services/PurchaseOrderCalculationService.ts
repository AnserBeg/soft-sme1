import { Pool, PoolClient } from 'pg';

export interface PurchaseOrderLineItem {
  line_item_id?: number;
  part_number: string;
  part_description: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  line_total?: number;
  gst_amount?: number;
}

export interface PurchaseOrderTotals {
  subtotal: number;
  total_gst_amount: number;
  total_amount: number;
}

export class PurchaseOrderCalculationService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Calculate line amount for a single line item
   * @param quantity - Quantity of items
   * @param unit_cost - Cost per unit
   * @returns Line amount (quantity * unit_cost)
   */
  calculateLineAmount(quantity: number, unit_cost: number): number {
    const q = parseFloat(String(quantity)) || 0;
    const uc = parseFloat(String(unit_cost)) || 0;
    return Math.round((q * uc) * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Calculate all totals for a purchase order
   * @param lineItems - Array of line items
   * @param gstRate - GST rate as percentage (default: 5.0)
   * @returns Object with subtotal, total_gst_amount, and total_amount
   */
  calculateTotals(
    lineItems: PurchaseOrderLineItem[],
    gstRate: number = 5.0
  ): PurchaseOrderTotals {
    // Calculate subtotal by summing all line amounts
    const subtotal = lineItems.reduce((sum, item) => {
      const lineAmount = this.calculateLineAmount(item.quantity, item.unit_cost);
      return sum + lineAmount;
    }, 0);

    // Calculate GST amount (subtotal * gstRate / 100)
    const total_gst_amount = subtotal * (gstRate / 100);

    // Calculate total amount (subtotal + total_gst_amount)
    const total_amount = subtotal + total_gst_amount;

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      total_gst_amount: Math.round(total_gst_amount * 100) / 100,
      total_amount: Math.round(total_amount * 100) / 100,
    };
  }

  /**
   * Update line items with calculated line amounts and GST
   * @param lineItems - Array of line items
   * @param gstRate - GST rate as percentage
   * @returns Updated line items with calculated amounts
   */
  updateLineItemsWithCalculatedAmounts(
    lineItems: PurchaseOrderLineItem[],
    gstRate: number = 5.0
  ): PurchaseOrderLineItem[] {
    return lineItems.map(item => {
      const line_total = this.calculateLineAmount(item.quantity, item.unit_cost);
      const gst_amount = line_total * (gstRate / 100);
      
      return {
        ...item,
        line_total,
        gst_amount: Math.round(gst_amount * 100) / 100,
      };
    });
  }

  /**
   * Recalculate and update purchase order totals in the database
   * @param purchaseOrderId - ID of the purchase order
   * @param client - Optional database client (will create new connection if not provided)
   * @returns Updated totals
   */
  async recalculateAndUpdateTotals(
    purchaseOrderId: number,
    client?: PoolClient
  ): Promise<PurchaseOrderTotals> {
    const dbClient = client || await this.pool.connect();
    let shouldReleaseClient = !client;
    let shouldCommit = false;

    try {
      if (!client) {
        await dbClient.query('BEGIN');
        shouldCommit = true;
      }

      // Get purchase order details to get GST rate
      const poResult = await dbClient.query(
        'SELECT gst_rate FROM purchasehistory WHERE purchase_id = $1',
        [purchaseOrderId]
      );

      if (poResult.rows.length === 0) {
        throw new Error(`Purchase order ${purchaseOrderId} not found`);
      }

      const gstRate = parseFloat(poResult.rows[0].gst_rate) || 5.0;

      // Get all line items for this purchase order
      const lineItemsResult = await dbClient.query(
        'SELECT * FROM purchaselineitems WHERE purchase_id = $1',
        [purchaseOrderId]
      );

      const lineItems = lineItemsResult.rows.map(row => ({
        line_item_id: row.line_item_id,
        part_number: row.part_number,
        part_description: row.part_description,
        quantity: parseFloat(row.quantity) || 0,
        unit: row.unit,
        unit_cost: parseFloat(row.unit_cost) || 0,
        line_total: parseFloat(row.line_total) || 0,
        gst_amount: parseFloat(row.gst_amount) || 0,
      }));

      // Calculate new totals
      const totals = this.calculateTotals(lineItems, gstRate);

      // Update line items with calculated amounts
      const updatedLineItems = this.updateLineItemsWithCalculatedAmounts(lineItems, gstRate);

      // Update each line item in the database
      for (const item of updatedLineItems) {
        await dbClient.query(
          `UPDATE purchaselineitems 
           SET line_total = $1, gst_amount = $2, updated_at = NOW()
           WHERE line_item_id = $3`,
          [item.line_total, item.gst_amount, item.line_item_id]
        );
      }

      // Update the purchase order totals
      await dbClient.query(
        `UPDATE purchasehistory 
         SET subtotal = $1, total_gst_amount = $2, total_amount = $3, updated_at = NOW()
         WHERE purchase_id = $4`,
        [totals.subtotal, totals.total_gst_amount, totals.total_amount, purchaseOrderId]
      );

      if (shouldCommit) {
        await dbClient.query('COMMIT');
      }

      console.log(`✅ Recalculated totals for PO ${purchaseOrderId}:`, totals);
      return totals;

    } catch (error) {
      if (shouldCommit) {
        await dbClient.query('ROLLBACK');
      }
      console.error(`❌ Error recalculating totals for PO ${purchaseOrderId}:`, error);
      throw error;
    } finally {
      if (shouldReleaseClient) {
        dbClient.release();
      }
    }
  }

  /**
   * Validate line item data
   * @param lineItem - Line item to validate
   * @returns Object with validation errors
   */
  validateLineItem(lineItem: PurchaseOrderLineItem): {
    quantity?: string;
    unit_cost?: string;
    part_number?: string;
    part_description?: string;
  } {
    const errors: any = {};
    
    if (!lineItem.part_number?.trim()) {
      errors.part_number = 'Part Number is required';
    }
    
    if (!lineItem.part_description?.trim()) {
      errors.part_description = 'Part Description is required';
    }
    
    const quantity = parseFloat(String(lineItem.quantity));
    if (isNaN(quantity) || quantity <= 0) {
      errors.quantity = 'Quantity must be greater than 0';
    }
    
    const unitCost = parseFloat(String(lineItem.unit_cost));
    if (isNaN(unitCost) || unitCost <= 0) {
      errors.unit_cost = 'Unit Cost must be greater than 0';
    }
    
    return errors;
  }

  /**
   * Validate entire purchase order
   * @param lineItems - Array of line items
   * @param vendor - Vendor information
   * @returns Object with validation errors
   */
  validatePurchaseOrder(
    lineItems: PurchaseOrderLineItem[],
    vendor?: any
  ): {
    vendor?: string;
    lineItems?: Array<{
      quantity?: string;
      unit_cost?: string;
      part_number?: string;
      part_description?: string;
    }>;
  } {
    const errors: any = {};
    
    if (!vendor) {
      errors.vendor = 'Vendor is required';
    }
    
    if (!lineItems || lineItems.length === 0) {
      errors.lineItems = 'At least one line item is required';
      return errors;
    }
    
    const lineItemErrors = lineItems.map(item => this.validateLineItem(item));
    const hasLineItemErrors = lineItemErrors.some(err => Object.keys(err).length > 0);
    
    if (hasLineItemErrors) {
      errors.lineItems = lineItemErrors;
    }
    
    return errors;
  }
}
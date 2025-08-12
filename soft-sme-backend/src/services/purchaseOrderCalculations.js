/**
 * CommonJS wrapper for Purchase Order Calculation Service
 * Used by legacy index.js routes
 */

class PurchaseOrderCalculationService {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Calculate line amount for a single line item
   * @param {number} quantity - Quantity of items
   * @param {number} unit_cost - Cost per unit
   * @returns {number} Line amount (quantity * unit_cost)
   */
  calculateLineAmount(quantity, unit_cost) {
    const q = parseFloat(String(quantity)) || 0;
    const uc = parseFloat(String(unit_cost)) || 0;
    return Math.round((q * uc) * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Calculate all totals for a purchase order
   * @param {Array} lineItems - Array of line items
   * @param {number} gstRate - GST rate as percentage (default: 5.0)
   * @returns {Object} Object with subtotal, total_gst_amount, and total_amount
   */
  calculateTotals(lineItems, gstRate = 5.0) {
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
   * @param {Array} lineItems - Array of line items
   * @param {number} gstRate - GST rate as percentage
   * @returns {Array} Updated line items with calculated amounts
   */
  updateLineItemsWithCalculatedAmounts(lineItems, gstRate = 5.0) {
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
   * @param {number} purchaseOrderId - ID of the purchase order
   * @param {Object} client - Optional database client (will create new connection if not provided)
   * @returns {Promise<Object>} Updated totals
   */
  async recalculateAndUpdateTotals(purchaseOrderId, client) {
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
}

module.exports = { PurchaseOrderCalculationService };
import { Pool, PoolClient } from 'pg';
import { InventoryService } from './InventoryService';

export class SalesOrderService {
  private pool: Pool;
  private inventoryService: InventoryService;
  constructor(pool: Pool) {
    this.pool = pool;
    this.inventoryService = new InventoryService(pool);
  }

  // Update sales order with proper inventory management
  async updateSalesOrder(orderId: number, newLineItems: any[], clientArg?: PoolClient): Promise<void> {
    const client = clientArg || await this.pool.connect();
    let startedTransaction = false;
    try {
      if (!clientArg) {
        await client.query('BEGIN');
        startedTransaction = true;
      }
      // Get current line items to calculate inventory changes
      const currentLineItemsRes = await client.query('SELECT * FROM salesorderlineitems WHERE sales_order_id = $1', [orderId]);
      const currentLineItems = currentLineItemsRes.rows;
      // Create maps for easy comparison
      const currentItemsMap = new Map();
      const newItemsMap = new Map();
      currentLineItems.forEach(item => {
        currentItemsMap.set(item.part_number, item.quantity_sold);
      });
      newLineItems.forEach(item => {
        newItemsMap.set(item.part_number, item.quantity || 0);
      });
      // Calculate inventory changes
      const inventoryChanges = new Map();
      // Handle removed items - restore inventory
      for (const [partNumber, currentQty] of currentItemsMap.entries()) {
        if (!newItemsMap.has(partNumber)) {
          inventoryChanges.set(partNumber, currentQty);
        }
      }
      // Handle added/modified items - adjust inventory
      for (const [partNumber, newQty] of newItemsMap.entries()) {
        const currentQty = currentItemsMap.get(partNumber) || 0;
        const delta = newQty - currentQty;
        if (delta !== 0) {
          const existingChange = inventoryChanges.get(partNumber) || 0;
          inventoryChanges.set(partNumber, existingChange - delta);
        }
      }
      // Check for negative inventory before making changes
      const negativeInventoryErrors = [];
      for (const [partNumber, change] of inventoryChanges.entries()) {
        if (change < 0) {
          const currentInventory = await this.inventoryService.getOnHand(partNumber, client);
          if (currentInventory + change < 0) {
            negativeInventoryErrors.push({
              part_number: partNumber,
              available: currentInventory,
              requested: -change,
              would_result_in: currentInventory + change
            });
          }
        }
      }
      if (negativeInventoryErrors.length > 0) {
        const errorDetails = negativeInventoryErrors.map(err => 
          `Part ${err.part_number}: Available ${err.available}, Requested ${err.requested}, Would result in ${err.would_result_in}`
        ).join('; ');
        throw new Error(`Insufficient inventory for the following parts: ${errorDetails}`);
      }
      // Apply inventory changes
      for (const [partNumber, change] of inventoryChanges.entries()) {
        if (change !== 0) {
          await this.inventoryService.adjustInventory(partNumber, change, 'Sales order update', orderId, undefined, client);
        }
      }
      // Update line items in database
      await client.query('DELETE FROM salesorderlineitems WHERE sales_order_id = $1', [orderId]);
      for (const item of newLineItems) {
        await client.query(
          `INSERT INTO salesorderlineitems (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [orderId, item.part_number, item.part_description, item.quantity, item.unit, item.unit_price, item.line_amount]
        );
      }
      if (startedTransaction) await client.query('COMMIT');
    } catch (err) {
      if (startedTransaction) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (!clientArg) client.release();
    }
  }

  async upsertLineItem(orderId: number, item: any, clientArg?: PoolClient): Promise<void> {
    const client = clientArg || await this.pool.connect();
    let startedTransaction = false;
    try {
      if (!clientArg) {
        await client.query('BEGIN');
        startedTransaction = true;
      }
      
      // Check if order is closed
      const orderRes = await client.query('SELECT status FROM salesorderhistory WHERE sales_order_id = $1 FOR UPDATE', [orderId]);
      if (orderRes.rows.length === 0) throw new Error('Sales order not found');
      if (orderRes.rows[0].status === 'Closed') throw new Error('Cannot modify closed order');
      
      const lineRes = await client.query('SELECT * FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = $2 FOR UPDATE', [orderId, item.part_number]);
      const oldQty = lineRes.rows.length > 0 ? lineRes.rows[0].quantity_sold : 0;
      const newQty = item.quantity || 0;
      const delta = newQty - oldQty;
      if (delta !== 0) {
        await this.inventoryService.adjustInventory(item.part_number, -delta, 'Sales order line item update', orderId, undefined, client);
      }
      if (lineRes.rows.length > 0) {
        await client.query(
          `UPDATE salesorderlineitems SET quantity_sold = $1, part_description = $2, unit = $3, unit_price = $4, line_amount = $5 WHERE sales_order_id = $6 AND part_number = $7`,
          [item.quantity, item.part_description, item.unit, item.unit_price, item.line_amount, orderId, item.part_number]
        );
      } else {
        await client.query(
          `INSERT INTO salesorderlineitems (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [orderId, item.part_number, item.part_description, item.quantity, item.unit, item.unit_price, item.line_amount]
        );
      }
      if (startedTransaction) await client.query('COMMIT');
    } catch (err) {
      if (startedTransaction) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (!clientArg) client.release();
    }
  }

  async recalculateAndUpdateSummary(orderId: number, clientArg?: PoolClient): Promise<void> {
    const client = clientArg || await this.pool.connect();
    let startedTransaction = false;
    try {
      if (!clientArg) {
        await client.query('BEGIN');
        startedTransaction = true;
      }
      const lineItemsRes = await client.query('SELECT * FROM salesorderlineitems WHERE sales_order_id = $1', [orderId]);
      const lineItems = lineItemsRes.rows;
      let subtotal = 0;
      let total_gst_amount = 0;
      let total_amount = 0;
      for (const item of lineItems) {
        subtotal += parseFloat(item.line_amount || 0);
      }
      total_gst_amount = subtotal * 0.05;
      total_amount = subtotal + total_gst_amount;
      await client.query(
        'UPDATE salesorderhistory SET subtotal = $1, total_gst_amount = $2, total_amount = $3 WHERE sales_order_id = $4',
        [subtotal, total_gst_amount, total_amount, orderId]
      );
      if (startedTransaction) await client.query('COMMIT');
    } catch (err) {
      if (startedTransaction) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (!clientArg) client.release();
    }
  }

  async closeOrder(orderId: number, clientArg?: PoolClient): Promise<void> {
    const client = clientArg || await this.pool.connect();
    let startedTransaction = false;
    try {
      if (!clientArg) {
        await client.query('BEGIN');
        startedTransaction = true;
      }
      const orderRes = await client.query('SELECT * FROM salesorderhistory WHERE sales_order_id = $1 FOR UPDATE', [orderId]);
      if (orderRes.rows.length === 0) throw new Error('Sales order not found');
      if (orderRes.rows[0].status !== 'Open') throw new Error('Order is already closed');
      // No inventory change on close
      await client.query('UPDATE salesorderhistory SET status = $1 WHERE sales_order_id = $2', ['Closed', orderId]);
      if (startedTransaction) await client.query('COMMIT');
    } catch (err) {
      if (startedTransaction) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (!clientArg) client.release();
    }
  }

  async openOrder(orderId: number, clientArg?: PoolClient): Promise<void> {
    const client = clientArg || await this.pool.connect();
    let startedTransaction = false;
    try {
      if (!clientArg) {
        await client.query('BEGIN');
        startedTransaction = true;
      }
      const orderRes = await client.query('SELECT * FROM salesorderhistory WHERE sales_order_id = $1 FOR UPDATE', [orderId]);
      if (orderRes.rows.length === 0) throw new Error('Sales order not found');
      if (orderRes.rows[0].status !== 'Closed') throw new Error('Order is not closed');
      // No inventory change on reopen
      await client.query('UPDATE salesorderhistory SET status = $1 WHERE sales_order_id = $2', ['Open', orderId]);
      if (startedTransaction) await client.query('COMMIT');
    } catch (err) {
      if (startedTransaction) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (!clientArg) client.release();
    }
  }

  async deleteOrder(orderId: number, userId?: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const orderRes = await client.query('SELECT * FROM salesorderhistory WHERE sales_order_id = $1 FOR UPDATE', [orderId]);
      if (orderRes.rows.length === 0) throw new Error('Sales order not found');
      const linesRes = await client.query('SELECT * FROM salesorderlineitems WHERE sales_order_id = $1 FOR UPDATE', [orderId]);
      // Restore inventory for all line items
      for (const line of linesRes.rows) {
        await this.inventoryService.adjustInventory(line.part_number, line.quantity_sold, 'Sales order deleted', orderId, userId, client);
      }
      await client.query('DELETE FROM salesorderlineitems WHERE sales_order_id = $1', [orderId]);
      await client.query('DELETE FROM salesorderhistory WHERE sales_order_id = $1', [orderId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
} 
import { Pool, PoolClient } from 'pg';
import { InventoryService } from './InventoryService';

export class SalesOrderService {
  private pool: Pool;
  private inventoryService: InventoryService;
  constructor(pool: Pool) {
    this.pool = pool;
    this.inventoryService = new InventoryService(pool);
  }

  async updateLineItem(orderId: number, partId: string, newQty: number, userId?: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock the sales order
      const orderRes = await client.query('SELECT * FROM salesorderhistory WHERE sales_order_id = $1 FOR UPDATE', [orderId]);
      if (orderRes.rows.length === 0) throw new Error('Sales order not found');
      if (orderRes.rows[0].status !== 'Open') throw new Error('Cannot modify a closed order');
      // Lock the inventory row
      const lineRes = await client.query('SELECT * FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = $2 FOR UPDATE', [orderId, partId]);
      const oldQty = lineRes.rows.length > 0 ? lineRes.rows[0].quantity_sold : 0;
      const delta = newQty - oldQty;
      await this.inventoryService.adjustInventory(partId, -delta, 'Sales order line item update', orderId, userId, client);
      if (newQty > 0) {
        // Upsert
        if (lineRes.rows.length > 0) {
          await client.query('UPDATE salesorderlineitems SET quantity_sold = $1 WHERE sales_order_id = $2 AND part_number = $3', [newQty, orderId, partId]);
        } else {
          await client.query('INSERT INTO salesorderlineitems (sales_order_id, part_number, quantity_sold) VALUES ($1, $2, $3)', [orderId, partId, newQty]);
        }
      } else if (lineRes.rows.length > 0) {
        // Delete
        await client.query('DELETE FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = $2', [orderId, partId]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async closeOrder(orderId: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const orderRes = await client.query('SELECT * FROM salesorderhistory WHERE sales_order_id = $1 FOR UPDATE', [orderId]);
      if (orderRes.rows.length === 0) throw new Error('Sales order not found');
      if (orderRes.rows[0].status !== 'Open') throw new Error('Order is already closed');
      await client.query('UPDATE salesorderhistory SET status = $1 WHERE sales_order_id = $2', ['Closed', orderId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteOrder(orderId: number, userId?: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const orderRes = await client.query('SELECT * FROM salesorderhistory WHERE sales_order_id = $1 FOR UPDATE', [orderId]);
      if (orderRes.rows.length === 0) throw new Error('Sales order not found');
      const linesRes = await client.query('SELECT * FROM salesorderlineitems WHERE sales_order_id = $1 FOR UPDATE', [orderId]);
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
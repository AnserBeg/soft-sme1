import { Pool, PoolClient } from 'pg';
import { InventoryService } from './InventoryService';

export class SalesOrderService {
  private pool: Pool;
  private inventoryService: InventoryService;
  constructor(pool: Pool) {
    this.pool = pool;
    this.inventoryService = new InventoryService(pool);
  }

  // Update sales order with simple inventory validation
  async updateSalesOrder(orderId: number, newLineItems: any[], clientArg?: PoolClient, user?: any): Promise<null> {
    const client = clientArg || await this.pool.connect();
    let startedTransaction = false;
    
    console.log('🔧 Backend received newLineItems:', newLineItems);
    
    try {
      if (!clientArg) {
        await client.query('BEGIN');
        startedTransaction = true;
      }
      
      // Get current line items to calculate inventory changes
      const currentLineItemsRes = await client.query('SELECT * FROM salesorderlineitems WHERE sales_order_id = $1', [orderId]);
      const currentLineItems = currentLineItemsRes.rows;
      
      // Filter out LABOUR, OVERHEAD, and SUPPLY from inventory management
      const inventoryLineItems = currentLineItems.filter(item => 
        item.part_number !== 'LABOUR' && item.part_number !== 'OVERHEAD' && item.part_number !== 'SUPPLY'
      );
      const inventoryNewLineItems = newLineItems.filter(item => 
        item.part_number !== 'LABOUR' && item.part_number !== 'OVERHEAD' && item.part_number !== 'SUPPLY'
      );
      
      // Simple inventory validation: quantity_on_hand - change_in_quantity_sold = new_quantity_on_hand
      for (const newItem of inventoryNewLineItems) {
        const partNumber = newItem.part_number;
        const partId: number | null = newItem.part_id || null;
        const newQuantitySold = parseFloat(newItem.quantity_sold || 0);
        
        // Find current quantity sold for this part
        const currentItem = inventoryLineItems.find(item => item.part_number === partNumber);
        const currentQuantitySold = currentItem ? parseFloat(currentItem.quantity_sold || 0) : 0;
        
        // Calculate change in quantity sold
        const changeInQuantitySold = newQuantitySold - currentQuantitySold;
        
        console.log(`Backend inventory validation for ${partNumber}:`, {
          newQuantitySold,
          currentQuantitySold,
          changeInQuantitySold
        });
        
        if (changeInQuantitySold > 0) {
          // Get current quantity on hand (prefer part_id if available)
          const currentQuantityOnHand = partId
            ? await this.inventoryService.getOnHandByPartId(partId, client)
            : await this.inventoryService.getOnHand(partNumber, client);
          
          // Calculate new quantity on hand
          const newQuantityOnHand = currentQuantityOnHand - changeInQuantitySold;
          
          console.log(`Backend inventory check for ${partNumber}:`, {
            currentQuantityOnHand,
            newQuantityOnHand,
            wouldGoNegative: newQuantityOnHand < 0
          });
          
          // Check if it would go negative
          if (newQuantityOnHand < 0) {
            throw new Error(`Insufficient inventory. Currently quantity on hand is only ${currentQuantityOnHand}`);
          }
        }
      }
      
      // Calculate inventory changes for actual updates
      const inventoryChanges = new Map();
      
      // Handle removed items - restore inventory
      for (const currentItem of inventoryLineItems) {
        const newItem = inventoryNewLineItems.find(item => item.part_number === currentItem.part_number);
        if (!newItem) {
          // Item was removed, restore inventory
          const currentQty = parseFloat(currentItem.quantity_sold || 0);
          inventoryChanges.set(currentItem.part_number, currentQty);
        }
      }
      
      // Handle added/modified items - adjust inventory
      for (const newItem of inventoryNewLineItems) {
        const partNumber = newItem.part_number;
        const newQty = parseFloat(newItem.quantity_sold || 0);
        const currentItem = inventoryLineItems.find(item => item.part_number === partNumber);
        const currentQty = currentItem ? parseFloat(currentItem.quantity_sold || 0) : 0;
        
        const delta = newQty - currentQty;
        if (delta !== 0) {
          inventoryChanges.set(partNumber, -delta);
        }
      }
      
      // Apply inventory changes
      for (const [partNumber, change] of inventoryChanges.entries()) {
        if (change !== 0) {
          const invRes = await client.query('SELECT part_id FROM inventory WHERE part_number = $1', [partNumber]);
          if (invRes.rows.length > 0 && invRes.rows[0].part_id) {
            await this.inventoryService.adjustInventoryByPartId(invRes.rows[0].part_id, change, 'Sales order update', orderId, undefined, client);
          } else {
            await this.inventoryService.adjustInventory(partNumber, change, 'Sales order update', orderId, undefined, client);
          }
        }
      }
      
      // Update line items in database
      // For LABOUR, OVERHEAD, and SUPPLY items, preserve existing quantity_sold values from time tracking or set to 'N/A' for SUPPLY
      const specialItems = newLineItems.filter(item => 
        item.part_number === 'LABOUR' || item.part_number === 'OVERHEAD' || item.part_number === 'SUPPLY'
      );
      const otherItems = newLineItems.filter(item => 
        item.part_number !== 'LABOUR' && item.part_number !== 'OVERHEAD' && item.part_number !== 'SUPPLY'
      );
      
      // Delete non-labour/overhead/supply items and reinsert them
      await client.query('DELETE FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number NOT IN ($2, $3, $4)', [orderId, 'LABOUR', 'OVERHEAD', 'SUPPLY']);
      
      // Insert other items (skip zero quantities)
      for (const item of otherItems) {
        // Defensive: coerce all numeric fields to numbers
        const quantity = item.quantity !== undefined && item.quantity !== null ? parseFloat(item.quantity) : 0;
        const quantity_sold = item.quantity_sold !== undefined && item.quantity_sold !== null ? parseFloat(item.quantity_sold) : 0; // Use the quantity_sold value from frontend
        const unit_price = item.unit_price !== undefined && item.unit_price !== null ? parseFloat(item.unit_price) : 0;
        const line_amount = item.line_amount !== undefined && item.line_amount !== null ? parseFloat(item.line_amount) : 0;
        
        // Skip items with zero quantity sold (except special items which are handled separately)
        if (quantity_sold <= 0) {
          console.log(`Skipping zero quantity item: ${item.part_number} for order ${orderId}`);
          continue;
        }
        
        console.log(`Saving line item: ${item.part_number}, quantity_sold: ${quantity_sold}`);
        
        // Resolve part_id for canonical reference
        let partIdInsert: number | null = null;
        if (item.part_id) {
          partIdInsert = item.part_id;
        } else {
          const invQ = await client.query('SELECT part_id FROM inventory WHERE part_number = $1', [item.part_number]);
          partIdInsert = invQ.rows[0]?.part_id || null;
        }

        await client.query(
          `INSERT INTO salesorderlineitems (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount, part_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [orderId, item.part_number, item.part_description, quantity_sold, item.unit, unit_price, line_amount, partIdInsert]
        );
        
        console.log(`✅ Saved line item to database: ${item.part_number} with quantity_sold: ${quantity_sold}`);
      }
      
      // Update LABOUR, OVERHEAD, and SUPPLY items
      for (const item of specialItems) {
        const quantity = item.quantity !== undefined && item.quantity !== null ? parseFloat(item.quantity) : 0;
        const unit_price = item.unit_price !== undefined && item.unit_price !== null ? parseFloat(item.unit_price) : 0;
        const line_amount = item.line_amount !== undefined && item.line_amount !== null ? parseFloat(item.line_amount) : 0;
        let quantity_sold: any = quantity;
        if (item.part_number === 'SUPPLY') {
          // For SUPPLY, use the quantity_sold from frontend (should be 1) but it doesn't affect inventory
          quantity_sold = item.quantity_sold !== undefined && item.quantity_sold !== null ? parseFloat(item.quantity_sold) : 1;
        }
        
        // Check if trying to delete LABOUR, OVERHEAD, or SUPPLY line items
        const isDeletingSpecialItem = quantity_sold <= 0;
        if (isDeletingSpecialItem) {
          // Only allow admin to delete LABOUR, OVERHEAD, and SUPPLY line items
          if (!user || user.access_role !== 'Admin') {
            throw new Error(`Only administrators can delete ${item.part_number} line items`);
          }
          console.log(`Admin deleting ${item.part_number} line item for order ${orderId}`);
        }
        
        // Check if item exists
        const existingItemRes = await client.query(
          'SELECT quantity_sold FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = $2',
          [orderId, item.part_number]
        );
        
        if (existingItemRes.rows.length > 0) {
          if (isDeletingSpecialItem) {
            // Delete the special line item when admin sets quantity to 0
            await client.query(
              `DELETE FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = $2`,
              [orderId, item.part_number]
            );
            console.log(`Admin deleted ${item.part_number} line item for order ${orderId}`);
          } else {
            // Update the special line item
            await client.query(
              `UPDATE salesorderlineitems SET part_description = $1, unit = $2, unit_price = $3, line_amount = $4, quantity_sold = $5 WHERE sales_order_id = $6 AND part_number = $7`,
              [item.part_description, item.unit, unit_price, line_amount, quantity_sold, orderId, item.part_number]
            );
          }
        } else {
          if (!isDeletingSpecialItem) {
            // Only insert if not trying to delete
            await client.query(
              `INSERT INTO salesorderlineitems (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [orderId, item.part_number, item.part_description, quantity_sold, item.unit, unit_price, line_amount]
            );
          }
        }
      }
      if (startedTransaction) await client.query('COMMIT');
      
      // Return null to indicate no adjustments were made (since we don't do auto-adjustments anymore)
      return null;
    } catch (err) {
      if (startedTransaction) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (!clientArg) client.release();
    }
  }

  async upsertLineItem(orderId: number, item: any, clientArg?: PoolClient, user?: any): Promise<void> {
    const client = clientArg || await this.pool.connect();
    let startedTransaction = false;
    try {
      if (!clientArg) {
        await client.query('BEGIN');
        startedTransaction = true;
      }
      // Defensive: coerce all numeric fields to numbers
      const quantity = item.quantity !== undefined && item.quantity !== null ? parseFloat(item.quantity) : 0;
      const quantity_sold = item.quantity_sold !== undefined && item.quantity_sold !== null ? parseFloat(item.quantity_sold) : 0;
      const unit_price = item.unit_price !== undefined && item.unit_price !== null ? parseFloat(item.unit_price) : 0;
      const line_amount = item.line_amount !== undefined && item.line_amount !== null ? parseFloat(item.line_amount) : 0;
      // Check if order is closed
      const orderRes = await client.query('SELECT status FROM salesorderhistory WHERE sales_order_id = $1 FOR UPDATE', [orderId]);
      if (orderRes.rows.length === 0) throw new Error('Sales order not found');
      if (orderRes.rows[0].status === 'Closed') throw new Error('Cannot modify closed order');
      // Prefer part_id for matching when available
      let resolvedPartId: number | null = item.part_id || null;
      if (!resolvedPartId && item.part_number && !['LABOUR','OVERHEAD','SUPPLY'].includes(String(item.part_number).toUpperCase())) {
        const r = await client.query('SELECT part_id FROM inventory WHERE part_number = $1', [item.part_number]);
        resolvedPartId = r.rows[0]?.part_id || null;
      }
      const lineRes = await client.query(
        'SELECT * FROM salesorderlineitems WHERE sales_order_id = $1 AND (part_id = $2 OR part_number = $3) FOR UPDATE',
        [orderId, resolvedPartId, item.part_number]
      );
      const oldQty = lineRes.rows.length > 0 ? lineRes.rows[0].quantity_sold : 0;
      const newQty = quantity;
      const delta = newQty - oldQty;
      if (delta !== 0 && item.part_number !== 'SUPPLY') {
        if (resolvedPartId) {
          await this.inventoryService.adjustInventoryByPartId(resolvedPartId, -delta, 'Sales order line item update', orderId, undefined, client);
        } else {
          await this.inventoryService.adjustInventory(item.part_number, -delta, 'Sales order line item update', orderId, undefined, client);
        }
      }
      // Handle zero quantities by deleting the line item (except for LABOUR, OVERHEAD, and SUPPLY)
      const quantityToOrder = parseFloat(item.quantity_to_order) || 0;
      
      // Check if trying to delete LABOUR, OVERHEAD, or SUPPLY line items
      const isSpecialLineItem = item.part_number === 'LABOUR' || item.part_number === 'OVERHEAD' || item.part_number === 'SUPPLY';
      const isDeletingSpecialItem = isSpecialLineItem && quantity_sold <= 0 && quantityToOrder <= 0;
      
      if (isDeletingSpecialItem) {
        // Only allow admin to delete LABOUR, OVERHEAD, and SUPPLY line items
        if (!user || user.access_role !== 'Admin') {
          throw new Error(`Only administrators can delete ${item.part_number} line items`);
        }
        console.log(`Admin deleting ${item.part_number} line item for order ${orderId}`);
      }
      
      if (quantity_sold <= 0 && quantityToOrder <= 0 && item.part_number !== 'LABOUR' && item.part_number !== 'OVERHEAD' && item.part_number !== 'SUPPLY') {
        if (lineRes.rows.length > 0) {
          console.log(`Deleting zero quantity line item: ${item.part_number} for order ${orderId}`);
          await client.query(
            `DELETE FROM salesorderlineitems WHERE sales_order_id = $1 AND (part_id = $2 OR part_number = $3)`,
            [orderId, resolvedPartId, item.part_number]
          );
        }
        // Don't insert anything for zero quantities
      } else if (isDeletingSpecialItem) {
        // Delete special line items (LABOUR, OVERHEAD, SUPPLY) when admin sets quantity to 0
        if (lineRes.rows.length > 0) {
          console.log(`Admin deleting ${item.part_number} line item for order ${orderId}`);
          await client.query(
            `DELETE FROM salesorderlineitems WHERE sales_order_id = $1 AND (part_id = $2 OR part_number = $3)`,
            [orderId, resolvedPartId, item.part_number]
          );
        }
        // Don't insert anything for zero quantities
      } else {
        if (lineRes.rows.length > 0) {
          await client.query(
            `UPDATE salesorderlineitems SET quantity_sold = $1, part_description = $2, unit = $3, unit_price = $4, line_amount = $5 WHERE sales_order_id = $6 AND (part_id = $7 OR part_number = $8)`,
            [quantity_sold, item.part_description, item.unit, unit_price, line_amount, orderId, resolvedPartId, item.part_number]
          );
        } else {
          await client.query(
            `INSERT INTO salesorderlineitems (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount, part_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [orderId, item.part_number, item.part_description, quantity_sold, item.unit, unit_price, line_amount, resolvedPartId]
          );
        }
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
      
      // Calculate subtotal from line items with proper precision
      for (const item of lineItems) {
        subtotal += parseFloat(item.line_amount || 0);
      }
      
      // Apply proper rounding to avoid floating-point precision issues
      subtotal = Math.round(subtotal * 100) / 100;
      
      // Calculate GST and total with proper rounding
      const total_gst_amount = Math.round((subtotal * 0.05) * 100) / 100;
      const total_amount = Math.round((subtotal + total_gst_amount) * 100) / 100;
      
      console.log(`📊 Sales Order ${orderId} calculation: subtotal=${subtotal}, gst=${total_gst_amount}, total=${total_amount}`);
      
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
        // Check if part exists in inventory
        const invRes = await client.query('SELECT 1 FROM inventory WHERE part_number = $1', [line.part_number]);
        if (invRes.rows.length > 0) {
          await this.inventoryService.adjustInventory(line.part_number, line.quantity_sold !== undefined && line.quantity_sold !== null ? parseFloat(line.quantity_sold) : 0, 'Sales order deleted', orderId, userId, client);
        } else {
          console.log(`Skipping inventory adjustment for non-inventory part: ${line.part_number}`);
        }
      }
      // Delete related time entries
      await client.query('DELETE FROM time_entries WHERE sales_order_id = $1', [orderId]);
      // Now delete line items and sales order
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
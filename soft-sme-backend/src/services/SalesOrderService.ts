import { Pool, PoolClient } from 'pg';
import { getNextSalesOrderSequenceNumberForYear } from '../utils/sequence';
import { InventoryService } from './InventoryService';

export interface CreateSalesOrderInput {
  header?: any;
  lineItems?: any[];
}

export class SalesOrderService {
  private pool: Pool;
  private inventoryService: InventoryService;
  constructor(pool: Pool) {
    this.pool = pool;
    this.inventoryService = new InventoryService(pool);
  }

  static normalizeInvoiceStatus(value: any): 'needed' | 'done' | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return null;
      if (['needed', 'need', 'required', 'pending'].includes(normalized)) return 'needed';
      if (['done', 'complete', 'completed', 'sent'].includes(normalized)) return 'done';
      if (['true', 't', 'yes', 'y', '1', 'on'].includes(normalized)) return 'needed';
      if (['false', 'f', 'no', 'n', '0', 'off'].includes(normalized)) return null;
    }
    if (typeof value === 'boolean') {
      return value ? 'needed' : null;
    }
    if (typeof value === 'number') {
      return value > 0 ? 'needed' : null;
    }
    return null;
  }

  async createSalesOrder(payload: CreateSalesOrderInput, user?: any, clientArg?: PoolClient) {
    const client = clientArg ?? (await this.pool.connect());
    let startedTransaction = false;

    try {
      if (!clientArg) {
        await client.query('BEGIN');
        startedTransaction = true;
      }

      const headerSource = payload.header ?? payload ?? {};
      const {
        sales_date,
        product_name,
        product_description,
        terms,
        customer_po_number,
        vin_number,
        vehicle_make,
        vehicle_model,
        invoice_status,
        invoice_required,
        status,
        estimated_cost,
        quote_id,
        source_quote_number,
      } = headerSource;

      const customerId = headerSource.customer_id !== undefined && headerSource.customer_id !== null
        ? Number(headerSource.customer_id)
        : NaN;
      if (!Number.isFinite(customerId)) {
        throw new Error('customer_id is required to create a sales order');
      }

      const trimmedProductName = product_name ? String(product_name).trim() : '';
      if (!trimmedProductName) {
        throw new Error('product_name is required to create a sales order');
      }

      const normalizedInvoiceStatus = SalesOrderService.normalizeInvoiceStatus(invoice_status ?? invoice_required);

      const trimmedLineItemsSource = Array.isArray(payload.lineItems)
        ? payload.lineItems
        : Array.isArray((headerSource as any).lineItems)
          ? (headerSource as any).lineItems
          : [];

      const trimmedLineItems = trimmedLineItemsSource.map((item: any) => ({
        ...item,
        part_number: item?.part_number ? String(item.part_number).trim() : '',
        part_description: item?.part_description ? String(item.part_description).trim() : '',
        unit: item?.unit ? String(item.unit).trim() : '',
        quantity_sold:
          item?.quantity_sold !== undefined && item?.quantity_sold !== null
            ? parseFloat(item.quantity_sold)
            : item?.quantity !== undefined && item?.quantity !== null
              ? parseFloat(item.quantity)
              : 0,
        unit_price:
          item?.unit_price !== undefined && item?.unit_price !== null
            ? parseFloat(item.unit_price)
            : 0,
        line_amount:
          item?.line_amount !== undefined && item?.line_amount !== null
            ? parseFloat(item.line_amount)
            : 0,
      }));

      const idRes = await client.query("SELECT nextval('salesorderhistory_sales_order_id_seq')");
      const newSalesOrderId = Number(idRes.rows[0].nextval);

      const salesDate = sales_date ? new Date(sales_date) : new Date();
      const currentYear = salesDate.getFullYear();
      const { sequenceNumber, nnnnn } = await getNextSalesOrderSequenceNumberForYear(currentYear);
      const formattedSONumber = `SO-${currentYear}-${nnnnn.toString().padStart(5, '0')}`;

      const estimatedCostNum = estimated_cost !== undefined && estimated_cost !== null ? parseFloat(estimated_cost) : 0;
      const quoteIdInt = quote_id !== undefined && quote_id !== null ? Number(quote_id) : null;
      const sourceQuoteNumberStr = source_quote_number ? String(source_quote_number) : null;

      await client.query(
        `INSERT INTO salesorderhistory (
          sales_order_id, sales_order_number, customer_id, sales_date, product_name, product_description, terms,
          customer_po_number, vin_number, vehicle_make, vehicle_model, invoice_status, subtotal, total_gst_amount, total_amount,
          status, estimated_cost, sequence_number, quote_id, source_quote_number
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          newSalesOrderId,
          formattedSONumber,
          customerId,
          salesDate,
          trimmedProductName,
          product_description ? String(product_description).trim() : '',
          terms ? String(terms).trim() : '',
          customer_po_number ? String(customer_po_number).trim() : '',
          vin_number ? String(vin_number).trim() : '',
          vehicle_make ? String(vehicle_make).trim() : '',
          vehicle_model ? String(vehicle_model).trim() : '',
          normalizedInvoiceStatus,
          0,
          0,
          0,
          status ? String(status) : 'Open',
          estimatedCostNum,
          sequenceNumber,
          quoteIdInt,
          sourceQuoteNumberStr,
        ]
      );

      for (const item of trimmedLineItems) {
        await this.upsertLineItem(newSalesOrderId, item, client, user ?? { access_role: 'Admin' });
      }

      await this.recalculateAndUpdateSummary(newSalesOrderId, client);

      if (startedTransaction) {
        await client.query('COMMIT');
      }

      return {
        sales_order_id: newSalesOrderId,
        sales_order_number: formattedSONumber,
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

  // Helper function to automatically add supply line items based on labour amount
  private async addSupplyLineItem(orderId: number, labourAmount: number, client: PoolClient): Promise<void> {
    try {
      // Get the global supply rate
      const supplyRateResult = await client.query('SELECT value FROM global_settings WHERE key = $1', ['supply_rate']);
      const supplyRate = supplyRateResult.rows.length > 0 ? parseFloat(supplyRateResult.rows[0].value) : 0;
      
      if (supplyRate > 0 && labourAmount > 0) {
        const supplyAmount = labourAmount * (supplyRate / 100);
        
        // Check if supply line item already exists
        const existingSupplyResult = await client.query(
          'SELECT sales_order_line_item_id FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = $2',
          [orderId, 'SUPPLY']
        );
        
        if (existingSupplyResult.rows.length > 0) {
          // Update existing supply line item
          await client.query(
            `UPDATE salesorderlineitems 
             SET line_amount = $1, unit_price = $2, updated_at = NOW() 
             WHERE sales_order_id = $3 AND part_number = $4`,
            [supplyAmount, supplyAmount, orderId, 'SUPPLY']
          );
          console.log(`Updated SUPPLY line item for SO ${orderId}: amount=${supplyAmount}, rate=${supplyRate}%`);
        } else {
          // Create new supply line item
          await client.query(
            `INSERT INTO salesorderlineitems 
             (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [orderId, 'SUPPLY', 'Supply', 1, 'Each', supplyAmount, supplyAmount]
          );
          console.log(`Created SUPPLY line item for SO ${orderId}: amount=${supplyAmount}, rate=${supplyRate}%`);
        }
      }
    } catch (error) {
      console.error(`Error adding supply line item for SO ${orderId}:`, error);
      // Don't throw error - supply calculation failure shouldn't break the entire operation
    }
  }

  // Sync labour and overhead line items from time entries
  private async syncLabourOverheadFromTimeEntries(orderId: number, client: PoolClient): Promise<void> {
    try {
      // Sum all durations for this sales order from time entries
      const sumRes = await client.query(
        `SELECT SUM(duration) as total_hours
         FROM time_entries WHERE sales_order_id = $1 AND clock_out IS NOT NULL`,
        [orderId]
      );
      
      const totalHours = parseFloat(sumRes.rows[0].total_hours) || 0;
      
      // Get global labour rate
      const labourRateRes = await client.query("SELECT value FROM global_settings WHERE key = 'labour_rate'");
      const labourRate = labourRateRes.rows.length > 0 ? parseFloat(labourRateRes.rows[0].value) : 60;
      const totalCost = totalHours * labourRate;

      // Get global overhead rate
      const overheadRateRes = await client.query("SELECT value FROM global_settings WHERE key = 'overhead_rate'");
      const overheadRate = overheadRateRes.rows.length > 0 ? parseFloat(overheadRateRes.rows[0].value) : 0;
      const totalOverheadCost = totalHours * overheadRate;

      // Upsert LABOUR line item
      const labourRes = await client.query(
        `SELECT sales_order_line_item_id FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = 'LABOUR'`,
        [orderId]
      );
      
      if (labourRes.rows.length > 0) {
        // Update existing labour line item
        await client.query(
          `UPDATE salesorderlineitems 
           SET part_description = $1, quantity_sold = $2, unit = $3, unit_price = $4, line_amount = $5, updated_at = NOW() 
           WHERE sales_order_id = $6 AND part_number = 'LABOUR'`,
          ['Labour Hours', totalHours, 'hr', labourRate, totalHours * labourRate, orderId]
        );
      } else {
        // Insert new labour line item
        await client.query(
          `INSERT INTO salesorderlineitems 
           (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount) 
           VALUES ($1, 'LABOUR', $2, $3, $4, $5, $6)`,
          [orderId, 'Labour Hours', totalHours, 'hr', labourRate, totalHours * labourRate]
        );
      }

      // Upsert OVERHEAD line item
      const overheadRes = await client.query(
        `SELECT sales_order_line_item_id FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = 'OVERHEAD'`,
        [orderId]
      );
      
      if (overheadRes.rows.length > 0) {
        // Update existing overhead line item
        await client.query(
          `UPDATE salesorderlineitems 
           SET part_description = $1, quantity_sold = $2, unit = $3, unit_price = $4, line_amount = $5, updated_at = NOW() 
           WHERE sales_order_id = $6 AND part_number = 'OVERHEAD'`,
          ['Overhead Hours', totalHours, 'hr', overheadRate, totalHours * overheadRate, orderId]
        );
      } else {
        // Insert new overhead line item
        await client.query(
          `INSERT INTO salesorderlineitems 
           (sales_order_line_item_id, sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount) 
           VALUES (DEFAULT, $1, 'OVERHEAD', $2, $3, $4, $5, $6)`,
          [orderId, 'Overhead Hours', totalHours, 'hr', overheadRate, totalHours * overheadRate]
        );
      }

      // Automatically add/update supply line item based on labour amount
      const labourLineAmount = totalHours * labourRate;
      if (labourLineAmount > 0) {
        await this.addSupplyLineItem(orderId, labourLineAmount, client);
      }

      console.log(`✅ Synced LABOUR and OVERHEAD line items for SO ${orderId}: labour=${totalCost}, overhead=${totalOverheadCost}`);
    } catch (error) {
      console.error(`Error syncing labour and overhead from time entries for SO ${orderId}:`, error);
      // Don't throw error - sync failure shouldn't break the entire operation
    }
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
      
      const isSpecialPart = (pn: string) => ['LABOUR','OVERHEAD','SUPPLY'].includes(String(pn).toUpperCase());

      // Get current line items to calculate inventory changes
      const currentLineItemsRes = await client.query('SELECT * FROM salesorderlineitems WHERE sales_order_id = $1', [orderId]);
      const currentLineItems = currentLineItemsRes.rows;
      
      // Filter out LABOUR, OVERHEAD, and SUPPLY from inventory management
      const inventoryLineItems = currentLineItems.filter(item => !isSpecialPart(item.part_number));
      const inventoryNewLineItems = newLineItems.filter(item => !isSpecialPart(item.part_number));
      
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
      const specialItems = newLineItems.filter(item => isSpecialPart(item.part_number));
      const otherItems = newLineItems.filter(item => !isSpecialPart(item.part_number));
      
      // Delete non-labour/overhead/supply items and reinsert them
      await client.query('DELETE FROM salesorderlineitems WHERE sales_order_id = $1 AND UPPER(part_number) NOT IN ($2, $3, $4)', [orderId, 'LABOUR', 'OVERHEAD', 'SUPPLY']);
      
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
        // For all special items (LABOUR, OVERHEAD, SUPPLY), use quantity_sold from frontend
        let quantity_sold: any = item.quantity_sold !== undefined && item.quantity_sold !== null ? parseFloat(item.quantity_sold) : 0;
        
        // Check if item exists first
        const existingItemRes = await client.query(
          'SELECT quantity_sold FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = $2',
          [orderId, item.part_number]
        );
        
        // Only prevent deletion if the line item already exists and user is trying to set quantity to 0
        // Allow saving new line items with 0 quantity
        // For LABOUR and OVERHEAD, allow non-admin users to save with quantity 0
        // For SUPPLY, only allow admin to delete
        const isDeletingSpecialItem = quantity_sold <= 0 && existingItemRes.rows.length > 0;
        if (isDeletingSpecialItem) {
          // Only block SUPPLY deletion for non-admin users
          // Allow LABOUR and OVERHEAD to be saved with quantity 0 by non-admin users
          if (item.part_number === 'SUPPLY' && (!user || user.access_role !== 'Admin')) {
            throw new Error(`Only administrators can delete ${item.part_number} line items`);
          }
          console.log(`${item.part_number === 'SUPPLY' ? 'Admin' : 'User'} ${item.part_number === 'SUPPLY' ? 'deleting' : 'saving with 0 quantity'} ${item.part_number} line item for order ${orderId}`);
        }
        

        
        if (existingItemRes.rows.length > 0) {
          if (isDeletingSpecialItem) {
            // For SUPPLY, delete the line item when admin sets quantity to 0
            // For LABOUR and OVERHEAD, update with quantity 0 instead of deleting
            if (item.part_number === 'SUPPLY') {
              await client.query(
                `DELETE FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = $2`,
                [orderId, item.part_number]
              );
              console.log(`Admin deleted ${item.part_number} line item for order ${orderId}`);
            } else {
              // For LABOUR and OVERHEAD, update with quantity 0
              await client.query(
                `UPDATE salesorderlineitems SET part_description = $1, unit = $2, unit_price = $3, line_amount = $4, quantity_sold = $5 WHERE sales_order_id = $6 AND part_number = $7`,
                [item.part_description, item.unit, unit_price, line_amount, quantity_sold, orderId, item.part_number]
              );
              console.log(`Updated ${item.part_number} line item with quantity 0 for order ${orderId}`);
            }
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
      
      // Automatically add/update supply line items based on labour amount
      const labourItem = specialItems.find(item => String(item.part_number).toUpperCase() === 'LABOUR');
      if (labourItem) {
        const labourAmount = parseFloat(labourItem.line_amount || 0);
        if (labourAmount > 0) {
          await this.addSupplyLineItem(orderId, labourAmount, client);
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
      const isSpecialPart = (pn: string) => ['LABOUR','OVERHEAD','SUPPLY'].includes(String(pn).toUpperCase());
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
      if (!resolvedPartId && item.part_number && !isSpecialPart(item.part_number)) {
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
      if (delta !== 0 && !isSpecialPart(item.part_number)) {
        if (resolvedPartId) {
          await this.inventoryService.adjustInventoryByPartId(resolvedPartId, -delta, 'Sales order line item update', orderId, undefined, client);
        } else {
          await this.inventoryService.adjustInventory(item.part_number, -delta, 'Sales order line item update', orderId, undefined, client);
        }
      }
      // Handle zero quantities by deleting the line item (except for LABOUR, OVERHEAD, and SUPPLY)
      const quantityToOrder = parseFloat(item.quantity_to_order) || 0;
      
      // Check if trying to delete LABOUR, OVERHEAD, or SUPPLY line items
      const isSpecialLineItem = isSpecialPart(item.part_number);
      

      
      // Only prevent deletion if user is actually trying to remove an existing line item
      // Allow saving with 0 quantity - only block when both quantity_sold and quantityToOrder are 0 AND line item exists
      const isDeletingSpecialItem = isSpecialLineItem && lineRes.rows.length > 0 && quantity_sold <= 0 && quantityToOrder <= 0;
      
      if (isDeletingSpecialItem) {
        console.log(`DEBUG: Detected deletion attempt for ${item.part_number}`);
        // Only block SUPPLY deletion for non-admin users
        // Allow LABOUR and OVERHEAD to be saved with quantity 0 by non-admin users
        if (item.part_number === 'SUPPLY' && (!user || user.access_role !== 'Admin')) {
          throw new Error(`Only administrators can delete ${item.part_number} line items`);
        }
        console.log(`${item.part_number === 'SUPPLY' ? 'Admin' : 'User'} ${item.part_number === 'SUPPLY' ? 'deleting' : 'saving with 0 quantity'} ${item.part_number} line item for order ${orderId}`);
      }
      
      if (quantity_sold <= 0 && quantityToOrder <= 0 && !isSpecialPart(item.part_number)) {
        if (lineRes.rows.length > 0) {
          console.log(`Deleting zero quantity line item: ${item.part_number} for order ${orderId}`);
          await client.query(
            `DELETE FROM salesorderlineitems WHERE sales_order_id = $1 AND (part_id = $2 OR part_number = $3)`,
            [orderId, resolvedPartId, item.part_number]
          );
        }
        // Don't insert anything for zero quantities
      } else if (isDeletingSpecialItem) {
        // For SUPPLY, delete the line item when admin sets quantity to 0
        // For LABOUR and OVERHEAD, update with quantity 0 instead of deleting
        if (lineRes.rows.length > 0) {
          if (item.part_number === 'SUPPLY') {
            console.log(`Admin deleting ${item.part_number} line item for order ${orderId}`);
            await client.query(
              `DELETE FROM salesorderlineitems WHERE sales_order_id = $1 AND (part_id = $2 OR part_number = $3)`,
              [orderId, resolvedPartId, item.part_number]
            );
          } else {
            // For LABOUR and OVERHEAD, update with quantity 0
            console.log(`Updating ${item.part_number} line item with quantity 0 for order ${orderId}`);
            await client.query(
              `UPDATE salesorderlineitems SET quantity_sold = $1, part_description = $2, unit = $3, unit_price = $4, line_amount = $5 WHERE sales_order_id = $6 AND (part_id = $7 OR part_number = $8)`,
              [quantity_sold, item.part_description, item.unit, unit_price, line_amount, orderId, resolvedPartId, item.part_number]
            );
          }
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
      
      // Automatically add/update supply line items if this was a labour line item update
      if (String(item.part_number).toUpperCase() === 'LABOUR' && line_amount > 0) {
        await this.addSupplyLineItem(orderId, line_amount, client);
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
      
      // First, ensure LABOUR and OVERHEAD line items exist and are up-to-date from time entries
      await this.syncLabourOverheadFromTimeEntries(orderId, client);
      
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
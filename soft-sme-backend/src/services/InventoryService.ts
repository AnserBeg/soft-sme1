import { Pool, PoolClient } from 'pg';

export class InventoryService {
  private pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }

  // Prefer using part_id where available
  async getOnHandByPartId(partId: number, client?: PoolClient): Promise<number> {
    const db = client || this.pool;
    const result = await db.query('SELECT quantity_on_hand FROM inventory WHERE part_id = $1', [partId]);
    if (result.rows.length === 0) throw new Error(`Part not found by part_id: ${partId}`);
    return result.rows[0].quantity_on_hand;
  }

  async getOnHand(partId: string, client?: PoolClient): Promise<number> {
    const db = client || this.pool;
    // Normalize part number by removing dashes and spaces for lookup
    const normalizedPartNumber = partId.replace(/[-"\s]/g, '');
    
    // Try exact match first
    let result = await db.query('SELECT quantity_on_hand FROM inventory WHERE part_number = $1', [partId]);
    
    // If not found, try normalized match
    if (result.rows.length === 0) {
      result = await db.query('SELECT quantity_on_hand FROM inventory WHERE part_number = $1', [normalizedPartNumber]);
    }
    
    if (result.rows.length === 0) throw new Error(`Part not found: ${partId}`);
    return result.rows[0].quantity_on_hand;
  }

  async adjustInventoryByPartId(partId: number, delta: number, reason: string, salesOrderId?: number, userId?: number, client?: PoolClient): Promise<void> {
    const db = client || this.pool;
    const result = await db.query('SELECT quantity_on_hand, part_type FROM inventory WHERE part_id = $1 FOR UPDATE', [partId]);
    if (result.rows.length === 0) throw new Error(`Part not found by part_id: ${partId}`);

    const partType = result.rows[0].part_type;
    if (partType !== 'stock') {
      console.warn(`Attempted to adjust inventory for non-stock part_id ${partId} (type: ${partType}). Skipping quantity adjustment.`);
      return;
    }

    const onHand = parseFloat(result.rows[0].quantity_on_hand);
    if (isNaN(onHand)) {
      throw new Error(`Invalid quantity_on_hand for stock part_id ${partId}: ${result.rows[0].quantity_on_hand}`);
    }

    const newQty = onHand + delta;
    if (newQty < 0) throw new Error(`Insufficient stock for part_id ${partId}. Available: ${onHand}, Requested: ${-delta}`);
    await db.query('UPDATE inventory SET quantity_on_hand = $1 WHERE part_id = $2', [newQty, partId]);
    await db.query(
      'INSERT INTO inventory_audit_log (part_id, delta, new_on_hand, reason, sales_order_id, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [partId, delta, newQty, reason, salesOrderId || null, userId || null]
    );
  }

  async adjustInventory(partId: string, delta: number, reason: string, salesOrderId?: number, userId?: number, client?: PoolClient): Promise<void> {
    const db = client || this.pool;
    // Normalize part number by removing dashes and spaces for lookup
    const normalizedPartNumber = partId.replace(/[-"\s]/g, '');
    
    // Row-level lock and fetch part_type and numeric part_id - try exact match first
    let result = await db.query('SELECT quantity_on_hand, part_type, part_id FROM inventory WHERE part_number = $1 FOR UPDATE', [partId]);
    
    // If not found, try normalized match
    if (result.rows.length === 0) {
      result = await db.query('SELECT quantity_on_hand, part_type, part_id FROM inventory WHERE part_number = $1 FOR UPDATE', [normalizedPartNumber]);
    }
    
    if (result.rows.length === 0) throw new Error(`Part not found: ${partId}`);

    const partType = result.rows[0].part_type;
    const numericPartId = result.rows[0].part_id;
    if (partType !== 'stock') {
      // For supply items, we don't track quantity, so no adjustment should happen
      // Or, depending on business logic, throw an error if adjustment is attempted on supply item
      console.warn(`Attempted to adjust inventory for non-stock part ${partId} (type: ${partType}). Skipping quantity adjustment.`);
      return; // Do not proceed with quantity adjustment for non-stock items
    }

    const onHand = parseFloat(result.rows[0].quantity_on_hand);
    if (isNaN(onHand)) { // Handle cases where quantity_on_hand might be 'NA' or invalid for a stock item
        throw new Error(`Invalid quantity_on_hand for stock part ${partId}: ${result.rows[0].quantity_on_hand}`);
    }

    const newQty = onHand + delta;
    if (newQty < 0) throw new Error(`Insufficient stock for part ${partId}. Available: ${onHand}, Requested: ${-delta}`);
    await db.query('UPDATE inventory SET quantity_on_hand = $1 WHERE part_number = $2', [newQty, partId]);
    await db.query(
      'INSERT INTO inventory_audit_log (part_id, delta, new_on_hand, reason, sales_order_id, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [numericPartId || null, delta, newQty, reason, salesOrderId || null, userId || null]
    );
  }
} 
import { Pool, PoolClient } from 'pg';

export class InventoryService {
  private pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }

  async getOnHand(partId: string, client?: PoolClient): Promise<number> {
    const db = client || this.pool;
    const result = await db.query('SELECT quantity_on_hand FROM inventory WHERE part_number = $1', [partId]);
    if (result.rows.length === 0) throw new Error(`Part not found: ${partId}`);
    return result.rows[0].quantity_on_hand;
  }

  async adjustInventory(partId: string, delta: number, reason: string, salesOrderId?: number, userId?: number, client?: PoolClient): Promise<void> {
    const db = client || this.pool;
    // Row-level lock
    const result = await db.query('SELECT quantity_on_hand FROM inventory WHERE part_number = $1 FOR UPDATE', [partId]);
    if (result.rows.length === 0) throw new Error(`Part not found: ${partId}`);
    const onHand = parseFloat(result.rows[0].quantity_on_hand);
    const newQty = onHand + delta;
    if (newQty < 0) throw new Error(`Insufficient stock for part ${partId}. Available: ${onHand}, Requested: ${-delta}`);
    await db.query('UPDATE inventory SET quantity_on_hand = $1 WHERE part_number = $2', [newQty, partId]);
    await db.query(
      'INSERT INTO inventory_audit_log (part_id, delta, new_on_hand, reason, sales_order_id, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [partId, delta, newQty, reason, salesOrderId || null, userId || null]
    );
  }
} 
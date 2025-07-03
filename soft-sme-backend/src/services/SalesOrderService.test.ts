import { Pool } from 'pg';
import { SalesOrderService } from './SalesOrderService';
import { InventoryService } from './InventoryService';

describe('SalesOrderService', () => {
  let pool: Pool;
  let salesOrderService: SalesOrderService;
  let inventoryService: InventoryService;
  const testPart = 'TESTPART_SO';
  let testOrderId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    salesOrderService = new SalesOrderService(pool);
    inventoryService = new InventoryService(pool);
    await pool.query(`INSERT INTO inventory (part_number, quantity_on_hand) VALUES ($1, 10) ON CONFLICT (part_number) DO UPDATE SET quantity_on_hand = 10`, [testPart]);
    // Insert a test sales order
    const res = await pool.query(`INSERT INTO salesorderhistory (customer_id, sales_date, status) VALUES (1, NOW(), 'Open') RETURNING sales_order_id`);
    testOrderId = res.rows[0].sales_order_id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM salesorderlineitems WHERE sales_order_id = $1`, [testOrderId]);
    await pool.query(`DELETE FROM salesorderhistory WHERE sales_order_id = $1`, [testOrderId]);
    await pool.query(`DELETE FROM inventory WHERE part_number = $1`, [testPart]);
    await pool.end();
  });

  test('add line item and adjust inventory', async () => {
    await salesOrderService.updateLineItem(testOrderId, testPart, 2);
    const qty = await inventoryService.getOnHand(testPart);
    expect(qty).toBe(8);
  });

  test('increase line item and adjust inventory', async () => {
    await salesOrderService.updateLineItem(testOrderId, testPart, 5);
    const qty = await inventoryService.getOnHand(testPart);
    expect(qty).toBe(5);
  });

  test('decrease line item and adjust inventory', async () => {
    await salesOrderService.updateLineItem(testOrderId, testPart, 3);
    const qty = await inventoryService.getOnHand(testPart);
    expect(qty).toBe(7);
  });

  test('delete line item and restore inventory', async () => {
    await salesOrderService.updateLineItem(testOrderId, testPart, 0);
    const qty = await inventoryService.getOnHand(testPart);
    expect(qty).toBe(10);
  });

  test('oversell should error', async () => {
    await expect(salesOrderService.updateLineItem(testOrderId, testPart, 20)).rejects.toThrow(/Insufficient stock/);
  });

  test('cannot modify closed order', async () => {
    await salesOrderService.closeOrder(testOrderId);
    await expect(salesOrderService.updateLineItem(testOrderId, testPart, 1)).rejects.toThrow(/closed order/);
  });

  test('delete order restores inventory', async () => {
    // Reopen and add line item
    await pool.query(`UPDATE salesorderhistory SET status = 'Open' WHERE sales_order_id = $1`, [testOrderId]);
    await salesOrderService.updateLineItem(testOrderId, testPart, 2);
    await salesOrderService.deleteOrder(testOrderId);
    const qty = await inventoryService.getOnHand(testPart);
    expect(qty).toBe(10);
  });
}); 
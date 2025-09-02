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
    await salesOrderService.upsertLineItem(testOrderId, {
      part_number: testPart,
      part_description: 'Test Part',
      quantity: 2,
      unit: 'EA',
      unit_price: 10,
      line_amount: 20
    }, undefined, { access_role: 'Admin' });
    const qty = await inventoryService.getOnHand(testPart);
    expect(qty).toBe(8);
  });

  test('increase line item and adjust inventory', async () => {
    await salesOrderService.upsertLineItem(testOrderId, {
      part_number: testPart,
      part_description: 'Test Part',
      quantity: 5,
      unit: 'EA',
      unit_price: 10,
      line_amount: 50
    }, undefined, { access_role: 'Admin' });
    const qty = await inventoryService.getOnHand(testPart);
    expect(qty).toBe(5);
  });

  test('decrease line item and adjust inventory', async () => {
    await salesOrderService.upsertLineItem(testOrderId, {
      part_number: testPart,
      part_description: 'Test Part',
      quantity: 3,
      unit: 'EA',
      unit_price: 10,
      line_amount: 30
    }, undefined, { access_role: 'Admin' });
    const qty = await inventoryService.getOnHand(testPart);
    expect(qty).toBe(7);
  });

  test('delete line item and restore inventory', async () => {
    await salesOrderService.upsertLineItem(testOrderId, {
      part_number: testPart,
      part_description: 'Test Part',
      quantity: 0,
      unit: 'EA',
      unit_price: 10,
      line_amount: 0
    }, undefined, { access_role: 'Admin' });
    const qty = await inventoryService.getOnHand(testPart);
    expect(qty).toBe(10);
  });

  test('oversell should error', async () => {
    await expect(salesOrderService.upsertLineItem(testOrderId, {
      part_number: testPart,
      part_description: 'Test Part',
      quantity: 20,
      unit: 'EA',
      unit_price: 10,
      line_amount: 200
    }, undefined, { access_role: 'Admin' })).rejects.toThrow(/Insufficient inventory/);
  });

  test('cannot modify closed order', async () => {
    await salesOrderService.closeOrder(testOrderId);
    await expect(salesOrderService.upsertLineItem(testOrderId, {
      part_number: testPart,
      part_description: 'Test Part',
      quantity: 1,
      unit: 'EA',
      unit_price: 10,
      line_amount: 10
    }, undefined, { access_role: 'Admin' })).rejects.toThrow(/Cannot modify closed order/);
  });

  test('delete order restores inventory', async () => {
    // Reopen and add line item
    await pool.query(`UPDATE salesorderhistory SET status = 'Open' WHERE sales_order_id = $1`, [testOrderId]);
    await salesOrderService.upsertLineItem(testOrderId, {
      part_number: testPart,
      part_description: 'Test Part',
      quantity: 2,
      unit: 'EA',
      unit_price: 10,
      line_amount: 20
    }, undefined, { access_role: 'Admin' });
    await salesOrderService.deleteOrder(testOrderId);
    const qty = await inventoryService.getOnHand(testPart);
    expect(qty).toBe(10);
  });

  test('non-admin can save LABOUR line item with quantity 0', async () => {
    // Non-admin users should be able to save LABOUR line items with quantity 0
    await expect(salesOrderService.upsertLineItem(testOrderId, {
      part_number: 'LABOUR',
      part_description: 'Labour',
      quantity: 0,
      unit: 'Hours',
      unit_price: 50,
      line_amount: 0
    }, undefined, { access_role: 'User' })).resolves.not.toThrow();
  });

  test('non-admin can save OVERHEAD line item with quantity 0', async () => {
    // Non-admin users should be able to save OVERHEAD line items with quantity 0
    await expect(salesOrderService.upsertLineItem(testOrderId, {
      part_number: 'OVERHEAD',
      part_description: 'Overhead',
      quantity: 0,
      unit: 'Hours',
      unit_price: 25,
      line_amount: 0
    }, undefined, { access_role: 'User' })).resolves.not.toThrow();
  });

  test('non-admin cannot delete SUPPLY line item', async () => {
    await expect(salesOrderService.upsertLineItem(testOrderId, {
      part_number: 'SUPPLY',
      part_description: 'Supply',
      quantity: 0,
      unit: 'Each',
      unit_price: 10,
      line_amount: 0
    }, undefined, { access_role: 'User' })).rejects.toThrow(/Only administrators can delete SUPPLY line items/);
  });

  test('admin can delete LABOUR line item', async () => {
    // First add the line item
    await salesOrderService.upsertLineItem(testOrderId, {
      part_number: 'LABOUR',
      part_description: 'Labour',
      quantity: 5,
      unit: 'Hours',
      unit_price: 50,
      line_amount: 250
    }, undefined, { access_role: 'Admin' });
    
    // Then delete it as admin
    await salesOrderService.upsertLineItem(testOrderId, {
      part_number: 'LABOUR',
      part_description: 'Labour',
      quantity: 0,
      unit: 'Hours',
      unit_price: 50,
      line_amount: 0
    }, undefined, { access_role: 'Admin' });
    
    // Verify it was deleted
    const result = await pool.query('SELECT * FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = $2', [testOrderId, 'LABOUR']);
    expect(result.rows.length).toBe(0);
  });

  test('sales and purchase user can save LABOUR line item with positive quantity (fix for false deletion error)', async () => {
    // This should not throw an error even though quantity_to_order is not provided
    await expect(salesOrderService.upsertLineItem(testOrderId, {
      part_number: 'LABOUR',
      part_description: 'Labour',
      quantity: 5,
      unit: 'Hours',
      unit_price: 50,
      line_amount: 250
      // Note: quantity_to_order is not provided, which was causing the false positive
    }, undefined, { access_role: 'Sales and Purchase' })).resolves.not.toThrow();
  });

  test('sales and purchase user can delete LABOUR line item', async () => {
    // First add the line item
    await salesOrderService.upsertLineItem(testOrderId, {
      part_number: 'LABOUR',
      part_description: 'Labour',
      quantity: 5,
      unit: 'Hours',
      unit_price: 50,
      line_amount: 250
    }, undefined, { access_role: 'Sales and Purchase' });
    
    // Then delete it as sales and purchase user
    await salesOrderService.upsertLineItem(testOrderId, {
      part_number: 'LABOUR',
      part_description: 'Labour',
      quantity: 0,
      unit: 'Hours',
      unit_price: 50,
      line_amount: 0
    }, undefined, { access_role: 'Sales and Purchase' });
    
    // Verify it was deleted
    const result = await pool.query('SELECT * FROM salesorderlineitems WHERE sales_order_id = $1 AND part_number = $2', [testOrderId, 'LABOUR']);
    expect(result.rows.length).toBe(0);
  });
}); 
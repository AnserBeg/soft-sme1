import { Pool } from 'pg';
import { InventoryService } from './InventoryService';

describe('InventoryService', () => {
  let pool: Pool;
  let service: InventoryService;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    service = new InventoryService(pool);
    // Setup: create test part
    await pool.query("INSERT INTO inventory (part_number, quantity_on_hand) VALUES ('TESTPART', 10) ON CONFLICT (part_number) DO UPDATE SET quantity_on_hand = 10");
  });

  afterAll(async () => {
    await pool.query("DELETE FROM inventory WHERE part_number = 'TESTPART'");
    await pool.end();
  });

  test('getOnHand returns correct quantity', async () => {
    const qty = await service.getOnHand('TESTPART');
    expect(qty).toBe(10);
  });

  test('adjustInventory increases and decreases stock', async () => {
    await service.adjustInventory('TESTPART', -2, 'unit test');
    let qty = await service.getOnHand('TESTPART');
    expect(qty).toBe(8);
    await service.adjustInventory('TESTPART', 2, 'unit test');
    qty = await service.getOnHand('TESTPART');
    expect(qty).toBe(10);
  });

  test('adjustInventory throws on oversell', async () => {
    await expect(service.adjustInventory('TESTPART', -20, 'oversell')).rejects.toThrow(/Insufficient stock/);
  });

  test('audit log is written', async () => {
    await service.adjustInventory('TESTPART', -1, 'audit test');
    const result = await pool.query("SELECT * FROM inventory_audit_log WHERE part_id = 'TESTPART' AND reason = 'audit test' ORDER BY created_at DESC LIMIT 1");
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].delta).toBe(-1);
  });
}); 
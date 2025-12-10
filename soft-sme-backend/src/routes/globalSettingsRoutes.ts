import express, { Request, Response } from 'express';
import { pool } from '../db';
import { adminAuth } from '../middleware/authMiddleware';

const router = express.Router();

type SalesOrderFieldVisibility = {
  customerPoNumber: boolean;
  quotedPrice: boolean;
  sourceQuote: boolean;
  vin: boolean;
  unitNumber: boolean;
  vehicleMake: boolean;
  vehicleModel: boolean;
  invoiceStatus: boolean;
  wantedByDate: boolean;
  wantedByTimeOfDay: boolean;
  productDescription: boolean;
  terms: boolean;
  mileage: boolean;
};

type InvoiceFieldVisibility = {
  vin: boolean;
  productDescription: boolean;
  unitNumber: boolean;
  vehicleMake: boolean;
  vehicleModel: boolean;
  mileage: boolean;
};

type FieldVisibilitySettings = {
  salesOrders: SalesOrderFieldVisibility;
  invoices: InvoiceFieldVisibility;
};

const FIELD_VISIBILITY_KEY = 'field_visibility_settings';

const DEFAULT_FIELD_VISIBILITY: FieldVisibilitySettings = {
  salesOrders: {
    customerPoNumber: true,
    quotedPrice: true,
    sourceQuote: true,
    vin: true,
    unitNumber: true,
    vehicleMake: true,
    vehicleModel: true,
    invoiceStatus: true,
    wantedByDate: true,
    wantedByTimeOfDay: true,
    productDescription: true,
    terms: true,
    mileage: true,
  },
  invoices: {
    vin: true,
    productDescription: true,
    unitNumber: true,
    vehicleMake: true,
    vehicleModel: true,
    mileage: true,
  },
};

const cloneDefaultVisibility = (): FieldVisibilitySettings => ({
  salesOrders: { ...DEFAULT_FIELD_VISIBILITY.salesOrders },
  invoices: { ...DEFAULT_FIELD_VISIBILITY.invoices },
});

const normalizeVisibilityMap = <T extends Record<string, boolean>>(
  incoming: any,
  defaults: T,
): T => {
  if (!incoming || typeof incoming !== 'object') {
    return { ...defaults };
  }
  const result = { ...defaults };
  (Object.keys(defaults) as (keyof T)[]).forEach(key => {
    const raw = (incoming as any)[key];
    result[key] = typeof raw === 'boolean' ? raw : defaults[key];
  });
  return result;
};

const parseFieldVisibilitySettings = (raw: any): FieldVisibilitySettings => {
  if (!raw || typeof raw !== 'string') return cloneDefaultVisibility();
  try {
    const parsed = JSON.parse(raw);
    const salesOrders = normalizeVisibilityMap(
      parsed?.salesOrders,
      DEFAULT_FIELD_VISIBILITY.salesOrders,
    );
    const invoices = normalizeVisibilityMap(
      parsed?.invoices,
      DEFAULT_FIELD_VISIBILITY.invoices,
    );
    return { salesOrders, invoices };
  } catch {
    return cloneDefaultVisibility();
  }
};

// Get the default field visibility settings for sales orders and invoices
router.get('/field-visibility', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT value FROM global_settings WHERE key = $1',
      [FIELD_VISIBILITY_KEY],
    );
    const value = result.rows[0]?.value ?? null;
    const settings = parseFieldVisibilitySettings(value);
    res.json({ settings });
  } catch (err) {
    console.error('globalSettingsRoutes: Error fetching field visibility settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update the default field visibility settings (Admin only)
router.put('/field-visibility', adminAuth, async (req: Request, res: Response) => {
  try {
    const payload = req.body || {};
    const settings: FieldVisibilitySettings = {
      salesOrders: normalizeVisibilityMap(
        payload.salesOrders,
        DEFAULT_FIELD_VISIBILITY.salesOrders,
      ),
      invoices: normalizeVisibilityMap(
        payload.invoices,
        DEFAULT_FIELD_VISIBILITY.invoices,
      ),
    };

    await pool.query(
      'INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [FIELD_VISIBILITY_KEY, JSON.stringify(settings)],
    );

    res.json({ success: true, settings });
  } catch (err) {
    console.error('globalSettingsRoutes: Error updating field visibility settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to update sales order line items when global rates change
async function updateSalesOrderRates(rateType: 'labour' | 'overhead' | 'supply', newRate: number) {
  try {
    if (rateType === 'labour') {
      // Update all LABOUR line items with new unit price
      await pool.query(
        `UPDATE salesorderlineitems 
         SET unit_price = $1 
         WHERE part_number = 'LABOUR'`,
        [newRate]
      );
      
      // Recalculate line amounts for LABOUR items
      await pool.query(
        `UPDATE salesorderlineitems 
         SET line_amount = quantity_sold * unit_price 
         WHERE part_number = 'LABOUR'`
      );
      
    } else if (rateType === 'overhead') {
      // Update all OVERHEAD line items with new unit price
      await pool.query(
        `UPDATE salesorderlineitems 
         SET unit_price = $1 
         WHERE part_number = 'OVERHEAD'`,
        [newRate]
      );
      
      // Recalculate line amounts for OVERHEAD items
      await pool.query(
        `UPDATE salesorderlineitems 
         SET line_amount = quantity_sold * unit_price 
         WHERE part_number = 'OVERHEAD'`
      );
      
    } else if (rateType === 'supply') {
      // For supply, we need to recalculate based on labour line amounts
      // First get all sales orders that have both LABOUR and SUPPLY items
      const salesOrdersWithSupply = await pool.query(
        `SELECT DISTINCT sales_order_id 
         FROM salesorderlineitems 
         WHERE part_number = 'SUPPLY'`
      );
      
      for (const row of salesOrdersWithSupply.rows) {
        const salesOrderId = row.sales_order_id;
        
        // Get the labour line amount for this sales order
        const labourResult = await pool.query(
          `SELECT line_amount FROM salesorderlineitems 
           WHERE sales_order_id = $1 AND part_number = 'LABOUR'`,
          [salesOrderId]
        );
        
        if (labourResult.rows.length > 0) {
          const labourAmount = parseFloat(labourResult.rows[0].line_amount) || 0;
          const supplyAmount = labourAmount * (newRate / 100);
          
          // Update the supply line amount
          await pool.query(
            `UPDATE salesorderlineitems 
             SET line_amount = $1 
             WHERE sales_order_id = $2 AND part_number = 'SUPPLY'`,
            [supplyAmount, salesOrderId]
          );
        }
      }
    }
  } catch (error) {
    console.error(`Error updating sales order rates for ${rateType}:`, error);
    throw error;
  }
}

// Get the global labour rate
router.get('/labour-rate', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT value FROM global_settings WHERE key = $1', ['labour_rate']);
    if (result.rows.length === 0) {
      return res.json({ labour_rate: null });
    }
    res.json({ labour_rate: parseFloat(result.rows[0].value) });
  } catch (err) {
    console.error('globalSettingsRoutes: Error fetching labour rate:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update the global labour rate
router.put('/labour-rate', async (req: Request, res: Response) => {
  const { labour_rate } = req.body;
  if (typeof labour_rate !== 'number' || isNaN(labour_rate) || labour_rate < 0) {
    return res.status(400).json({ error: 'Invalid labour rate' });
  }
  try {
    // Update the global setting
    await pool.query(
      'INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['labour_rate', labour_rate.toString()]
    );
    
    // Update all existing sales order LABOUR line items
    await updateSalesOrderRates('labour', labour_rate);
    
    // Also update SUPPLY line items since they depend on labour amounts
    const supplyRateResult = await pool.query('SELECT value FROM global_settings WHERE key = $1', ['supply_rate']);
    if (supplyRateResult.rows.length > 0) {
      const supplyRate = parseFloat(supplyRateResult.rows[0].value);
      if (supplyRate > 0) {
        await updateSalesOrderRates('supply', supplyRate);
      }
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('globalSettingsRoutes: Error updating labour rate:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get the global overhead rate
router.get('/overhead-rate', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT value FROM global_settings WHERE key = $1', ['overhead_rate']);
    if (result.rows.length === 0) {
      return res.json({ overhead_rate: null });
    }
    res.json({ overhead_rate: parseFloat(result.rows[0].value) });
  } catch (err) {
    console.error('globalSettingsRoutes: Error fetching overhead rate:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update the global overhead rate
router.put('/overhead-rate', async (req: Request, res: Response) => {
  const { overhead_rate } = req.body;
  if (typeof overhead_rate !== 'number' || isNaN(overhead_rate) || overhead_rate < 0) {
    return res.status(400).json({ error: 'Invalid overhead rate' });
  }
  try {
    // Update the global setting
    await pool.query(
      'INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['overhead_rate', overhead_rate.toString()]
    );
    
    // Update all existing sales order OVERHEAD line items
    await updateSalesOrderRates('overhead', overhead_rate);
    
    res.json({ success: true });
  } catch (err) {
    console.error('globalSettingsRoutes: Error updating overhead rate:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get the global supply rate
router.get('/supply-rate', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT value FROM global_settings WHERE key = $1', ['supply_rate']);
    if (result.rows.length === 0) {
      return res.json({ supply_rate: null });
    }
    res.json({ supply_rate: parseFloat(result.rows[0].value) });
  } catch (err) {
    console.error('globalSettingsRoutes: Error fetching supply rate:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update the global supply rate
router.put('/supply-rate', async (req: Request, res: Response) => {
  const { supply_rate } = req.body;
  if (typeof supply_rate !== 'number' || isNaN(supply_rate) || supply_rate < 0) {
    return res.status(400).json({ error: 'Invalid supply rate' });
  }
  try {
    // Update the global setting
    await pool.query(
      'INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['supply_rate', supply_rate.toString()]
    );
    
    // Update all existing sales order SUPPLY line items
    await updateSalesOrderRates('supply', supply_rate);
    
    res.json({ success: true });
  } catch (err) {
    console.error('globalSettingsRoutes: Error updating supply rate:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get labour hourly rate charged to customer (for invoices)
router.get('/labour-charge-rate', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT value FROM global_settings WHERE key = $1', ['labour_charge_rate']);
    if (result.rows.length === 0) {
      return res.json({ labour_charge_rate: null });
    }
    res.json({ labour_charge_rate: parseFloat(result.rows[0].value) });
  } catch (err) {
    console.error('globalSettingsRoutes: Error fetching labour charge rate:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update labour hourly rate charged to customer (for invoices)
router.put('/labour-charge-rate', async (req: Request, res: Response) => {
  const { labour_charge_rate } = req.body;
  if (typeof labour_charge_rate !== 'number' || isNaN(labour_charge_rate) || labour_charge_rate < 0) {
    return res.status(400).json({ error: 'Invalid labour charge rate' });
  }
  try {
    await pool.query(
      'INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['labour_charge_rate', labour_charge_rate.toString()]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('globalSettingsRoutes: Error updating labour charge rate:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get overhead hourly rate charged to customer (for invoices)
router.get('/overhead-charge-rate', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT value FROM global_settings WHERE key = $1', ['overhead_charge_rate']);
    if (result.rows.length === 0) {
      return res.json({ overhead_charge_rate: null });
    }
    res.json({ overhead_charge_rate: parseFloat(result.rows[0].value) });
  } catch (err) {
    console.error('globalSettingsRoutes: Error fetching overhead charge rate:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update overhead hourly rate charged to customer (for invoices)
router.put('/overhead-charge-rate', async (req: Request, res: Response) => {
  const { overhead_charge_rate } = req.body;
  if (typeof overhead_charge_rate !== 'number' || isNaN(overhead_charge_rate) || overhead_charge_rate < 0) {
    return res.status(400).json({ error: 'Invalid overhead charge rate' });
  }
  try {
    await pool.query(
      'INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['overhead_charge_rate', overhead_charge_rate.toString()]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('globalSettingsRoutes: Error updating overhead charge rate:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get the daily break start time
router.get('/daily-break-start', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT value FROM global_settings WHERE key = $1', ['daily_break_start']);
    if (result.rows.length === 0) {
      return res.json({ daily_break_start: null });
    }
    res.json({ daily_break_start: result.rows[0].value });
  } catch (err) {
    console.error('globalSettingsRoutes: Error fetching daily break start time:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update the daily break start time
router.put('/daily-break-start', async (req: Request, res: Response) => {
  const { daily_break_start } = req.body;
  if (typeof daily_break_start !== 'string') {
    return res.status(400).json({ error: 'Invalid daily break start time' });
  }
  try {
    await pool.query(
      'INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['daily_break_start', daily_break_start]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('globalSettingsRoutes: Error updating daily break start time:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get the daily break end time
router.get('/daily-break-end', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT value FROM global_settings WHERE key = $1', ['daily_break_end']);
    if (result.rows.length === 0) {
      return res.json({ daily_break_end: null });
    }
    res.json({ daily_break_end: result.rows[0].value });
  } catch (err) {
    console.error('globalSettingsRoutes: Error fetching daily break end time:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update the daily break end time
router.put('/daily-break-end', async (req: Request, res: Response) => {
  const { daily_break_end } = req.body;
  if (typeof daily_break_end !== 'string') {
    return res.status(400).json({ error: 'Invalid daily break end time' });
  }
  try {
    await pool.query(
      'INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['daily_break_end', daily_break_end]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('globalSettingsRoutes: Error updating daily break end time:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 

import express, { Request, Response } from 'express';
import { pool } from '../db';

const router = express.Router();

// Get all closed purchase history records
router.get('/', async (req: Request, res: Response) => {
  const { startDate, endDate, status, searchTerm } = req.query;

  try {
    let query = `
      SELECT 
        ph.*,
        CAST(ph.subtotal AS FLOAT) as subtotal,
        CAST(ph.total_gst_amount AS FLOAT) as total_gst_amount,
        CAST(ph.total_amount AS FLOAT) as total_amount,
        vm.vendor_name 
      FROM purchasehistory ph 
      JOIN vendormaster vm ON ph.vendor_id = vm.vendor_id 
    `;

    const whereClauses = [];
    const queryParams = [];
    let paramIndex = 1;

    if (status && status !== 'all') {
      whereClauses.push(`LOWER(ph.status) = $${paramIndex++}`);
      queryParams.push(String(status).toLowerCase());
    }

    if (startDate) {
      whereClauses.push(`ph.purchase_date >= $${paramIndex++}`);
      queryParams.push(new Date(startDate as string).toISOString());
    }

    if (endDate) {
      whereClauses.push(`ph.purchase_date <= $${paramIndex++}`);
      queryParams.push(new Date(endDate as string).toISOString());
    }

    if (searchTerm) {
      whereClauses.push(`
        (ph.purchase_number ILIKE $${paramIndex} OR 
         vm.vendor_name ILIKE $${paramIndex} OR 
         ph.bill_number ILIKE $${paramIndex})
      `);
      queryParams.push(`%${searchTerm}%`);
      paramIndex++;
    }

    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ');
    }

    query += ' ORDER BY ph.created_at DESC';

    const result = await pool.query(query, queryParams);
    res.json(result.rows);
  } catch (err) {
    console.error('purchaseHistoryRoutes: Error fetching purchase history:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all open purchase orders
router.get('/open', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT 
        ph.*,
        CAST(ph.subtotal AS FLOAT) as subtotal,
        CAST(ph.total_gst_amount AS FLOAT) as total_gst_amount,
        CAST(ph.total_amount AS FLOAT) as total_amount,
        vm.vendor_name 
      FROM purchasehistory ph 
      JOIN vendormaster vm ON ph.vendor_id = vm.vendor_id 
      WHERE LOWER(ph.status) = 'open'
      ORDER BY ph.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('purchaseHistoryRoutes: Error fetching open purchase orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a purchase order by ID
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    // First, delete related line items
    await pool.query('DELETE FROM purchaselineitems WHERE purchase_id = $1', [id]);
    
    // Then, delete the purchase order itself
    const result = await pool.query('DELETE FROM purchasehistory WHERE purchase_id = $1', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    
    res.status(200).json({ message: 'Purchase order deleted successfully' });
  } catch (err) {
    console.error(`purchaseHistoryRoutes: Error deleting purchase order ${id}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a purchase order (e.g., to change status)
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get the current state of the PO
    const currentPoResult = await client.query('SELECT * FROM purchasehistory WHERE purchase_id = $1', [id]);
    if (currentPoResult.rows.length === 0) {
      throw new Error('Purchase order not found');
    }
    const currentPo = currentPoResult.rows[0];
    const oldStatus = currentPo.status;

    // If the status is not changing, do nothing extra.
    if (oldStatus === status) {
      // Still might need to update other fields like bill_number
      const { bill_number } = req.body;
      const result = await client.query(
        'UPDATE purchasehistory SET bill_number = $1, updated_at = NOW() WHERE purchase_id = $2 RETURNING *',
        [bill_number, id]
      );
      await client.query('COMMIT');
      return res.json(result.rows[0]);
    }

    // Get line items for inventory adjustments
    const lineItemsResult = await client.query('SELECT * FROM purchaselineitems WHERE purchase_id = $1', [id]);
    const lineItems = lineItemsResult.rows;

    if (status === 'Closed' && oldStatus !== 'Closed') {
      // === CLOSE PO LOGIC ===
      for (const item of lineItems) {
        const unitCost = parseFloat(item.unit_cost);
        if (isNaN(unitCost)) {
          console.error(`Invalid unit_cost for part_number ${item.part_number}. Skipping update for this item.`);
          continue; // Skip this item if unit_cost is not a valid number
        }

        console.log(`purchaseHistoryRoutes: Updating inventory for part: '${item.part_number}' (quantity: ${item.quantity}, unit_cost: ${unitCost})`);
        
        // Use INSERT ... ON CONFLICT to handle both new and existing parts
        const updateResult = await client.query(
          `INSERT INTO inventory (part_number, part_description, unit, last_unit_cost, quantity_on_hand) 
           VALUES ($1, $2, $3, $4, $5) 
           ON CONFLICT (part_number) 
           DO UPDATE SET 
             quantity_on_hand = inventory.quantity_on_hand + EXCLUDED.quantity_on_hand,
             last_unit_cost = EXCLUDED.last_unit_cost,
             part_description = EXCLUDED.part_description,
             unit = EXCLUDED.unit`,
          [item.part_number, item.part_description, item.unit, unitCost, item.quantity]
        );
        console.log(`purchaseHistoryRoutes: Inventory update for part '${item.part_number}' completed.`);
      }
    } else if (status === 'Open' && oldStatus === 'Closed') {
      // === REOPEN PO LOGIC ===
      for (const item of lineItems) {
        // Check for negative inventory before proceeding
        const invResult = await client.query('SELECT quantity_on_hand FROM inventory WHERE part_number = $1', [item.part_number]);
        const currentQuantity = invResult.rows[0]?.quantity_on_hand || 0;
        if (currentQuantity < item.quantity) {
          throw new Error(`Cannot reopen PO. Reopening would result in negative inventory for part: ${item.part_number}.`);
        }
      }
      // If all checks pass, proceed with updates
      for (const item of lineItems) {
        await client.query(
          `UPDATE inventory 
           SET quantity_on_hand = quantity_on_hand - $1
           WHERE part_number = $2`,
          [item.quantity, item.part_number]
        );
      }
    }
    
    // Finally, update the PO status and other fields
    const { bill_number } = req.body;
    const finalUpdateResult = await client.query(
      'UPDATE purchasehistory SET status = $1, bill_number = $2, updated_at = NOW() WHERE purchase_id = $3 RETURNING *',
      [status, bill_number, id]
    );

    await client.query('COMMIT');
    res.json(finalUpdateResult.rows[0]);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`purchaseHistoryRoutes: Error updating purchase order ${id}:`, err);
    // Ensure err is an instance of Error to access message property
    const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
    res.status(500).json({ error: 'Internal server error', message: errorMessage });
  } finally {
    client.release();
  }
});

// Get the latest purchase order number for the current year
router.get('/latest-po-number', async (req: Request, res: Response) => {
  try {
    const currentYear = new Date().getFullYear().toString();
    const result = await pool.query(
      `SELECT purchase_number FROM purchasehistory 
       WHERE purchase_number LIKE $1 
       ORDER BY purchase_number DESC 
       LIMIT 1`,
      [`${currentYear}%`]
    );

    if (result.rows.length === 0) {
      res.json({ latestPurchaseNumber: null });
    } else {
      res.json({ latestPurchaseNumber: result.rows[0].purchase_number });
    }
  } catch (err) {
    console.error('purchaseHistoryRoutes: Error fetching latest PO number:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a specific purchase order by ID (open or closed)
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const purchaseOrderResult = await pool.query(
      `SELECT ph.*, ph.subtotal, ph.total_gst_amount, vm.vendor_name 
       FROM purchasehistory ph 
       JOIN vendormaster vm ON ph.vendor_id = vm.vendor_id 
       WHERE ph.purchase_id = $1`,
      [id]
    );
    if (purchaseOrderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    const purchaseOrder = purchaseOrderResult.rows[0];
    const lineItemsResult = await pool.query(
      'SELECT * FROM purchaselineitems WHERE purchase_id = $1',
      [id]
    );
    const fullPurchaseOrder = { ...purchaseOrder, lineItems: lineItemsResult.rows };
    res.json(fullPurchaseOrder);
  } catch (err) {
    console.error('purchaseHistoryRoutes: Error fetching purchase order:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 
import express, { Request, Response } from 'express';
import { pool } from '../db';
import PDFDocument from 'pdfkit';
import { getNextPurchaseOrderNumberForYear } from '../utils/sequence';

const router = express.Router();

// Get all open purchase orders
router.get('/open', async (req: Request, res: Response) => {
  console.log('purchaseOrderRoutes: GET /open - Request received');
  console.log('purchaseOrderRoutes: Query params:', req.query);
  
  try {
    const { startDate, endDate, status, searchTerm } = req.query;
    
    let query = `
      SELECT poh.purchase_id, poh.purchase_number, vm.vendor_name, poh.purchase_date as bill_date, 
             poh.purchase_number as bill_number, poh.subtotal, poh.total_gst_amount, poh.total_amount, poh.status
      FROM purchasehistory poh
      JOIN vendormaster vm ON poh.vendor_id = vm.vendor_id
      WHERE 1=1
    `;
    
    const params: any[] = [];
    let paramIndex = 1;

    // Add date range filter if provided
    if (startDate && endDate) {
      query += ` AND poh.purchase_date BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
      params.push(startDate, endDate);
      paramIndex += 2;
    }

    // Add status filter if provided and not 'all'
    if (status && status !== 'all') {
      query += ` AND poh.status = $${paramIndex}`;
      params.push(status);
      paramIndex += 1;
    }

    // Add search term filter if provided
    if (searchTerm) {
      query += ` AND (
        poh.purchase_number ILIKE $${paramIndex} OR
        vm.vendor_name ILIKE $${paramIndex} OR
        poh.purchase_number ILIKE $${paramIndex}
      )`;
      params.push(`%${searchTerm}%`);
      paramIndex += 1;
    }

    query += ` ORDER BY poh.created_at DESC`;

    console.log('purchaseOrderRoutes: Final query:', query);
    console.log('purchaseOrderRoutes: Query params:', params);

    const result = await pool.query(query, params);
    console.log('purchaseOrderRoutes: Query result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('purchaseOrderRoutes: Error fetching open purchase orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all closed purchase orders (history)
router.get('/history', async (req: Request, res: Response) => {
  console.log('purchaseOrderRoutes: GET /history - Request received');
  try {
    const result = await pool.query(`
      SELECT poh.purchase_id, poh.purchase_number, vm.vendor_name, poh.purchase_date as bill_date, 
             poh.purchase_number as bill_number, poh.subtotal, poh.total_gst_amount, poh.total_amount, poh.status
      FROM purchasehistory poh
      JOIN vendormaster vm ON poh.vendor_id = vm.vendor_id
      WHERE poh.status = 'Closed' ORDER BY poh.created_at DESC`);
    console.log('purchaseOrderRoutes: History query result:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('purchaseOrderRoutes: Error fetching purchase order history:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a specific purchase order by ID (open or closed)
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  console.log('purchaseOrderRoutes: GET /:id - Request received for ID:', id);
  try {
    const purchaseOrderResult = await pool.query(
      `SELECT poh.*, vm.vendor_name FROM purchasehistory poh 
       JOIN vendormaster vm ON poh.vendor_id = vm.vendor_id 
       WHERE poh.purchase_id = $1`,
      [id]
    );
    if (purchaseOrderResult.rows.length === 0) {
      console.log('purchaseOrderRoutes: Purchase order not found for ID:', id);
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    const purchaseOrder = purchaseOrderResult.rows[0];
    console.log('purchaseOrderRoutes: Found purchase order:', purchaseOrder);
    
    const lineItemsResult = await pool.query(
      'SELECT * FROM purchaselineitems WHERE purchase_id = $1',
      [id]
    );
    console.log('purchaseOrderRoutes: Found line items:', lineItemsResult.rows);
    
    const fullPurchaseOrder = { ...purchaseOrder, lineItems: lineItemsResult.rows };
    res.json(fullPurchaseOrder);
  } catch (err) {
    console.error('purchaseOrderRoutes: Error fetching purchase order:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new parts purchase
router.post('/', async (req: Request, res: Response) => {
  const {
    vendor_id,
    bill_number,
    subtotal,
    total_gst_amount,
    total_amount,
    global_gst_rate,
    lineItems
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Generate PO number in format PO-YYYY-NNNNN
    const now = new Date();
    const year = now.getFullYear();
    const { poNumber } = await getNextPurchaseOrderNumberForYear(year);

    const purchaseResult = await client.query(
      `INSERT INTO purchasehistory (
        vendor_id, purchase_number, purchase_date, status, subtotal, total_gst_amount, total_amount, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING purchase_id`,
      [
        vendor_id,
        poNumber,
        new Date(), // purchase_date
        'Open',
        subtotal,
        total_gst_amount,
        total_amount
      ]
    );

    const purchase_id = purchaseResult.rows[0].purchase_id;

    for (const item of lineItems) {
      // Calculate line total and GST amount on the backend
      const line_total = (item.quantity || 0) * (item.unit_cost || 0);
      const gst_amount = line_total * (global_gst_rate / 100);

      await client.query(
        `INSERT INTO purchaselineitems (
          purchase_id, part_number, part_description, unit, quantity, unit_cost, gst_amount, line_total
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          purchase_id,
          item.part_number,
          item.part_description,
          item.unit,
          item.quantity,
          item.unit_cost,
          gst_amount,
          line_total,
        ]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ purchase_id });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('partsPurchaseRoutes: Error creating parts purchase:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete a purchase order
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  console.log('purchaseOrderRoutes: DELETE /:id - Request received for ID:', id);
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Delete line items first due to foreign key constraint
    await client.query('DELETE FROM purchaselineitems WHERE purchase_id = $1', [id]);
    
    // Delete the purchase order
    const result = await client.query('DELETE FROM purchasehistory WHERE purchase_id = $1 RETURNING purchase_id', [id]);
    
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    
    await client.query('COMMIT');
    res.json({ message: 'Purchase order deleted successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('purchaseOrderRoutes: Error deleting purchase order:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PUT route to handle comprehensive updates for purchase orders
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const updatedData = req.body;

  console.log(`purchaseOrderRoutes: PUT /:id - Request to update PO ID: ${id}`);
  console.log('Received data:', JSON.stringify(updatedData, null, 2));

  const { lineItems, ...purchaseOrderData } = updatedData;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      vendor_id,
      status,
      subtotal,
      total_gst_amount,
      total_amount,
      bill_number,
      purchase_date,
    } = purchaseOrderData;

    // Fetch old status to check for transitions
    const oldStatusResult = await client.query('SELECT status FROM "purchasehistory" WHERE purchase_id = $1', [id]);
    const oldStatus = oldStatusResult.rows[0]?.status;

    const updatePoQuery = `
      UPDATE "purchasehistory" SET
        vendor_id = $1,
        purchase_date = $2,
        status = $3,
        subtotal = $4,
        total_gst_amount = $5,
        total_amount = $6,
        bill_number = $7,
        updated_at = NOW()
      WHERE purchase_id = $8
      RETURNING *;
    `;

    const updatedPo = await client.query(updatePoQuery, [
      vendor_id,
      purchase_date || new Date(),
      status,
      subtotal,
      total_gst_amount,
      total_amount,
      bill_number,
      id
    ]);

    console.log('Updated PO Header:', updatedPo.rows[0]);

    // Update or insert line items
    for (const item of lineItems) {
      if (item.line_item_id) {
        // Update existing line item
        await client.query(`
          UPDATE "purchaselineitems" SET
            part_number = $1,
            part_description = $2,
            quantity = $3,
            unit_cost = $4,
            line_total = $5,
            unit = $6,
            updated_at = NOW()
          WHERE line_item_id = $7;
        `, [item.part_number, item.part_description, item.quantity, item.unit_cost, item.line_amount, item.unit, item.line_item_id]);
      } else {
        // Insert new line item
        await client.query(`
          INSERT INTO "purchaselineitems" (purchase_id, part_number, part_description, quantity, unit_cost, line_total, unit)
          VALUES ($1, $2, $3, $4, $5, $6, $7);
        `, [id, item.part_number, item.part_description, item.quantity, item.unit_cost, item.line_amount, item.unit]);
      }
    }
    
    // If PO is being closed, update inventory
    if (status === 'Closed' && oldStatus !== 'Closed') {
      console.log(`PO ${id} transitioning to Closed. Updating inventory...`);
      for (const item of lineItems) {
         const { part_number, quantity, unit_cost } = item;
         if (!part_number) continue;
  
         console.log(`Updating inventory for part: '${part_number}' (quantity: ${quantity}, unit_cost: ${unit_cost})`);
         
         await client.query(
           `INSERT INTO "inventory" (part_number, quantity_on_hand, last_unit_cost, part_description, unit)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (part_number)
            DO UPDATE SET
              quantity_on_hand = "inventory".quantity_on_hand + $2,
              last_unit_cost = $3,
              updated_at = NOW();`,
           [part_number, quantity, unit_cost, item.part_description, item.unit]
         );
      }
    }
  
    // If PO is being reopened, revert inventory quantity
    if (status === 'Open' && oldStatus === 'Closed') {
       console.log(`PO ${id} transitioning to Open. Reverting inventory quantities...`);
       for (const item of lineItems) {
         if (item.part_number) {
           await client.query(
            'UPDATE "inventory" SET quantity_on_hand = quantity_on_hand - $1 WHERE part_number = $2',
            [item.quantity, item.part_number]
           );
         }
       }
    }

    await client.query('COMMIT');
    res.status(200).json(updatedPo.rows[0]);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating purchase order:', error);
    res.status(500).json({ error: 'Failed to update purchase order' });
  } finally {
    client.release();
  }
});

// PDF Generation Route
router.get('/:id/pdf', async (req, res) => {
  const { id } = req.params;
  console.log(`PDF generation requested for PO ID: ${id}`);

  try {
    // Fetch Purchase Order Header
    const poResult = await pool.query(
      `SELECT po.*, v.vendor_name 
       FROM purchasehistory po
       LEFT JOIN vendormaster v ON po.vendor_id = v.vendor_id
       WHERE po.purchase_id = $1`,
      [id]
    );

    if (poResult.rows.length === 0) {
      return res.status(404).send('Purchase Order not found');
    }
    const purchaseOrder = poResult.rows[0];

    // Fetch Line Items
    const lineItemsResult = await pool.query(
      'SELECT * FROM purchaselineitems WHERE purchase_id = $1 ORDER BY line_item_id',
      [id]
    );
    const lineItems = lineItemsResult.rows;

    // Create a new PDF document
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=purchase_order_${purchaseOrder.purchase_number}.pdf`);

    doc.pipe(res);

    // Header
    doc.fontSize(20).text('Purchase Order', { align: 'center' });
    doc.moveDown();

    // PO Details
    doc.fontSize(12);
    doc.text(`Purchase Order #: ${purchaseOrder.purchase_number}`, { continued: true });
    doc.text(`Vendor: ${purchaseOrder.vendor_name}`, { align: 'right' });
    doc.text(`Date: ${new Date(purchaseOrder.purchase_date).toLocaleDateString()}`, { continued: true });
    doc.text(`Bill #: ${purchaseOrder.bill_number || 'N/A'}`, { align: 'right' });
    doc.moveDown(2);

    // Line Items Table
    const tableTop = doc.y;
    const itemX = 50;
    const descriptionX = 150;
    const qtyX = 350;
    const unitCostX = 420;
    const amountX = 500;

    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Part #', itemX, tableTop);
    doc.text('Description', descriptionX, tableTop);
    doc.text('Quantity', qtyX, tableTop, { width: 60, align: 'right' });
    doc.text('Unit Cost', unitCostX, tableTop, { width: 70, align: 'right' });
    doc.text('Amount', amountX, tableTop, { width: 70, align: 'right' });
    doc.font('Helvetica');

    let i = 0;
    for (const item of lineItems) {
      const y = tableTop + 25 + (i * 25);
      doc.text(item.part_number, itemX, y);
      doc.text(item.part_description, descriptionX, y);
      doc.text(item.quantity.toString(), qtyX, y, { width: 60, align: 'right' });
      doc.text(parseFloat(item.unit_cost).toFixed(2), unitCostX, y, { width: 70, align: 'right' });
      doc.text(parseFloat(item.line_total).toFixed(2), amountX, y, { width: 70, align: 'right' });
      i++;
    }
    
    // Summary
    const summaryTop = tableTop + 25 + (lineItems.length * 25) + 20;
    doc.font('Helvetica-Bold');
    doc.text(`Subtotal:`, 400, summaryTop, {width: 90, align: 'right'});
    doc.text(`${parseFloat(purchaseOrder.subtotal).toFixed(2)}`, 500, summaryTop, {width: 70, align: 'right'});
    
    doc.text(`GST:`, 400, summaryTop + 15, {width: 90, align: 'right'});
    doc.text(`${parseFloat(purchaseOrder.total_gst_amount).toFixed(2)}`, 500, summaryTop + 15, {width: 70, align: 'right'});
    
    doc.text(`Total:`, 400, summaryTop + 30, {width: 90, align: 'right'});
    doc.text(`${parseFloat(purchaseOrder.total_amount).toFixed(2)}`, 500, summaryTop + 30, {width: 70, align: 'right'});

    // Finalize the PDF and end the stream
    doc.end();

  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).send('Error generating PDF');
  }
});

export default router; 
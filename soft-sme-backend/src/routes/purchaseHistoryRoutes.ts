import express, { Request, Response } from 'express';
import { pool } from '../db';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

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
        const quantity = parseInt(item.quantity, 10);
        if (isNaN(unitCost) || isNaN(quantity)) {
          console.error(`Invalid unit_cost or quantity for part_number ${item.part_number}. Skipping update for this item.`);
          continue; // Skip this item if unit_cost or quantity is not a valid number
        }

        console.log(`purchaseHistoryRoutes: Updating inventory for part: '${item.part_number}' (quantity: ${quantity}, unit_cost: ${unitCost})`);
        // Use INSERT ... ON CONFLICT to handle both new and existing parts
        await client.query(
          `INSERT INTO inventory (part_number, part_description, unit, last_unit_cost, quantity_on_hand) 
           VALUES ($1, $2, $3, $4, $5) 
           ON CONFLICT (part_number) 
           DO UPDATE SET 
             quantity_on_hand = inventory.quantity_on_hand + EXCLUDED.quantity_on_hand,
             last_unit_cost = EXCLUDED.last_unit_cost,
             part_description = EXCLUDED.part_description,
             unit = EXCLUDED.unit`,
          [item.part_number, item.part_description, item.unit, unitCost, quantity]
        );
        console.log(`purchaseHistoryRoutes: Inventory update for part '${item.part_number}' completed.`);
      }
    } else if (status === 'Open' && oldStatus === 'Closed') {
      // === REOPEN PO LOGIC ===
      for (const item of lineItems) {
        const quantity = parseInt(item.quantity, 10);
        // Check for negative inventory before proceeding
        const invResult = await client.query('SELECT quantity_on_hand FROM inventory WHERE part_number = $1', [item.part_number]);
        const currentQuantity = invResult.rows[0]?.quantity_on_hand || 0;
        if (currentQuantity < quantity) {
          throw new Error(`Cannot reopen PO. Reopening would result in negative inventory for part: ${item.part_number}.`);
        }
      }
      // If all checks pass, proceed with updates
      for (const item of lineItems) {
        const quantity = parseInt(item.quantity, 10);
        await client.query(
          `UPDATE inventory 
           SET quantity_on_hand = quantity_on_hand - $1
           WHERE part_number = $2`,
          [quantity, item.part_number]
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

// Generate PDF for a specific purchase order (MOVE THIS BEFORE /:id route)
router.get('/:id/pdf', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    // Fetch business profile
    const businessProfileResult = await pool.query('SELECT * FROM business_profile ORDER BY id DESC LIMIT 1');
    const businessProfile = businessProfileResult.rows[0];

    const purchaseOrderResult = await pool.query(
      `SELECT ph.*, vm.vendor_name, vm.street_address as vendor_street_address, vm.city as vendor_city, vm.province as vendor_province, vm.country as vendor_country, vm.telephone_number as vendor_phone, vm.email as vendor_email FROM PurchaseHistory ph JOIN VendorMaster vm ON ph.vendor_id = vm.vendor_id WHERE ph.purchase_id = $1`,
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
    purchaseOrder.lineItems = lineItemsResult.rows;

    const doc = new PDFDocument({ margin: 50 });
    let filename = `Purchase_Order_${purchaseOrder.purchase_number}.pdf`;
    filename = encodeURIComponent(filename);
    res.setHeader('Content-disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    // --- HEADER ---
    let headerY = 50;
    let logoHeight = 100;
    let logoWidth = 180;
    let pageWidth = 600;
    let logoX = 50;
    let companyTitleX = logoX + logoWidth + 20;
    let companyTitleY = headerY + (logoHeight - 16) / 2; // Vertically center with logo
    // Logo (left)
    if (businessProfile && businessProfile.logo_url) {
      const logoPath = path.join(__dirname, '../../', businessProfile.logo_url);
      if (fs.existsSync(logoPath)) {
        try {
          doc.image(logoPath, logoX, headerY, { fit: [logoWidth, logoHeight] });
        } catch (error) {
          console.error('Error adding logo to PDF:', error);
        }
      }
    }
    // Company name (right of logo, single line, smaller font)
    if (businessProfile) {
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#000000').text(
        (businessProfile.business_name || '').toUpperCase(),
        companyTitleX,
        companyTitleY,
        { align: 'left', width: pageWidth - companyTitleX - 50 }
      );
    }
    // Move Y below header
    let y = headerY + logoHeight + 4;
    // Horizontal line
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 18;

    // --- Company & Vendor Info Block ---
    // Headings
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Company Information', 50, y);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Vendor', 320, y);
    y += 16;
    // Company info (left column)
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(businessProfile?.business_name || '', 50, y);
    doc.text(businessProfile?.street_address || '', 50, y + 14);
    doc.text(
      [businessProfile?.city, businessProfile?.province, businessProfile?.country].filter(Boolean).join(', '),
      50, y + 28
    );
    doc.text(businessProfile?.email || '', 50, y + 42);
    doc.text(businessProfile?.telephone_number || '', 50, y + 56);
    // Vendor info (right column)
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(purchaseOrder.vendor_name || '', 320, y);
    doc.text(purchaseOrder.vendor_street_address || '', 320, y + 14);
    doc.text(
      [purchaseOrder.vendor_city, purchaseOrder.vendor_province, purchaseOrder.vendor_country].filter(Boolean).join(', '),
      320, y + 28
    );
    doc.text(purchaseOrder.vendor_email || '', 320, y + 42);
    doc.text(purchaseOrder.vendor_phone || '', 320, y + 56);
    y += 72;
    // Horizontal line
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 18;

    // --- Purchase Order Details ---
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000').text('PURCHASE ORDER', 50, y);
    y += 22;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Purchase Order #:', 50, y);
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(purchaseOrder.purchase_number, 170, y);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Order Date:', 320, y);
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(
      purchaseOrder.purchase_date ? new Date(purchaseOrder.purchase_date).toLocaleDateString() : '',
      400, y
    );
    y += 24;
    // Horizontal line
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 14;

    // --- Line Item Table ---
    const tableHeaders = ['SN', 'Item Code', 'Description', 'Qty', 'Unit', 'Unit Price', 'Line Total'];
    const colWidths = [30, 70, 140, 40, 40, 80, 80];
    let currentX = 50;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000');
    tableHeaders.forEach((header, i) => {
      doc.text(header, currentX, y, { width: colWidths[i], align: 'left' });
      currentX += colWidths[i];
    });
    y += 16;
    doc.moveTo(50, y - 2).lineTo(550, y - 2).strokeColor('#888888').stroke();
    doc.font('Helvetica').fontSize(10).fillColor('#000000');
    let sn = 1;
    purchaseOrder.lineItems.forEach((item: any) => {
      currentX = 50;
      doc.text(sn.toString(), currentX, y, { width: colWidths[0], align: 'left' });
      currentX += colWidths[0];
      doc.text(item.part_number, currentX, y, { width: colWidths[1], align: 'left' });
      currentX += colWidths[1];
      doc.text(item.part_description, currentX, y, { width: colWidths[2], align: 'left' });
      currentX += colWidths[2];
      doc.text(parseFloat(item.quantity).toString(), currentX, y, { width: colWidths[3], align: 'left' });
      currentX += colWidths[3];
      doc.text(item.unit, currentX, y, { width: colWidths[4], align: 'left' });
      currentX += colWidths[4];
      doc.text(parseFloat(item.unit_cost).toFixed(2), currentX, y, { width: colWidths[5], align: 'right' });
      currentX += colWidths[5];
      doc.text(parseFloat(item.line_total).toFixed(2), currentX, y, { width: colWidths[6], align: 'right' });
      y += 16;
      // Draw row line
      doc.moveTo(50, y - 2).lineTo(550, y - 2).strokeColor('#eeeeee').stroke();
      sn++;
      if (y > doc.page.height - 100) {
        doc.addPage();
        y = 50;
      }
    });
    y += 10;
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').stroke();
    y += 10;

    // --- Totals Section ---
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Sub Total:', 400, y, { align: 'left', width: 80 });
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(parseFloat(purchaseOrder.subtotal).toFixed(2), 480, y, { align: 'right', width: 70 });
    y += 16;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Total GST:', 400, y, { align: 'left', width: 80 });
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(parseFloat(purchaseOrder.total_gst_amount).toFixed(2), 480, y, { align: 'right', width: 70 });
    y += 16;
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text('Total:', 400, y, { align: 'left', width: 80 });
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text(parseFloat(purchaseOrder.total_amount).toFixed(2), 480, y, { align: 'right', width: 70 });

    doc.end();
  } catch (err) {
    console.error(`Error generating PDF for purchase order ${id}:`, err);
    res.status(500).json({ error: 'Internal server error during PDF generation' });
  }
});

// Get a specific purchase order by ID (open or closed) - MOVED AFTER PDF ROUTE
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
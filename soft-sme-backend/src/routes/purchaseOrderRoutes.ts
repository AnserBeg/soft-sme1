import express, { Request, Response } from 'express';
import { pool } from '../db';
import PDFDocument from 'pdfkit';
import { getNextPurchaseOrderNumberForYear } from '../utils/sequence';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// Get all open purchase orders
router.get('/open', async (req: Request, res: Response) => {
  console.log('purchaseOrderRoutes: GET /open - Request received');
  console.log('purchaseOrderRoutes: Query params:', req.query);
  
  try {
    const { startDate, endDate, status, searchTerm } = req.query;
    
    let query = `
      SELECT poh.purchase_id, poh.purchase_number, vm.vendor_name, poh.purchase_date as bill_date, 
             poh.purchase_number as bill_number, poh.subtotal, poh.total_gst_amount, poh.total_amount, poh.status, poh.gst_rate
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
             poh.purchase_number as bill_number, poh.subtotal, poh.total_gst_amount, poh.total_amount, poh.status, poh.gst_rate
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
      `SELECT poh.*, vm.vendor_name, poh.gst_rate FROM purchasehistory poh 
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
    bill_date,
    subtotal,
    total_gst_amount,
    total_amount,
    global_gst_rate,
    gst_rate,
    lineItems,
    company_id, // Extract but don't use in DB insert
    created_by, // Extract but don't use in DB insert
    ...otherFields // Ignore any other unexpected fields
  } = req.body;

  // Basic validation
  if (!vendor_id) {
    return res.status(400).json({ error: 'vendor_id is required' });
  }
  if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
    return res.status(400).json({ error: 'lineItems array is required and must not be empty' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Generate PO number with retry logic for duplicate key handling
    let poNumber: string;
    let retryCount = 0;
    const maxRetries = 5;
    
    do {
      const now = new Date();
      const year = now.getFullYear();
      
      // Get all existing PO numbers for this year to find the next available one
      const existingPOsResult = await client.query(
        `SELECT purchase_number 
         FROM purchasehistory 
         WHERE purchase_number LIKE $1 
         ORDER BY purchase_number`,
        [`PO-${year}-%`]
      );
      
      const existingNumbers = existingPOsResult.rows.map(row => 
        parseInt(row.purchase_number.substring(8))
      ).sort((a, b) => a - b);
      
      // Find the first gap or use the next number after the highest
      let nextNumber = 1;
      for (const num of existingNumbers) {
        if (num !== nextNumber) {
          break; // Found a gap
        }
        nextNumber++;
      }
      
      poNumber = `PO-${year}-${nextNumber.toString().padStart(5, '0')}`;
      console.log(`Generated PO number: ${poNumber} (next_number: ${nextNumber}, existing_count: ${existingNumbers.length})`);
      
      // Double-check if this PO number already exists (race condition protection)
      const existingResult = await client.query(
        'SELECT COUNT(*) as count FROM purchasehistory WHERE purchase_number = $1',
        [poNumber]
      );
      
      if (parseInt(existingResult.rows[0].count) === 0) {
        break; // PO number is unique, proceed
      }
      
      retryCount++;
      console.log(`PO number ${poNumber} already exists, retrying... (attempt ${retryCount}/${maxRetries})`);
      
      if (retryCount >= maxRetries) {
        // Emergency fallback: use timestamp-based number
        const timestamp = Date.now();
        const emergencyNumber = timestamp % 100000; // Use last 5 digits of timestamp
        poNumber = `PO-${year}-${emergencyNumber.toString().padStart(5, '0')}`;
        console.log(`Using emergency PO number: ${poNumber}`);
        break;
      }
    } while (retryCount < maxRetries);

    // Use bill_date if provided, otherwise use current date
    const purchaseDate = bill_date ? new Date(bill_date) : new Date();

    const effectiveGstRate = typeof gst_rate === 'number' && !isNaN(gst_rate) ? gst_rate : (typeof global_gst_rate === 'number' && !isNaN(global_gst_rate) ? global_gst_rate : 5.0);

    const purchaseResult = await client.query(
      `INSERT INTO purchasehistory (
        vendor_id, purchase_number, purchase_date, bill_number, status, subtotal, total_gst_amount, total_amount, gst_rate, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()) RETURNING purchase_id`,
      [
        vendor_id,
        poNumber,
        purchaseDate, // Use the extracted bill_date or current date
        bill_number,
        'Open',
        subtotal || 0,
        total_gst_amount || 0,
        total_amount || 0,
        effectiveGstRate
      ]
    );

    const purchase_id = purchaseResult.rows[0].purchase_id;

    for (const item of lineItems) {
      // Use line_total if available, otherwise calculate it
      const line_total = item.line_total || (item.quantity || 0) * (item.unit_cost || 0);
      const gst_amount = line_total * (effectiveGstRate / 100);

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
    res.status(201).json({ purchase_id, purchase_number: poNumber });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('partsPurchaseRoutes: Error creating parts purchase:', err);
    console.error('partsPurchaseRoutes: Request body:', JSON.stringify(req.body, null, 2));
    
    // Check if it's a duplicate key violation
    if (err instanceof Error && err.message.includes('duplicate key value violates unique constraint')) {
      res.status(409).json({ 
        error: 'Purchase order number conflict', 
        details: 'The generated purchase order number already exists. This might be due to concurrent requests or existing data. Please try again.',
        code: 'DUPLICATE_PO_NUMBER',
        suggestion: 'Try refreshing the page and creating the purchase order again.'
      });
    } else if (err instanceof Error && err.message.includes('violates not-null constraint')) {
      res.status(400).json({ 
        error: 'Missing required data', 
        details: 'Some required fields are missing from the request.',
        code: 'MISSING_REQUIRED_FIELDS'
      });
    } else if (err instanceof Error && err.message.includes('violates foreign key constraint')) {
      res.status(400).json({ 
        error: 'Invalid reference', 
        details: 'The vendor ID or other referenced data does not exist.',
        code: 'INVALID_REFERENCE'
      });
    } else {
      res.status(500).json({ 
        error: 'Internal server error', 
        details: err instanceof Error ? err.message : 'Unknown error',
        code: 'INTERNAL_ERROR'
      });
    }
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
      gst_rate
    } = purchaseOrderData;

    // Fetch old status to check for transitions
    const oldStatusResult = await client.query('SELECT status FROM "purchasehistory" WHERE purchase_id = $1', [id]);
    const oldStatus = oldStatusResult.rows[0]?.status;

    const effectiveGstRateUpdate = typeof gst_rate === 'number' && !isNaN(gst_rate) ? gst_rate : 5.0;

    const updatePoQuery = `
      UPDATE "purchasehistory" SET
        vendor_id = $1,
        purchase_date = $2,
        status = $3,
        subtotal = $4,
        total_gst_amount = $5,
        total_amount = $6,
        bill_number = $7,
        gst_rate = $8,
        updated_at = NOW()
      WHERE purchase_id = $9
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
      effectiveGstRateUpdate,
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

// PDF Generation Route for open purchase orders
router.get('/:id/pdf', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    // Fetch business profile
    const businessProfileResult = await pool.query('SELECT * FROM business_profile ORDER BY id DESC LIMIT 1');
    const businessProfile = businessProfileResult.rows[0];

    const purchaseOrderResult = await pool.query(
      `SELECT ph.*, vm.vendor_name, vm.street_address as vendor_street_address, vm.city as vendor_city, vm.province as vendor_province, vm.country as vendor_country, vm.telephone_number as vendor_phone, vm.email as vendor_email, vm.postal_code as vendor_postal_code, ph.gst_rate FROM PurchaseHistory ph JOIN VendorMaster vm ON ph.vendor_id = vm.vendor_id WHERE ph.purchase_id = $1`,
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
    // Logo (left) - always use bundled default logo
    const defaultLogoPath = path.join(__dirname, '../../assets/default-logo.png');
    if (fs.existsSync(defaultLogoPath)) {
      try {
        doc.image(defaultLogoPath, logoX, headerY, { fit: [logoWidth, logoHeight] });
      } catch (error) {
        console.error('Error adding logo to PDF:', error);
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
    doc.font('Helvetica').fontSize(11).fillColor('#000000');
    const companyNameResult = doc.text(businessProfile?.business_name || '', 50, y, { width: 250 });
    let companyY = Math.max(companyNameResult.y, y);
    doc.text(businessProfile?.street_address || '', 50, companyY + 14, { width: 250 });
    doc.text(
      [businessProfile?.city, businessProfile?.province, businessProfile?.country, businessProfile?.postal_code].filter(Boolean).join(', '),
      50, companyY + 28, { width: 250 }
    );
    doc.text(businessProfile?.email || '', 50, companyY + 42, { width: 250 });
    doc.text(businessProfile?.telephone_number || '', 50, companyY + 56, { width: 250 });
    // Vendor info (right column)
    doc.font('Helvetica').fontSize(11).fillColor('#000000');
    const vendorNameResult = doc.text(purchaseOrder.vendor_name || '', 320, y, { width: 230 });
    let vendorY = Math.max(vendorNameResult.y, y);
    doc.text(purchaseOrder.vendor_street_address || '', 320, vendorY + 14, { width: 230 });
    doc.text(
      [purchaseOrder.vendor_city, purchaseOrder.vendor_province, purchaseOrder.vendor_country, purchaseOrder.vendor_postal_code].filter(Boolean).join(', '),
      320, vendorY + 28, { width: 230 }
    );
    doc.text(purchaseOrder.vendor_email || '', 320, vendorY + 42, { width: 230 });
    doc.text(purchaseOrder.vendor_phone || '', 320, vendorY + 56, { width: 230 });
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
      let rowY = y;
      // SN
      const snResult = doc.text(sn.toString(), currentX, rowY, { width: colWidths[0], align: 'left' });
      currentX += colWidths[0];
      // Part Number
      const partNumberResult = doc.text(item.part_number, currentX, rowY, { width: colWidths[1], align: 'left' });
      currentX += colWidths[1];
      // Part Description
      const partDescResult = doc.text(item.part_description, currentX, rowY, { width: colWidths[2], align: 'left' });
      currentX += colWidths[2];
      // Find the max y after wrapping
      let maxRowY = Math.max(snResult.y, partNumberResult.y, partDescResult.y);
      // Quantity
      doc.text(parseFloat(item.quantity).toString(), currentX, rowY, { width: colWidths[3], align: 'left' });
      currentX += colWidths[3];
      // Unit
      doc.text(item.unit, currentX, rowY, { width: colWidths[4], align: 'left' });
      currentX += colWidths[4];
      // Unit Cost
      doc.text(parseFloat(item.unit_cost).toFixed(2), currentX, rowY, { width: colWidths[5], align: 'right' });
      currentX += colWidths[5];
      // Line Total
      doc.text(parseFloat(item.line_total).toFixed(2), currentX, rowY, { width: colWidths[6], align: 'right' });
      // Move y to the max y of the wrapped fields plus some padding
      y = Math.max(maxRowY, rowY) + 8;
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

export default router; 
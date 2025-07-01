import express, { Request, Response } from 'express';
import { pool } from '../db';
import { getNextSequenceNumberForYear } from '../utils/sequence';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// Get all open sales orders
router.get('/open', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT soh.*, cm.customer_name 
       FROM salesorderhistory soh
       JOIN customermaster cm ON soh.customer_id = cm.customer_id
       WHERE soh.status = 'Open' ORDER BY soh.sales_date DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('salesOrderRoutes: Error fetching open sales orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all closed sales orders (history)
router.get('/history', async (req: Request, res: Response) => {
  try {
    // Debug: Print all status values in DB
    const allStatuses = await pool.query("SELECT DISTINCT status FROM salesorderhistory");
    console.log('All status values in DB:', allStatuses.rows);
    // Debug: Direct SQL for Closed
    const debugResult = await pool.query("SELECT * FROM salesorderhistory WHERE status = 'Closed'");
    console.log('Direct SQL Result (Closed):', debugResult.rows);

    const result = await pool.query(
      `SELECT soh.*, cm.customer_name 
       FROM salesorderhistory soh
       JOIN customermaster cm ON soh.customer_id = cm.customer_id
       WHERE soh.status = 'Closed' ORDER BY soh.sales_date DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('salesOrderRoutes: Error fetching sales order history:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all sales orders with optional status filter
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    // Debug: Print all status values in DB
    const allStatuses = await pool.query("SELECT DISTINCT status FROM salesorderhistory");
    console.log('All status values in DB:', allStatuses.rows);
    // Debug: Direct SQL for Closed
    const debugResult = await pool.query("SELECT * FROM salesorderhistory WHERE status = 'Closed'");
    console.log('Direct SQL Result (Closed):', debugResult.rows);
    let query = `
      SELECT soh.*, cm.customer_name
      FROM salesorderhistory soh
      LEFT JOIN customermaster cm ON soh.customer_id = cm.customer_id
    `;
    const params: any[] = [];
    if (status && status !== 'all') {
      query += ' WHERE LOWER(soh.status) = $1';
      params.push(String(status).toLowerCase());
    }
    query += ' ORDER BY soh.sales_date DESC';
    console.log('SalesOrders Query:', query, 'Params:', params); // Debug log
    const result = await pool.query(query, params);
    console.log('SalesOrders Result:', result.rows); // Debug log
    res.json(result.rows);
  } catch (err) {
    console.error('salesOrderRoutes: Error fetching sales orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new sales order
router.post('/', async (req: Request, res: Response) => {
  const {
    customer_id,
    sales_date,
    product_name,
    product_description,
    subtotal,
    total_gst_amount,
    total_amount,
    status,
    estimated_cost,
    default_hourly_rate,
    lineItems,
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- INVENTORY ADJUSTMENT ON CREATION ---
    if (lineItems && lineItems.length > 0) {
      for (const item of lineItems) {
        if (item.part_number && item.part_number !== 'LABOUR') {
          // Check if there's enough inventory
          const invResult = await client.query(
            'SELECT quantity_on_hand FROM inventory WHERE part_number = $1',
            [item.part_number]
          );
          const currentQuantity = invResult.rows[0]?.quantity_on_hand || 0;
          const qty = Math.round(Number(item.quantity_sold ?? item.quantity));
          if (currentQuantity < qty) {
            throw new Error(`Cannot create SO. Insufficient inventory for part: ${item.part_number}. Available: ${currentQuantity}, Required: ${qty}`);
          }
          // Subtract inventory
          await client.query(
            `UPDATE inventory 
             SET quantity_on_hand = quantity_on_hand - $1
             WHERE part_number = $2`,
            [qty, item.part_number]
          );
        }
      }
    }

    const idRes = await client.query("SELECT nextval('salesorderhistory_sales_order_id_seq')");
    const newSalesOrderId = idRes.rows[0].nextval;
    const currentYear = new Date().getFullYear();
    const { sequenceNumber, nnnnn } = await getNextSequenceNumberForYear(currentYear);
    const formattedSONumber = `SO-${currentYear}-${nnnnn.toString().padStart(5, '0')}`;

    let calcSubtotal = 0;
    if (lineItems && lineItems.length > 0) {
      calcSubtotal = lineItems.reduce((sum: number, item: any) => sum + Number(item.line_amount || 0), 0);
    }
    const GST_RATE = 0.05; // Adjust if needed
    const calcGST = calcSubtotal * GST_RATE;
    const calcTotal = calcSubtotal + calcGST;
    const finalSubtotal: number = calcSubtotal;
    const finalGST: number = calcGST;
    const finalTotal: number = calcTotal;

    const salesOrderQuery = `
      INSERT INTO salesorderhistory (sales_order_id, sales_order_number, customer_id, sales_date, product_name, product_description, subtotal, total_gst_amount, total_amount, status, estimated_cost, default_hourly_rate, sequence_number)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
    `;
    const salesOrderValues = [
      newSalesOrderId,
      formattedSONumber,
      customer_id,
      sales_date,
      product_name,
      product_description,
      finalSubtotal,
      finalGST,
      finalTotal,
      status || 'Open',
      estimated_cost,
      default_hourly_rate,
      sequenceNumber,
    ];
    await client.query(salesOrderQuery, salesOrderValues);

    if (lineItems && lineItems.length > 0) {
      for (const item of lineItems) {
        let qty = item.quantity_sold ?? item.quantity;
        qty = Number(qty);
        if (!Number.isFinite(qty)) {
          throw new Error(`Invalid quantity for part ${item.part_number}: ${item.quantity_sold ?? item.quantity}`);
        }
        qty = Math.round(qty);
        const lineItemQuery = `
                    INSERT INTO salesorderlineitems (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `;
        const unitPrice = parseFloat(item.unit_price);
        const lineAmount = parseFloat(item.line_amount);
        const lineItemValues = [
          newSalesOrderId,
          item.part_number,
          item.part_description,
          qty,
          item.unit,
          unitPrice,
          lineAmount,
        ];
        // Debug: log the values being inserted
        console.log('DEBUG: lineItemValues to insert:', JSON.stringify(lineItemValues));
        await client.query(lineItemQuery, lineItemValues);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: 'Sales order created successfully',
      sales_order_id: newSalesOrderId,
      sales_order_number: formattedSONumber
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('salesOrderRoutes: Error creating sales order:', err);
    // Improved error handling for inventory
    if (err instanceof Error && err.message && err.message.toLowerCase().includes('insufficient inventory')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get a specific sales order by ID - THIS MUST BE AFTER SPECIFIC GETS
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (id === 'new') {
    return res.status(400).json({ error: 'Invalid sales order ID' });
  }
  try {
    const salesOrderResult = await pool.query(
      `SELECT soh.*, cm.customer_name, soh.total_gst_amount as gst_amount
       FROM salesorderhistory soh
       LEFT JOIN customermaster cm ON soh.customer_id = cm.customer_id
       WHERE soh.sales_order_id = $1`,
      [id]
    );
    if (salesOrderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Sales order not found' });
    }
    const salesOrder = salesOrderResult.rows[0];
    const lineItemsResult = await pool.query(
      'SELECT *, quantity_sold as quantity FROM salesorderlineitems WHERE sales_order_id = $1 ORDER BY sales_order_line_item_id ASC',
      [id]
    );
    res.json({ salesOrder, lineItems: lineItemsResult.rows });
  } catch (err) {
    console.error(`salesOrderRoutes: Error fetching sales order with id ${id}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a sales order
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    customer_id,
    sales_date,
    product_name,
    product_description,
    subtotal,
    total_gst_amount,
    total_amount,
    status,
    estimated_cost,
    default_hourly_rate,
    lineItems,
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // --- INVENTORY ADJUSTMENT ON UPDATE ---
    // Fetch old line items
    const oldLineItemsResult = await client.query(
      'SELECT part_number, quantity_sold FROM salesorderlineitems WHERE sales_order_id = $1',
      [id]
    );
    const oldLineItemsMap = new Map();
    oldLineItemsResult.rows.forEach(item => {
      oldLineItemsMap.set(item.part_number, item.quantity_sold);
    });
    // Build new line items map
    const newLineItemsMap = new Map();
    if (Array.isArray(lineItems)) {
      lineItems.forEach(item => {
        const qty = Math.round(Number(item.quantity));
        newLineItemsMap.set(item.part_number, qty);
      });
    }
    // 1. Handle removed items (add back full quantity)
    for (const [part_number, oldQtyRaw] of oldLineItemsMap.entries()) {
      const oldQty = Math.round(Number(oldQtyRaw));
      if (!newLineItemsMap.has(part_number) && part_number !== 'LABOUR') {
        await client.query(
          `UPDATE inventory SET quantity_on_hand = quantity_on_hand + $1 WHERE part_number = $2`,
          [oldQty, part_number]
        );
      }
    }
    // 2. Handle changed and new items
    for (const [part_number, newQtyRaw] of newLineItemsMap.entries()) {
      const newQty = Math.round(Number(newQtyRaw));
      const oldQty = Math.round(Number(oldLineItemsMap.get(part_number) || 0));
      const diff = newQty - oldQty;
      if (diff !== 0 && part_number !== 'LABOUR') {
        // Check if inventory would go negative
        const invResult = await client.query(
          'SELECT quantity_on_hand FROM inventory WHERE part_number = $1',
          [part_number]
        );
        const currentQty = invResult.rows[0]?.quantity_on_hand ?? 0;
        if (currentQty - diff < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'Insufficient inventory',
            message: `Cannot update SO. Insufficient inventory for part: ${part_number}. Available: ${currentQty}, Required: ${diff > 0 ? diff : 0}`
          });
        }
        await client.query(
          `UPDATE inventory SET quantity_on_hand = quantity_on_hand - $1 WHERE part_number = $2`,
          [diff, part_number]
        );
      }
    }

    // Get the current status to check for status transitions
    const currentStatusResult = await client.query(
      'SELECT status FROM salesorderhistory WHERE sales_order_id = $1',
      [id]
    );
    
    if (currentStatusResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sales order not found' });
    }
    
    const oldStatus = currentStatusResult.rows[0].status;

    // Handle inventory adjustments for status changes
    if (status === 'Closed' && oldStatus === 'Open') {
      // === CLOSE SO LOGIC ===
      // When closing a sales order, reduce inventory
      if (lineItems && lineItems.length > 0) {
        for (const item of lineItems) {
          if (item.part_number && item.part_number !== 'LABOUR') {
            const qty = Math.round(Number(item.quantity));
            // Check if there's enough inventory
            const invResult = await client.query(
              'SELECT quantity_on_hand FROM inventory WHERE part_number = $1',
              [item.part_number]
            );
            const currentQuantity = invResult.rows[0]?.quantity_on_hand || 0;
            if (currentQuantity < qty) {
              throw new Error(`Cannot close SO. Insufficient inventory for part: ${item.part_number}. Available: ${currentQuantity}, Required: ${qty}`);
            }
            // Reduce inventory
            await client.query(
              `UPDATE inventory 
               SET quantity_on_hand = quantity_on_hand - $1
               WHERE part_number = $2`,
              [qty, item.part_number]
            );
          }
        }
      }
    } else if (status === 'Open' && oldStatus === 'Closed') {
      // === REOPEN SO LOGIC ===
      // When reopening a sales order, restore inventory
      if (lineItems && lineItems.length > 0) {
        for (const item of lineItems) {
          if (item.part_number && item.part_number !== 'LABOUR') {
            const qty = Math.round(Number(item.quantity));
            // Restore inventory
            await client.query(
              `UPDATE inventory 
               SET quantity_on_hand = quantity_on_hand + $1
               WHERE part_number = $2`,
              [qty, item.part_number]
            );
          }
        }
      }
    }

    // Calculate subtotal, GST, and total using all line items (including labour)
    let calcSubtotal = 0;
    if (lineItems && lineItems.length > 0) {
      calcSubtotal = lineItems.reduce((sum: number, item: any) => sum + Number(item.line_amount || 0), 0);
    }
    const GST_RATE = 0.05; // Adjust if needed
    const calcGST = calcSubtotal * GST_RATE;
    const calcTotal = calcSubtotal + calcGST;
    const finalSubtotal: number = calcSubtotal;
    const finalGST: number = calcGST;
    const finalTotal: number = calcTotal;

    // Update the main sales order
    const salesOrderQuery = `
      UPDATE salesorderhistory
      SET
        customer_id = $1,
        sales_date = $2,
        product_name = $3,
        product_description = $4,
        subtotal = $5,
        total_gst_amount = $6,
        total_amount = $7,
        status = $8,
        estimated_cost = $9,
        default_hourly_rate = $10
      WHERE sales_order_id = $11;
    `;
    const salesOrderValues = [
      customer_id,
      sales_date,
      product_name,
      product_description,
      finalSubtotal,
      finalGST,
      finalTotal,
      status,
      estimated_cost,
      default_hourly_rate,
      id,
    ];
    await client.query(salesOrderQuery, salesOrderValues);

    // Delete old line items and insert new ones only if lineItems is provided
    if (Array.isArray(lineItems)) {
      await client.query('DELETE FROM salesorderlineitems WHERE sales_order_id = $1', [id]);
      if (lineItems.length > 0) {
        // Debug: log lineItems before DB insert
        console.log('DEBUG: lineItems to insert:', JSON.stringify(lineItems, null, 2));
        for (const item of lineItems) {
          let qty = item.quantity ?? item.quantity_sold;
          qty = Number(qty);
          if (!Number.isFinite(qty)) {
            throw new Error(`Invalid quantity for part ${item.part_number}: ${item.quantity ?? item.quantity_sold}`);
          }
          qty = Math.round(qty);
          const unitPrice = parseFloat(item.unit_price);
          const lineAmount = parseFloat(item.line_amount);
          const lineItemValues = [
            id,
            item.part_number,
            item.part_description,
            qty,
            item.unit,
            unitPrice,
            lineAmount,
          ];
          // Debug: log the values being inserted
          console.log('DEBUG: lineItemValues to insert:', JSON.stringify(lineItemValues));
          const lineItemQuery = `
            INSERT INTO salesorderlineitems (sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `;
          await client.query(lineItemQuery, lineItemValues);
        }
      }
    }

    await client.query('COMMIT');
    res.status(200).json({
      message: 'Sales order updated successfully',
      sales_order_id: id,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('salesOrderRoutes: Error updating sales order:', err);
    // Improved error handling for inventory
    if (err instanceof Error && err.message && err.message.toLowerCase().includes('insufficient inventory')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete a sales order by ID
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // --- INVENTORY ADJUSTMENT ON DELETE ---
    // Fetch all line items
    const lineItemsResult = await client.query(
      'SELECT part_number, quantity_sold FROM salesorderlineitems WHERE sales_order_id = $1',
      [id]
    );
    for (const item of lineItemsResult.rows) {
      await client.query(
        `UPDATE inventory SET quantity_on_hand = quantity_on_hand + $1 WHERE part_number = $2`,
        [item.quantity_sold, item.part_number]
      );
    }
    // Delete line items first due to foreign key constraint
    await client.query('DELETE FROM salesorderlineitems WHERE sales_order_id = $1', [id]);
    // Delete the sales order
    const result = await client.query('DELETE FROM salesorderhistory WHERE sales_order_id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sales order not found' });
    }
    await client.query('COMMIT');
    res.json({ message: 'Sales order deleted successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('salesOrderRoutes: Error deleting sales order:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PDF Generation Route for sales orders
router.get('/:id/pdf', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    // Fetch business profile
    const businessProfileResult = await pool.query('SELECT * FROM business_profile ORDER BY id DESC LIMIT 1');
    const businessProfile = businessProfileResult.rows[0];

    const salesOrderResult = await pool.query(
      `SELECT soh.*, cm.customer_name, cm.street_address as customer_street_address, cm.city as customer_city, cm.province as customer_province, cm.country as customer_country, cm.telephone_number as customer_phone, cm.email as customer_email FROM salesorderhistory soh JOIN customermaster cm ON soh.customer_id = cm.customer_id WHERE soh.sales_order_id = $1`,
      [id]
    );

    if (salesOrderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Sales order not found' });
    }

    const salesOrder = salesOrderResult.rows[0];
    const lineItemsResult = await pool.query(
      'SELECT * FROM salesorderlineitems WHERE sales_order_id = $1',
      [id]
    );
    salesOrder.lineItems = lineItemsResult.rows;

    const doc = new PDFDocument({ margin: 50 });
    let filename = `Sales_Order_${salesOrder.sales_order_number}.pdf`;
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

    // --- Company & Customer Info Block ---
    // Headings
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Company Information', 50, y);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Customer', 320, y);
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
    // Customer info (right column)
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(salesOrder.customer_name || '', 320, y);
    doc.text(salesOrder.customer_street_address || '', 320, y + 14);
    doc.text(
      [salesOrder.customer_city, salesOrder.customer_province, salesOrder.customer_country].filter(Boolean).join(', '),
      320, y + 28
    );
    doc.text(salesOrder.customer_email || '', 320, y + 42);
    doc.text(salesOrder.customer_phone || '', 320, y + 56);
    y += 72;
    // Horizontal line
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 18;

    // --- Sales Order Details ---
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000').text('SALES ORDER', 50, y);
    y += 22;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Sales Order #:', 50, y);
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(salesOrder.sales_order_number, 170, y);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Sales Date:', 320, y);
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(
      salesOrder.sales_date ? new Date(salesOrder.sales_date).toLocaleDateString() : '',
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
    salesOrder.lineItems.forEach((item: any) => {
      currentX = 50;
      doc.text(sn.toString(), currentX, y, { width: colWidths[0], align: 'left' });
      currentX += colWidths[0];
      doc.text(item.part_number, currentX, y, { width: colWidths[1], align: 'left' });
      currentX += colWidths[1];
      doc.text(item.part_description, currentX, y, { width: colWidths[2], align: 'left' });
      currentX += colWidths[2];
      doc.text(parseFloat(item.quantity_sold).toString(), currentX, y, { width: colWidths[3], align: 'left' });
      currentX += colWidths[3];
      doc.text(item.unit, currentX, y, { width: colWidths[4], align: 'left' });
      currentX += colWidths[4];
      doc.text(parseFloat(item.unit_price).toFixed(2), currentX, y, { width: colWidths[5], align: 'right' });
      currentX += colWidths[5];
      doc.text(parseFloat(item.line_amount).toFixed(2), currentX, y, { width: colWidths[6], align: 'right' });
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
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(parseFloat(salesOrder.subtotal).toFixed(2), 480, y, { align: 'right', width: 70 });
    y += 16;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Total GST:', 400, y, { align: 'left', width: 80 });
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(parseFloat(salesOrder.total_gst_amount).toFixed(2), 480, y, { align: 'right', width: 70 });
    y += 16;
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text('Total:', 400, y, { align: 'left', width: 80 });
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text(parseFloat(salesOrder.total_amount).toFixed(2), 480, y, { align: 'right', width: 70 });

    doc.end();
  } catch (err) {
    console.error(`Error generating PDF for sales order ${id}:`, err);
    res.status(500).json({ error: 'Internal server error during PDF generation' });
  }
});

export default router; 
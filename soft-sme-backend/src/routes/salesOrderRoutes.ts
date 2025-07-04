import express, { Request, Response } from 'express';
import { pool } from '../db';
import { getNextSequenceNumberForYear } from '../utils/sequence';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { SalesOrderService } from '../services/SalesOrderService';
import { InventoryService } from '../services/InventoryService';

const router = express.Router();
const salesOrderService = new SalesOrderService(pool);
const inventoryService = new InventoryService(pool);

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
  const { customer_id, sales_date, product_name, product_description, subtotal, total_gst_amount, total_amount, status, estimated_cost, lineItems, user_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Insert the sales order (status: OPEN, no line items yet)
    const idRes = await client.query("SELECT nextval('salesorderhistory_sales_order_id_seq')");
    const newSalesOrderId = idRes.rows[0].nextval;
    const currentYear = new Date().getFullYear();
    const { sequenceNumber, nnnnn } = await getNextSequenceNumberForYear(currentYear);
    const formattedSONumber = `SO-${currentYear}-${nnnnn.toString().padStart(5, '0')}`;
    const salesOrderQuery = `
      INSERT INTO salesorderhistory (sales_order_id, sales_order_number, customer_id, sales_date, product_name, product_description, subtotal, total_gst_amount, total_amount, status, estimated_cost, sequence_number)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
    `;
    const salesOrderValues = [
      newSalesOrderId,
      formattedSONumber,
      customer_id,
      sales_date,
      product_name,
      product_description,
      subtotal,
      total_gst_amount,
      total_amount,
      status || 'Open',
      estimated_cost,
      sequenceNumber,
    ];
    await client.query(salesOrderQuery, salesOrderValues);
    // For each line item, upsert all fields
    for (const item of lineItems) {
      await salesOrderService.upsertLineItem(newSalesOrderId, item, client);
    }
    // Recalculate and update summary fields
    await salesOrderService.recalculateAndUpdateSummary(newSalesOrderId, client);
    await client.query('COMMIT');
    res.status(201).json({ message: 'Sales order created successfully', sales_order_id: newSalesOrderId, sales_order_number: formattedSONumber });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error in POST /api/sales-orders:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
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
  const { lineItems, status, user_id } = req.body;
  const client = await pool.connect();
  try {
    console.log(`[PUT /api/sales-orders/${id}] Begin update`);
    await client.query('BEGIN');
    console.log(`[PUT /api/sales-orders/${id}] Transaction started`);
    // Remove all existing line items for this order
    await client.query('DELETE FROM salesorderlineitems WHERE sales_order_id = $1', [id]);
    console.log(`[PUT /api/sales-orders/${id}] Deleted old line items`);
    // Upsert all new line items
    for (const item of lineItems) {
      console.log(`[PUT /api/sales-orders/${id}] Upserting line item`, item.part_number);
      await salesOrderService.upsertLineItem(Number(id), item, client);
    }
    console.log(`[PUT /api/sales-orders/${id}] All line items upserted`);
    // Recalculate and update summary fields
    await salesOrderService.recalculateAndUpdateSummary(Number(id), client);
    console.log(`[PUT /api/sales-orders/${id}] Summary recalculated`);
    // Handle status change
    if (status === 'Closed') {
      console.log(`[PUT /api/sales-orders/${id}] Closing order`);
      await salesOrderService.closeOrder(Number(id), client);
      console.log(`[PUT /api/sales-orders/${id}] Order closed`);
    } else if (status === 'Open') {
      console.log(`[PUT /api/sales-orders/${id}] Reopening order`);
      await salesOrderService.openOrder(Number(id), client);
      console.log(`[PUT /api/sales-orders/${id}] Order reopened`);
    }
    await client.query('COMMIT');
    console.log(`[PUT /api/sales-orders/${id}] Transaction committed`);
    res.status(200).json({ message: 'Sales order updated successfully' });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error(`[PUT /api/sales-orders/${id}] Error:`, err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  } finally {
    client.release();
    console.log(`[PUT /api/sales-orders/${id}] Client released`);
  }
});

// Delete a sales order by ID
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { user_id } = req.body;
  try {
    await salesOrderService.deleteOrder(Number(id), user_id);
    res.json({ message: 'Sales order deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' });
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
    // Logo (left) - always use bundled default logo
    const defaultLogoPath = path.join(__dirname, '../../assets/default-logo.png');
    if (fs.existsSync(defaultLogoPath)) {
      try {
        doc.image(defaultLogoPath, logoX, headerY, { fit: [logoWidth, logoHeight] });
      } catch (error) {
        console.error('Error adding logo to PDF:', error);
      }
    }
    // Company name (right of logo, vertically centered with logo)
    const fontSize = 16;
    // Company name slightly above vertical center of logo
    const companyTitleY = headerY + (logoHeight / 2) - (fontSize / 2) - 6;
    if (businessProfile) {
      doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#000000').text(
        (businessProfile.business_name || '').toUpperCase(),
        companyTitleX,
        companyTitleY,
        { align: 'left', width: pageWidth - companyTitleX - 50 }
      );
    }
    // Move Y below header (tight 4px gap)
    const logoBottom = headerY + logoHeight;
    const nameBottom = companyTitleY + fontSize;
    let y = Math.max(logoBottom, nameBottom) + 4;
    // Horizontal line
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 18;

    // --- Company & Customer Info Block ---
    // Headings
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Company Information', 50, y);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Customer', 320, y);
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
    // Customer info (right column)
    doc.font('Helvetica').fontSize(11).fillColor('#000000');
    const customerNameResult = doc.text(salesOrder.customer_name || '', 320, y, { width: 230 });
    let customerY = Math.max(customerNameResult.y, y);
    doc.text(salesOrder.customer_street_address || '', 320, customerY + 14, { width: 230 });
    doc.text(
      [salesOrder.customer_city, salesOrder.customer_province, salesOrder.customer_country, salesOrder.customer_postal_code].filter(Boolean).join(', '),
      320, customerY + 28, { width: 230 }
    );
    doc.text(salesOrder.customer_email || '', 320, customerY + 42, { width: 230 });
    doc.text(salesOrder.customer_phone || '', 320, customerY + 56, { width: 230 });
    // Set y to the max of the last company and customer info y values plus extra padding
    y = Math.max(companyY + 56, customerY + 56) + 18;
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
      doc.text(parseFloat(item.quantity_sold).toString(), currentX, rowY, { width: colWidths[3], align: 'left' });
      currentX += colWidths[3];
      // Unit
      doc.text(item.unit, currentX, rowY, { width: colWidths[4], align: 'left' });
      currentX += colWidths[4];
      // Unit Price
      doc.text(parseFloat(item.unit_price).toFixed(2), currentX, rowY, { width: colWidths[5], align: 'right' });
      currentX += colWidths[5];
      // Line Total
      doc.text(parseFloat(item.line_amount).toFixed(2), currentX, rowY, { width: colWidths[6], align: 'right' });
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
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(parseFloat(salesOrder.subtotal).toFixed(2), 480, y, { align: 'right', width: 70 });
    y += 16;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Total GST:', 400, y, { align: 'left', width: 80 });
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(parseFloat(salesOrder.total_gst_amount).toFixed(2), 480, y, { align: 'right', width: 70 });
    y += 16;
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text('Total:', 400, y, { align: 'left', width: 80 });
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text(parseFloat(salesOrder.total_amount).toFixed(2), 480, y, { align: 'right', width: 70 });

    // --- Business Number at the bottom ---
    y += 40;
    if (businessProfile && businessProfile.business_number) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text(`Business Number: ${businessProfile.business_number}`, 50, y, { align: 'left' });
    }

    doc.end();
  } catch (err) {
    console.error(`Error generating PDF for sales order ${id}:`, err);
    res.status(500).json({ error: 'Internal server error during PDF generation' });
  }
});

export default router; 
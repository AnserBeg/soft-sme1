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
      `SELECT soh.*, COALESCE(cm.customer_name, 'Unknown Customer') as customer_name 
       FROM salesorderhistory soh
       LEFT JOIN customermaster cm ON soh.customer_id = cm.customer_id
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
      `SELECT soh.*, COALESCE(cm.customer_name, 'Unknown Customer') as customer_name 
       FROM salesorderhistory soh
       LEFT JOIN customermaster cm ON soh.customer_id = cm.customer_id
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
      SELECT soh.*, COALESCE(cm.customer_name, 'Unknown Customer') as customer_name
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
  const { customer_id, sales_date, product_name, product_description, terms, subtotal, total_gst_amount, total_amount, status, estimated_cost, lineItems, user_id } = req.body;
  // Add this logging block:
  console.log('Incoming sales order POST request body:', req.body);
  console.log('Summary fields:', {
    subtotal, subtotalType: typeof subtotal,
    total_gst_amount, totalGstAmountType: typeof total_gst_amount,
    total_amount, totalAmountType: typeof total_amount,
    estimated_cost, estimatedCostType: typeof estimated_cost,
  });
  if (lineItems && lineItems.length > 0) {
    lineItems.forEach((item: any, idx: number) => {
      console.log(`Line item ${idx}:`, {
        part_number: item.part_number,
        quantity: item.quantity, quantityType: typeof item.quantity,
        quantity_sold: item.quantity_sold, quantitySoldType: typeof item.quantity_sold,
        unit_price: item.unit_price, unitPriceType: typeof item.unit_price,
        line_amount: item.line_amount, lineAmountType: typeof item.line_amount,
      });
    });
  }
  console.log('Integer fields:', {
    sales_order_id: req.body.sales_order_id, sales_order_id_type: typeof req.body.sales_order_id,
    customer_id: req.body.customer_id, customer_id_type: typeof req.body.customer_id,
    quote_id: req.body.quote_id, quote_id_type: typeof req.body.quote_id,
  });
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
      INSERT INTO salesorderhistory (sales_order_id, sales_order_number, customer_id, sales_date, product_name, product_description, terms, subtotal, total_gst_amount, total_amount, status, estimated_cost, sequence_number)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
    `;
    const customerIdInt = customer_id !== undefined && customer_id !== null ? parseInt(customer_id, 10) : null;
    const quoteIdInt = req.body.quote_id !== undefined && req.body.quote_id !== null ? parseInt(req.body.quote_id, 10) : null;
    const subtotalNum = subtotal !== undefined && subtotal !== null ? parseFloat(subtotal) : 0;
    const totalGstAmountNum = total_gst_amount !== undefined && total_gst_amount !== null ? parseFloat(total_gst_amount) : 0;
    const totalAmountNum = total_amount !== undefined && total_amount !== null ? parseFloat(total_amount) : 0;
    const estimatedCostNum = estimated_cost !== undefined && estimated_cost !== null ? parseFloat(estimated_cost) : 0;
    const lineItemsParsed = (lineItems || []).map((item: any) => ({
      ...item,
      quantity_sold: item.quantity_sold !== undefined && item.quantity_sold !== null ? parseFloat(item.quantity_sold) : 0,
      unit_price: item.unit_price !== undefined && item.unit_price !== null ? parseFloat(item.unit_price) : 0,
      line_amount: item.line_amount !== undefined && item.line_amount !== null ? parseFloat(item.line_amount) : 0,
    }));
    const salesOrderValues = [
      newSalesOrderId,
      formattedSONumber,
      customerIdInt,
      sales_date,
      product_name,
      product_description,
      terms,
      subtotalNum,
      totalGstAmountNum,
      totalAmountNum,
      status || 'Open',
      estimatedCostNum,
      sequenceNumber,
    ];
    await client.query(salesOrderQuery, salesOrderValues);
    // For each line item, upsert all fields
    for (const item of lineItemsParsed) {
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
      `SELECT soh.*, COALESCE(cm.customer_name, 'Unknown Customer') as customer_name, soh.total_gst_amount as gst_amount
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
  const { lineItems, status, user_id, ...salesOrderData } = req.body;
  console.log('Incoming sales order PUT request body:', req.body);
console.log('Summary fields:', {
  subtotal: salesOrderData.subtotal, subtotalType: typeof salesOrderData.subtotal,
  total_gst_amount: salesOrderData.total_gst_amount, totalGstAmountType: typeof salesOrderData.total_gst_amount,
  total_amount: salesOrderData.total_amount, totalAmountType: typeof salesOrderData.total_amount,
  estimated_cost: salesOrderData.estimated_cost, estimatedCostType: typeof salesOrderData.estimated_cost,
});
if (lineItems && lineItems.length > 0) {
  lineItems.forEach((item: any, idx: number) => {
    console.log(`Line item ${idx}:`, {
      part_number: item.part_number,
      quantity: item.quantity, quantityType: typeof item.quantity,
      quantity_sold: item.quantity_sold, quantitySoldType: typeof item.quantity_sold,
      unit_price: item.unit_price, unitPriceType: typeof item.unit_price,
      line_amount: item.line_amount, lineAmountType: typeof item.line_amount,
    });
  });
}
  console.log('Integer fields:', {
    sales_order_id: salesOrderData.sales_order_id, sales_order_id_type: typeof salesOrderData.sales_order_id,
    customer_id: salesOrderData.customer_id, customer_id_type: typeof salesOrderData.customer_id,
    quote_id: salesOrderData.quote_id, quote_id_type: typeof salesOrderData.quote_id,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const allowedFields = [
      'customer_id',
      'sales_date',
      'product_name',
      'product_description',
      'terms',
      'subtotal',
      'total_gst_amount',
      'total_amount',
      'status',
      'estimated_cost',
      'sequence_number'
    ];
    // Update sales order header fields if provided
    if (Object.keys(salesOrderData).length > 0) {
      const updateFields = [];
      const updateValues = [];
      let paramCount = 1;
      for (const [key, value] of Object.entries(salesOrderData)) {
        if (allowedFields.includes(key) && value !== undefined && value !== null) {
          let coercedValue = value;
          if (key === 'subtotal') coercedValue = parseFloat(salesOrderData.subtotal);
          if (key === 'total_gst_amount') coercedValue = parseFloat(salesOrderData.total_gst_amount);
          if (key === 'total_amount') coercedValue = parseFloat(salesOrderData.total_amount);
          if (key === 'estimated_cost') coercedValue = parseFloat(salesOrderData.estimated_cost);
          updateFields.push(`${key} = $${paramCount}`);
          updateValues.push(coercedValue);
          paramCount++;
        }
      }
      if (updateFields.length > 0) {
        updateValues.push(id);
        await client.query(
          `UPDATE salesorderhistory SET ${updateFields.join(', ')} WHERE sales_order_id = $${paramCount}`,
          updateValues
        );
      }
    }
    // Update line items with proper inventory management
    if (lineItems && lineItems.length >= 0) {
      await salesOrderService.updateSalesOrder(Number(id), lineItems, client);
    }
    // Recalculate and update summary fields
    await salesOrderService.recalculateAndUpdateSummary(Number(id), client);
    // Handle status change
    const currentStatusRes = await client.query('SELECT status FROM salesorderhistory WHERE sales_order_id = $1', [id]);
    const currentStatus = currentStatusRes.rows[0]?.status;
    if (status === 'Closed' && currentStatus !== 'Closed') {
      await salesOrderService.closeOrder(Number(id), client);
    } else if (status === 'Open' && currentStatus === 'Closed') {
      await salesOrderService.openOrder(Number(id), client);
    }
    await client.query('COMMIT');
    res.status(200).json({ message: 'Sales order updated successfully' });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message || 'Internal server error' });
  } finally {
    client.release();
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
    let companyInfoY = y;
    const companyFields = [
      businessProfile?.business_name,
      businessProfile?.street_address,
      [businessProfile?.city, businessProfile?.province, businessProfile?.country, businessProfile?.postal_code].filter(Boolean).join(', '),
      businessProfile?.email,
      businessProfile?.telephone_number
    ].filter(f => f && String(f).trim() !== '');
    companyFields.forEach((field, idx) => {
      doc.text(field, 50, companyInfoY, { width: 250 });
      companyInfoY += 14;
    });
    // Customer info (right column)
    doc.font('Helvetica').fontSize(11).fillColor('#000000');
    let customerInfoY = y;
    const customerFields = [
      salesOrder.customer_name,
      salesOrder.customer_street_address,
      [salesOrder.customer_city, salesOrder.customer_province, salesOrder.customer_country, salesOrder.customer_postal_code].filter(Boolean).join(', '),
      salesOrder.customer_email,
      salesOrder.customer_phone
    ].filter(f => f && String(f).trim() !== '');
    customerFields.forEach((field, idx) => {
      doc.text(field, 320, customerInfoY, { width: 230 });
      customerInfoY += 14;
    });
    // Set y to the max of the last company and customer info y values plus extra padding
    y = Math.max(companyInfoY, customerInfoY) + 18;
    // Horizontal line
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 18;

    // --- Sales Order Details ---
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000').text('SALES ORDER', 50, y);
    y += 22;
    // Sales Order # and Sales Date inline
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Sales Order #:', 50, y);
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(salesOrder.sales_order_number, 130, y);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Sales Date:', 250, y);
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(
      salesOrder.sales_date ? new Date(salesOrder.sales_date).toLocaleDateString() : '',
      320, y
    );
    y += 18;
    // Product Name and Description below
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Product Name:', 50, y);
    const prodNameResult = doc.font('Helvetica').fontSize(11).fillColor('#000000').text(salesOrder.product_name || '', 150, y, { width: 390 });
    y = prodNameResult.y + 8;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Product Description:', 50, y);
    const descResult = doc.font('Helvetica').fontSize(11).fillColor('#000000').text(salesOrder.product_description || '', 170, y, { width: 370 });
    y = descResult.y + 8;
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
      // Calculate wrapped heights for each cell
      const snResult = doc.heightOfString(sn.toString(), { width: colWidths[0] });
      const partNumberResult = doc.heightOfString(item.part_number, { width: colWidths[1] });
      const partDescResult = doc.heightOfString(item.part_description, { width: colWidths[2] });
      const qtyResult = doc.heightOfString(parseFloat(item.quantity_sold).toString(), { width: colWidths[3] });
      const unitResult = doc.heightOfString(item.unit, { width: colWidths[4] });
      const unitPriceResult = doc.heightOfString(parseFloat(item.unit_price).toFixed(2), { width: colWidths[5] });
      const lineTotalResult = doc.heightOfString(parseFloat(item.line_amount).toFixed(2), { width: colWidths[6] });
      const rowHeight = Math.max(snResult, partNumberResult, partDescResult, qtyResult, unitResult, unitPriceResult, lineTotalResult, 12);
      // SN
      doc.text(sn.toString(), currentX, rowY, { width: colWidths[0], align: 'left' });
      currentX += colWidths[0];
      // Part Number
      doc.text(item.part_number, currentX, rowY, { width: colWidths[1], align: 'left' });
      currentX += colWidths[1];
      // Part Description
      doc.text(item.part_description, currentX, rowY, { width: colWidths[2], align: 'left' });
      currentX += colWidths[2];
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
      y += rowHeight + 4;
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

    // --- Terms Section ---
    y += 40;
    if (salesOrder.terms && salesOrder.terms.trim()) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Terms:', 50, y);
      y += 16;
      const termsResult = doc.font('Helvetica').fontSize(10).fillColor('#000000').text(salesOrder.terms, 50, y, { 
        width: 500,
        align: 'left'
      });
      y = termsResult.y + 20;
    }

    // --- Business Number at the bottom ---
    if (businessProfile && businessProfile.business_number) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text(`Business Number: ${businessProfile.business_number}`, 50, y, { align: 'left' });
    }

    doc.end();
  } catch (err) {
    console.error(`Error generating PDF for sales order ${id}:`, err);
    res.status(500).json({ error: 'Internal server error during PDF generation' });
  }
});

// Export sales orders to PDF
router.get('/export/pdf', async (req: Request, res: Response) => {
  console.log('Sales orders PDF export endpoint hit');
  try {
    const { status } = req.query;
    let query = `
      SELECT soh.*, COALESCE(cm.customer_name, 'Unknown Customer') as customer_name
      FROM salesorderhistory soh
      LEFT JOIN customermaster cm ON soh.customer_id = cm.customer_id
    `;
    const params: any[] = [];
    if (status && status !== 'all') {
      query += ' WHERE LOWER(soh.status) = $1';
      params.push(String(status).toLowerCase());
    }
    query += ' ORDER BY soh.sales_date DESC';
    
    const result = await pool.query(query, params);
    const salesOrders = result.rows;

    const doc = new PDFDocument({ margin: 50 });
    const filename = `sales_orders_${new Date().toISOString().split('T')[0]}.pdf`;
    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    // Header
    doc.font('Helvetica-Bold').fontSize(20).text('Sales Orders', { align: 'center' });
    doc.moveDown();
    doc.font('Helvetica').fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(2);

    // Table headers
    const headers = ['Sales Order #', 'Customer', 'Product Name', 'Product Description', 'Subtotal', 'GST', 'Total', 'Status'];
    const columnWidths = [100, 120, 100, 120, 80, 60, 80, 60];
    let y = doc.y;

    // Draw header row
    doc.font('Helvetica-Bold').fontSize(9);
    let x = 50;
    headers.forEach((header, index) => {
      doc.text(header, x, y, { width: columnWidths[index] });
      x += columnWidths[index];
    });

    y += 20;
    doc.moveTo(50, y).lineTo(720, y).stroke();

    // Draw data rows
    doc.font('Helvetica').fontSize(8);
    salesOrders.forEach((order, index) => {
      if (y > doc.page.height - 100) {
        doc.addPage();
        y = 50;
      }

      x = 50;
      doc.text(order.sales_order_number || '', x, y, { width: columnWidths[0] });
      x += columnWidths[0];
      doc.text(order.customer_name || '', x, y, { width: columnWidths[1] });
      x += columnWidths[1];
      doc.text(order.product_name || '', x, y, { width: columnWidths[2] });
      x += columnWidths[2];
      doc.text(order.product_description || '', x, y, { width: columnWidths[3] });
      x += columnWidths[3];
      
      doc.text(`$${(order.subtotal || 0).toFixed(2)}`, x, y, { width: columnWidths[4] });
      x += columnWidths[4];
      
      doc.text(`$${(order.total_gst_amount || 0).toFixed(2)}`, x, y, { width: columnWidths[5] });
      x += columnWidths[5];
      
      doc.text(`$${(order.total_amount || 0).toFixed(2)}`, x, y, { width: columnWidths[6] });
      x += columnWidths[6];
      
      doc.text(order.status || '', x, y, { width: columnWidths[7] });

      y += 15;
      
      // Draw row separator
      doc.moveTo(50, y).lineTo(720, y).stroke();
      y += 5;
    });

    doc.end();
  } catch (err) {
    const error = err as Error;
    console.error('salesOrderRoutes: Error generating PDF:', error);
    res.status(500).json({ error: 'Internal server error during PDF generation', details: error.message, stack: error.stack });
  }
});

export default router; 
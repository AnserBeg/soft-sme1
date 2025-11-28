import express, { Request, Response } from 'express';
import { pool } from '../db';
import PDFDocument from 'pdfkit';
import { SalesOrderService } from '../services/SalesOrderService';
import { InventoryService } from '../services/InventoryService';
import axios from 'axios';
import { getLogoImageSource } from '../utils/pdfLogoHelper';

// Helper function to check if customer exists in QuickBooks
async function checkQBOCustomerExists(customerName: string, accessToken: string, realmId: string): Promise<boolean> {
  try {
    const response = await axios.get(
      `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/query`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        params: {
          query: `SELECT * FROM Customer WHERE DisplayName = '${customerName}'`,
          minorversion: '75'
        }
      }
    );

    const customers = response.data.QueryResponse?.Customer || [];
    return customers.length > 0;
  } catch (error) {
    console.error('Error checking QBO customer:', error);
    return false;
  }
}

// Helper function to get QBO customer ID
async function getQBOCustomerId(customerName: string, accessToken: string, realmId: string): Promise<string> {
  try {
    const response = await axios.get(
      `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/query`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        params: {
          query: `SELECT * FROM Customer WHERE DisplayName = '${customerName}'`,
          minorversion: '75'
        }
      }
    );

    const customers = response.data.QueryResponse?.Customer || [];
    if (customers.length > 0) {
      return customers[0].Id;
    }
    throw new Error(`Customer '${customerName}' not found in QuickBooks`);
  } catch (error) {
    console.error('Error getting QBO customer ID:', error);
    throw error;
  }
}

// Helper function to get or create QBO item
async function getOrCreateQBOItem(itemName: string, itemType: string, incomeAccountId: string, accessToken: string, realmId: string): Promise<string> {
  try {
    // First, try to find existing item
    const queryResponse = await axios.get(
      `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/query?query=select%20Id,Name%20from%20Item%20where%20Name%20=%20'${encodeURIComponent(itemName)}'`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        },
        params: { minorversion: '75' }
      }
    );

    if (queryResponse.data.QueryResponse.Item && queryResponse.data.QueryResponse.Item.length > 0) {
      console.log(`Found existing QBO item: ${itemName} (ID: ${queryResponse.data.QueryResponse.Item[0].Id})`);
      return queryResponse.data.QueryResponse.Item[0].Id;
    }

    // Create new item if not found
    const itemData = {
      Name: itemName,
      Type: itemType,
      IncomeAccountRef: {
        value: incomeAccountId
      }
    };

    console.log(`Creating QBO item: ${itemName} with account ${incomeAccountId}`);
    const createResponse = await axios.post(
      `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/item`,
      itemData,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        params: { minorversion: '75' }
      }
    );

    const itemId = createResponse.data.Item.Id;
    console.log(`Successfully created QBO item: ${itemName} (ID: ${itemId})`);
    return itemId;
  } catch (error: any) {
    console.error(`Error getting/creating QBO item ${itemName}:`, error.response?.data || error.message);
    throw error;
  }
}

// Helper function to create customer in QuickBooks
async function createQBOCustomer(customerData: any, accessToken: string, realmId: string): Promise<string> {
  try {
    const createResponse = await axios.post(
      `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/customer`,
      customerData,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        params: { minorversion: '75' }
      }
    );

    return createResponse.data.Customer.Id;
  } catch (error) {
    console.error('Error creating QBO customer:', error);
    throw new Error(`Failed to create customer '${customerData.DisplayName}' in QuickBooks`);
  }
}

const parseBoolean = (value: any): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
  }
  return Boolean(value);
};

const normalizeInvoiceStatus = (value: any): 'needed' | 'done' | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (['needed', 'need', 'required', 'pending'].includes(normalized)) return 'needed';
    if (['done', 'complete', 'completed', 'sent'].includes(normalized)) return 'done';
    if (['true', 't', 'yes', 'y', '1', 'on'].includes(normalized)) return 'needed';
    if (['false', 'f', 'no', 'n', '0', 'off'].includes(normalized)) return null;
  }
  if (typeof value === 'boolean') {
    return value ? 'needed' : null;
  }
  if (typeof value === 'number') {
    return value > 0 ? 'needed' : null;
  }
  return null;
};

// Helper function to recalculate aggregated parts to order
async function recalculateAggregatedPartsToOrder() {
  try {
    // Clear the table first
    await pool.query('DELETE FROM aggregated_parts_to_order');
    
    // Recalculate from sales_order_parts_to_order table
    const aggregatedResult = await pool.query(`
      SELECT 
        sopt.part_number,
        sopt.part_description,
        SUM(sopt.quantity_needed) as total_quantity_needed,
        sopt.unit,
        i.last_unit_cost as unit_price,
        SUM(sopt.quantity_needed) * i.last_unit_cost as total_line_amount
      FROM sales_order_parts_to_order sopt
      JOIN salesorderhistory soh ON sopt.sales_order_id = soh.sales_order_id
      LEFT JOIN inventory i ON sopt.part_number = i.part_number
      WHERE soh.status = 'Open'
        AND sopt.quantity_needed > 0
      GROUP BY sopt.part_number, sopt.part_description, sopt.unit, i.last_unit_cost
      ORDER BY sopt.part_number
    `);
    
    // Insert only parts with non-zero quantities
    for (const row of aggregatedResult.rows) {
      if (parseFloat(row.total_quantity_needed) > 0) {
        await pool.query(`
          INSERT INTO aggregated_parts_to_order (
            part_number, part_description, total_quantity_needed, unit, unit_price, 
            total_line_amount, min_required_quantity
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          row.part_number,
          row.part_description || '',
          row.total_quantity_needed,
          row.unit || 'Each',
          row.unit_price || 0,
          row.total_line_amount || 0,
          row.total_quantity_needed
        ]);
      }
    }
    
    console.log(`Recalculated aggregated_parts_to_order: ${aggregatedResult.rows.length} parts with non-zero quantities`);
  } catch (error) {
    console.error('Error recalculating aggregated parts to order:', error);
  }
}

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

// Manual recalculation endpoint for sales order totals
router.post('/:id/recalculate', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    console.log(`Manual recalculation triggered for sales order ${id}`);
    await salesOrderService.recalculateAndUpdateSummary(parseInt(id));
    
    res.json({
      success: true,
      message: `Sales order ${id} totals recalculated successfully`
    });
  } catch (error) {
    console.error(`Error manually recalculating sales order ${id}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to recalculate sales order totals',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Create a new sales order
router.post('/', async (req: Request, res: Response) => {
  const { lineItems, ...header } = req.body ?? {};

  try {
    const created = await salesOrderService.createSalesOrder({ header, lineItems }, req.user);

    await recalculateAggregatedPartsToOrder();

    res.status(201).json({
      message: 'Sales order created successfully',
      sales_order_id: created.sales_order_id,
      sales_order_number: created.sales_order_number,
    });
  } catch (err: any) {
    console.error('Error in POST /api/sales-orders:', err);
    const message = err?.message ?? 'Internal server error';
    if (typeof message === 'string' && (message.includes('required') || message.includes('not found') || message.includes('must be'))) {
      res.status(400).json({ error: message });
      return;
    }
    res.status(500).json({ error: message || 'Internal server error' });
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
    
    // First, ensure LABOUR/OVERHEAD line items are synced from time entries
    await salesOrderService.recalculateAndUpdateSummary(Number(id));
    
    // Now fetch the updated line items (including synced LABOUR/OVERHEAD)
    const lineItemsResult = await pool.query(
      'SELECT *, CAST(quantity_sold AS TEXT) as quantity FROM salesorderlineitems WHERE sales_order_id = $1 ORDER BY sales_order_line_item_id ASC',
      [id]
    );

    // Fetch parts to order for this sales order
    const partsToOrderResult = await pool.query(
      'SELECT * FROM sales_order_parts_to_order WHERE sales_order_id = $1 ORDER BY id ASC',
      [id]
    );
    
    // Create a map of quantity_to_order by part number
    const partsToOrderMap = new Map();
    partsToOrderResult.rows.forEach(row => {
      partsToOrderMap.set(row.part_number, row.quantity_needed);
    });
    
    // Add quantity_to_order data to line items
    const mergedLineItems = lineItemsResult.rows.map(item => ({
      ...item,
      quantity_sold: item.part_number === 'SUPPLY' ? 'N/A' : item.quantity_sold,
      quantity_to_order: partsToOrderMap.get(item.part_number) || 0
    }));
    
    res.json({ 
      salesOrder, 
      lineItems: mergedLineItems,
      partsToOrder: partsToOrderResult.rows
    });
  } catch (err) {
    console.error(`salesOrderRoutes: Error fetching sales order with id ${id}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a sales order
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { lineItems, status, user_id, partsToOrder, ...salesOrderData } = req.body;

  // Trim string fields in salesOrderData
  if (salesOrderData.product_name) salesOrderData.product_name = salesOrderData.product_name.trim();
  if (salesOrderData.product_description) salesOrderData.product_description = salesOrderData.product_description.trim();
  if (salesOrderData.terms) salesOrderData.terms = salesOrderData.terms.trim();
  if (salesOrderData.customer_po_number) salesOrderData.customer_po_number = salesOrderData.customer_po_number.trim();
  if (salesOrderData.vin_number) salesOrderData.vin_number = salesOrderData.vin_number.trim();
  if (salesOrderData.unit_number) salesOrderData.unit_number = salesOrderData.unit_number.trim();
  if (salesOrderData.vehicle_make) salesOrderData.vehicle_make = salesOrderData.vehicle_make.trim();
  if (salesOrderData.vehicle_model) salesOrderData.vehicle_model = salesOrderData.vehicle_model.trim();
  if (Object.prototype.hasOwnProperty.call(salesOrderData, 'invoice_required')) {
    salesOrderData.invoice_status = normalizeInvoiceStatus((salesOrderData as any).invoice_required);
    delete (salesOrderData as any).invoice_required;
  }
  if (Object.prototype.hasOwnProperty.call(salesOrderData, 'invoice_status')) {
    salesOrderData.invoice_status = normalizeInvoiceStatus(salesOrderData.invoice_status);
  }

  // Trim string fields in lineItems
  const trimmedLineItems = lineItems ? lineItems.map((item: any) => ({
    ...item,
    part_number: item.part_number ? item.part_number.trim() : '',
    part_description: item.part_description ? item.part_description.trim() : '',
    unit: item.unit ? item.unit.trim() : ''
  })) : [];
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
    'status',
    'estimated_cost',
    'sequence_number',
    'customer_po_number',
    'vin_number',
    'unit_number',
    'vehicle_make',
    'vehicle_model',
    'invoice_status',
    'subtotal',
    'total_gst_amount',
    'total_amount',
    'quote_id',
    'source_quote_number'
  ];
    // Update sales order header fields if provided
    if (Object.keys(salesOrderData).length > 0) {
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramCount = 1;
      for (const [key, value] of Object.entries(salesOrderData)) {
        if (allowedFields.includes(key) && value !== undefined && (value !== null || key === 'invoice_status')) {
          let coercedValue: any = value;
          if (key === 'subtotal') coercedValue = parseFloat(salesOrderData.subtotal);
          if (key === 'total_gst_amount') coercedValue = parseFloat(salesOrderData.total_gst_amount);
          if (key === 'total_amount') coercedValue = parseFloat(salesOrderData.total_amount);
          if (key === 'estimated_cost') coercedValue = parseFloat(salesOrderData.estimated_cost);
          if (key === 'invoice_status') coercedValue = normalizeInvoiceStatus(value);
          if (key === 'quote_id') {
            coercedValue = value === null ? null : parseInt(value as any, 10);
          }
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
    // Update line items with simple inventory validation
    if (trimmedLineItems && trimmedLineItems.length >= 0) {
      await salesOrderService.updateSalesOrder(Number(id), trimmedLineItems, client, req.user);
    }
    
    // Update parts to order if provided
    if (partsToOrder !== undefined) {
      // First, clear ALL existing parts to order for this sales order
      await client.query(
        'DELETE FROM sales_order_parts_to_order WHERE sales_order_id = $1',
        [id]
      );
      
      // Then insert the new parts to order (if any)
      if (partsToOrder && partsToOrder.length > 0) {
        for (const part of partsToOrder) {
          await client.query(
            `INSERT INTO sales_order_parts_to_order 
             (sales_order_id, part_number, part_description, quantity_needed, unit, unit_price, line_amount) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, part.part_number, part.part_description, part.quantity_needed, part.unit, part.unit_price, part.line_amount]
          );
        }
      }
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
    
    // Recalculate aggregated parts to order after sales order update
    await recalculateAggregatedPartsToOrder();
    
    res.status(200).json({ 
      message: 'Sales order updated successfully'
    });
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
    
    // Recalculate aggregated parts to order after sales order deletion
    await recalculateAggregatedPartsToOrder();
    
    res.json({ message: 'Sales order deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// PDF Generation Route for sales orders
router.get('/:id/pdf', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const rawVisibleFields = req.query.visibleFields;
    const parsedVisibleFields: Set<string> | null = (() => {
      if (typeof rawVisibleFields === 'string') {
        return new Set(
          rawVisibleFields
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean)
        );
      }
      if (Array.isArray(rawVisibleFields)) {
        return new Set(
          rawVisibleFields
            .flatMap((f) => String(f).split(','))
            .map((f) => f.trim())
            .filter(Boolean)
        );
      }
      return null;
    })();
    const isFieldVisible = (key: string) =>
      parsedVisibleFields === null ? true : parsedVisibleFields.has(key);

    // Fetch business profile
    const businessProfileResult = await pool.query('SELECT * FROM business_profile ORDER BY id DESC LIMIT 1');
    const businessProfile = businessProfileResult.rows[0];

    const salesOrderResult = await pool.query(
      `SELECT soh.*, cm.customer_name, cm.street_address as customer_street_address, cm.city as customer_city, cm.province as customer_province, cm.country as customer_country, cm.postal_code as customer_postal_code, cm.telephone_number as customer_phone, cm.email as customer_email FROM salesorderhistory soh JOIN customermaster cm ON soh.customer_id = cm.customer_id WHERE soh.sales_order_id = $1`,
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
    const showLogo = false; // Temporarily hide logo from sales order PDFs
    const logoHeight = showLogo ? 100 : 0;
    const logoWidth = showLogo ? 180 : 0;
    const pageWidth = 600;
    const logoX = 50;
    const companyTitleX = showLogo ? logoX + logoWidth + 20 : logoX;
    const logoSource = showLogo ? await getLogoImageSource(businessProfile?.logo_url) : null;
    if (showLogo && logoSource) {
      try {
        doc.image(logoSource, logoX, headerY, { fit: [logoWidth, logoHeight] });
      } catch (error) {
        console.error('Error adding logo to PDF:', error);
      }
    }
    // Company name (right of logo, vertically centered with logo)
    const fontSize = 16;
    // Company name slightly above vertical center of logo
    const companyTitleY = showLogo
      ? headerY + (logoHeight / 2) - (fontSize / 2) - 6
      : headerY;
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
    // First line: Sales Order # and Customer PO #
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Sales Order #:', 50, y);
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(salesOrder.sales_order_number, 170, y);
    if (isFieldVisible('customerPoNumber')) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Customer PO #:', 320, y);
      doc.font('Helvetica').fontSize(11).fillColor('#000000').text(salesOrder.customer_po_number || 'N/A', 450, y);
    }
    y += 16;
    // Second line: Source Quote # (if available)
    if (isFieldVisible('sourceQuote')) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Source Quote #:', 50, y);
      doc
        .font('Helvetica')
        .fontSize(11)
        .fillColor('#000000')
        .text(salesOrder.source_quote_number || 'N/A', 170, y);
      y += 16;
    }
    // Third line: Product and Sales Date
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Product:', 50, y);
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(salesOrder.product_name || 'N/A', 170, y);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Sales Date:', 320, y);
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(
      salesOrder.sales_date ? new Date(salesOrder.sales_date).toLocaleDateString() : '',
      450, y
    );
    y += 16;
    const vinValue = salesOrder.vin_number?.trim() || '';
    if (isFieldVisible('vin') || isFieldVisible('invoiceStatus')) {
      if (isFieldVisible('vin')) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('VIN #:', 50, y);
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(vinValue || 'N/A', 170, y);
      }
      if (isFieldVisible('invoiceStatus')) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Invoice:', 320, y);
        const invoiceLabel = salesOrder.invoice_status === 'done'
          ? 'Done'
          : salesOrder.invoice_status === 'needed'
            ? 'Needed'
            : 'N/A';
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(invoiceLabel, 450, y);
      }
      y += 16;
    }
    const makeValue = salesOrder.vehicle_make?.trim() || '';
    const modelValue = salesOrder.vehicle_model?.trim() || '';
    if (isFieldVisible('vehicleMake') || isFieldVisible('vehicleModel')) {
      if (isFieldVisible('vehicleMake')) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Make:', 50, y);
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(makeValue || 'N/A', 170, y);
      }
      if (isFieldVisible('vehicleModel')) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Model:', 320, y);
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(modelValue || 'N/A', 450, y);
      }
      y += 16;
    }
    y += 8;
    // Product Description below
    if (isFieldVisible('productDescription')) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Product Description:', 50, y);
      const descResult = doc.font('Helvetica').fontSize(11).fillColor('#000000').text(salesOrder.product_description || '', 170, y, { width: 370 });
      y = descResult.y + 8;
    }
    // Horizontal line
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 14;

    // --- Line Items temporarily suppressed ---
    y += 6;

    // Totals intentionally hidden (temporary)

    // --- Terms Section ---
    y += 40;
    if (isFieldVisible('terms') && salesOrder.terms && salesOrder.terms.trim()) {
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

// Export Sales Order to QuickBooks as Invoice
router.post('/:id/export-to-qbo', async (req: Request, res: Response) => {
  const { id } = req.params;
  const companyId = 9; // TODO: Get from user session

  try {
    console.log(`Exporting Sales Order ${id} to QuickBooks for company_id: ${companyId}`);

    // 1. Get QBO connection and account mapping
    console.log(`Checking QBO connection and mapping for company_id: ${companyId}`);
    
    const [qboResult, mappingResult] = await Promise.all([
      pool.query('SELECT * FROM qbo_connection WHERE company_id = $1', [companyId]),
      pool.query('SELECT * FROM qbo_account_mapping WHERE company_id = $1', [companyId])
    ]);

    console.log(`QBO connection result: ${qboResult.rows.length} rows found`);
    console.log(`Account mapping result: ${mappingResult.rows.length} rows found`);

    if (qboResult.rows.length === 0) {
      return res.status(400).json({ error: 'QuickBooks connection not found. Please connect your QuickBooks account first.' });
    }

    if (mappingResult.rows.length === 0) {
      return res.status(400).json({ error: 'QuickBooks account mapping not configured. Please set up account mapping in QBO Settings first.' });
    }

    const qboConnection = qboResult.rows[0];
    const accountMapping = mappingResult.rows[0];

    // Validate required account mappings for sales orders
    if (!accountMapping.qbo_sales_account_id || !accountMapping.qbo_ar_account_id) {
      return res.status(400).json({ 
        error: 'QuickBooks account mapping incomplete. Please configure Sales Account and Accounts Receivable in QBO Settings.' 
      });
    }

    // 2. Get the Sales Order details
    const soResult = await pool.query(`
      SELECT 
        soh.*,
        cm.customer_name,
        cm.email as customer_email,
        cm.telephone_number as customer_phone,
        cm.street_address as customer_address,
        cm.city as customer_city,
        cm.province as customer_state,
        cm.postal_code as customer_postal_code
      FROM salesorderhistory soh
      LEFT JOIN customermaster cm ON soh.customer_id = cm.customer_id
      WHERE soh.sales_order_id = $1
    `, [id]);

    if (soResult.rows.length === 0) {
      return res.status(404).json({ error: 'Sales Order not found' });
    }

    const salesOrder = soResult.rows[0];

    // Check if SO is closed
    if (salesOrder.status !== 'Closed') {
      return res.status(400).json({ error: 'Sales Order must be closed to export to QuickBooks.' });
    }

    // Check if already exported
    if (salesOrder.exported_to_qbo) {
      return res.status(400).json({ error: 'Sales Order already exported to QuickBooks.' });
    }

    // 3. Get SO line items
    const lineItemsResult = await pool.query(`
      SELECT 
        soli.*,
        i.part_type
      FROM salesorderlineitems soli
      LEFT JOIN inventory i ON soli.part_number = i.part_number
      WHERE soli.sales_order_id = $1
      ORDER BY soli.sales_order_line_item_id ASC
    `, [id]);

    const lineItems = lineItemsResult.rows;
    console.log(`Found ${lineItems.length} line items for SO ${id}`);

    // 4. Check if token is expired and refresh if needed
    if (new Date(qboConnection.expires_at) < new Date()) {
      try {
        const refreshResponse = await axios.post('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
          grant_type: 'refresh_token',
          refresh_token: qboConnection.refresh_token
        }, {
          auth: {
            username: process.env.QBO_CLIENT_ID!,
            password: process.env.QBO_CLIENT_SECRET!
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        const { access_token, refresh_token, expires_in } = refreshResponse.data;
        
        // Update tokens in database
        await pool.query(
          `UPDATE qbo_connection SET 
           access_token = $1, refresh_token = $2, expires_at = $3, updated_at = NOW() 
           WHERE company_id = $4`,
          [access_token, refresh_token, new Date(Date.now() + expires_in * 1000), companyId]
        );

        qboConnection.access_token = access_token;
      } catch (refreshError) {
        console.error('Error refreshing QBO token:', refreshError);
        return res.status(401).json({ error: 'QuickBooks token expired and could not be refreshed. Please reconnect your account.' });
      }
    }

    // 5. Check if customer exists in QuickBooks
    let qboCustomerId = null;
    try {
      // Search for existing customer
      const customerSearchResponse = await axios.get(
        `https://sandbox-quickbooks.api.intuit.com/v3/company/${qboConnection.realm_id}/query`,
        {
          headers: {
            'Authorization': `Bearer ${qboConnection.access_token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          params: {
            query: `SELECT * FROM Customer WHERE DisplayName = '${salesOrder.customer_name}'`,
            minorversion: '75'
          }
        }
      );

      const customers = customerSearchResponse.data.QueryResponse?.Customer || [];
      if (customers.length > 0) {
        qboCustomerId = customers[0].Id;
        console.log(`Found existing QBO customer: ${salesOrder.customer_name} (ID: ${qboCustomerId})`);
      } else {
        // Customer doesn't exist - return error with customer data for creation
        console.log(`Customer not found in QuickBooks: ${salesOrder.customer_name}`);
        
        // Get customer details from customermaster
        const customerResult = await pool.query(
          'SELECT * FROM customermaster WHERE customer_name = $1',
          [salesOrder.customer_name]
        );
        
        let customerData = {
          DisplayName: salesOrder.customer_name,
          PrimaryEmailAddr: { Address: '' },
          PrimaryPhone: { FreeFormNumber: '' },
          BillAddr: {
            Line1: '',
            City: '',
            CountrySubDivisionCode: '',
            PostalCode: ''
          }
        };
        
        if (customerResult.rows.length > 0) {
          const customer = customerResult.rows[0];
          customerData = {
            DisplayName: customer.customer_name,
            PrimaryEmailAddr: { Address: customer.email || '' },
            PrimaryPhone: { FreeFormNumber: customer.telephone_number || '' },
            BillAddr: {
              Line1: customer.street_address || '',
              City: customer.city || '',
              CountrySubDivisionCode: customer.province || '',
              PostalCode: customer.postal_code || ''
            }
          };
        }
        
        return res.status(400).json({ 
          error: 'CUSTOMER_NOT_FOUND',
          message: `Customer "${salesOrder.customer_name}" does not exist in QuickBooks. Please create the customer in QuickBooks first, then try exporting again.`,
          customerName: salesOrder.customer_name,
          customerData: customerData
        });
      }
    } catch (customerError) {
      console.error('Error checking customer:', customerError);
      return res.status(500).json({ error: 'Failed to check customer in QuickBooks' });
    }

    // 6. Create invoice line items from the actual sales order line items
    const invoiceLineItems: any[] = [];
    const materialItems: any[] = [];
    const labourItems: any[] = [];
    const overheadItems: any[] = [];

    // Separate line items by type (ignore SUPPLY items)
    lineItems.forEach(item => {
      if (item.part_number === 'LABOUR') {
        labourItems.push(item);
      } else if (item.part_number === 'OVERHEAD') {
        overheadItems.push(item);
      } else if (item.part_number === 'SUPPLY') {
        // Ignore SUPPLY items - they should not be exported to QuickBooks
        console.log(`Skipping SUPPLY line item for QBO export: ${item.part_number}`);
      } else {
        materialItems.push(item);
      }
    });

    // Calculate actual labour and overhead hours from time entries
    const timeEntriesResult = await pool.query(
      `SELECT SUM(duration) as total_hours
       FROM time_entries WHERE sales_order_id = $1 AND clock_out IS NOT NULL`,
      [id]
    );
    
    const actualTotalHours = parseFloat(timeEntriesResult.rows[0].total_hours) || 0;
    
    // Get global labour rate
    const labourRateRes = await pool.query("SELECT value FROM global_settings WHERE key = 'labour_rate'");
    const actualAvgRate = labourRateRes.rows.length > 0 ? parseFloat(labourRateRes.rows[0].value) : 60;
    const actualTotalCost = actualTotalHours * actualAvgRate;
    
    // Get global overhead rate
    const overheadRateRes = await pool.query("SELECT value FROM global_settings WHERE key = 'overhead_rate'");
    const overheadRate = overheadRateRes.rows.length > 0 ? parseFloat(overheadRateRes.rows[0].value) : 0;
    const actualTotalOverheadCost = actualTotalHours * overheadRate;
    
    console.log(`Time entries: total_hours=${actualTotalHours}, labour_rate=${actualAvgRate}, total_cost=${actualTotalCost}, overhead_rate=${overheadRate}, overhead_cost=${actualTotalOverheadCost}`);
    
    // Update labour and overhead items with actual values from time entries
    if (actualTotalHours > 0) {
      // Update or create LABOUR item with actual values
      if (labourItems.length > 0) {
        labourItems[0].quantity_sold = actualTotalHours;
        labourItems[0].unit_price = actualAvgRate;
        labourItems[0].line_amount = actualTotalHours * actualAvgRate;
        console.log(`Updated LABOUR item: quantity_sold=${labourItems[0].quantity_sold}, unit_price=${labourItems[0].unit_price}, line_amount=${labourItems[0].line_amount}`);
      } else {
        labourItems.push({
          part_number: 'LABOUR',
          part_description: 'Labour Hours',
          quantity_sold: actualTotalHours,
          unit: 'hr',
          unit_price: actualAvgRate,
          line_amount: actualTotalHours * actualAvgRate
        });
        console.log(`Created LABOUR item: quantity_sold=${actualTotalHours}, unit_price=${actualAvgRate}, line_amount=${actualTotalHours * actualAvgRate}`);
      }
      
      // Update or create OVERHEAD item with actual values
      if (overheadItems.length > 0) {
        overheadItems[0].quantity_sold = actualTotalHours;
        overheadItems[0].unit_price = overheadRate;
        overheadItems[0].line_amount = actualTotalOverheadCost;
        console.log(`Updated OVERHEAD item: quantity_sold=${overheadItems[0].quantity_sold}, unit_price=${overheadItems[0].unit_price}, line_amount=${overheadItems[0].line_amount}`);
      } else {
        overheadItems.push({
          part_number: 'OVERHEAD',
          part_description: 'Overhead Hours',
          quantity_sold: actualTotalHours,
          unit: 'hr',
          unit_price: overheadRate,
          line_amount: actualTotalOverheadCost
        });
        console.log(`Created OVERHEAD item: quantity_sold=${actualTotalHours}, unit_price=${overheadRate}, line_amount=${actualTotalOverheadCost}`);
      }
    } else {
      console.log(`No time entries found for SO ${id}, labour and overhead will remain at 0`);
    }

    console.log(`Processing ${materialItems.length} material items, ${labourItems.length} labour items, and ${overheadItems.length} overhead items`);

    // 7. Create invoice with proper account mapping
    // Calculate amounts based on estimated price for revenue
    const estimatedPrice = parseFloat(salesOrder.estimated_cost || salesOrder.subtotal);
    const gstAmount = estimatedPrice * 0.05; // 5% GST
    const totalAmount = estimatedPrice + gstAmount; // 1.05 × estimated price

    console.log(`Sales Order amounts: estimatedPrice=${estimatedPrice}, gstAmount=${gstAmount}, totalAmount=${totalAmount}`);

    // Get or create QBO items for the actual product and GST
    const productItemId = await getOrCreateQBOItem(salesOrder.product_name, 'Service', accountMapping.qbo_sales_account_id, qboConnection.access_token, qboConnection.realm_id);
    const gstItemId = await getOrCreateQBOItem('GST', 'Service', accountMapping.qbo_gst_account_id, qboConnection.access_token, qboConnection.realm_id);

    console.log(`Using QBO items: Product=${productItemId}, GST=${gstItemId}`);

    // Create invoice with proper account mapping
    const invoiceData = {
      CustomerRef: {
        value: qboCustomerId
      },
      ARAccountRef: {
        value: accountMapping.qbo_ar_account_id
      },
      Line: [
        // Main product line item: estimated price
        {
          DetailType: 'SalesItemLineDetail',
          Amount: estimatedPrice,
          Description: salesOrder.product_description || '',
          SalesItemLineDetail: {
            ItemRef: {
              value: productItemId
            },
            Qty: 1,
            UnitPrice: estimatedPrice
          }
        },
        // GST Account: 5% of estimated price
        ...(gstAmount > 0 ? [{
          DetailType: 'SalesItemLineDetail',
          Amount: gstAmount,
          Description: 'GST (5%)',
          SalesItemLineDetail: {
            ItemRef: {
              value: gstItemId
            },
            Qty: 1,
            UnitPrice: gstAmount
          }
        }] : [])
      ],
      DocNumber: salesOrder.sales_order_number,
      TxnDate: salesOrder.sales_date,
      DueDate: salesOrder.sales_date,
      PrivateNote: `Exported from Aiven Sales Order #${salesOrder.sales_order_number}`,
      CustomerMemo: {
        value: salesOrder.terms || ''
      },
      ShipFromAddr: {
        Line1: 'Your Company Address', // TODO: Get from business profile
        City: 'Your City',
        CountrySubDivisionCode: 'Your State',
        PostalCode: 'Your Postal Code'
      },
      BillEmail: {
        Address: salesOrder.customer_email
      }
    };

    console.log(`Creating Invoice with: Sales=${estimatedPrice}, GST=${gstAmount}, Total=${totalAmount}`);
    console.log(`Accounts: GST=${accountMapping.qbo_gst_account_id}, AR=${accountMapping.qbo_ar_account_id}`);

    console.log('Creating Invoice in QuickBooks with data:', JSON.stringify(invoiceData, null, 2));

    // 8. Create invoice in QuickBooks
    let qboInvoiceId: string;
    try {
      const invoiceResponse = await axios.post(
        `https://sandbox-quickbooks.api.intuit.com/v3/company/${qboConnection.realm_id}/invoice`,
        invoiceData,
        {
          headers: {
            'Authorization': `Bearer ${qboConnection.access_token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          params: { minorversion: '75' }
        }
      );

      qboInvoiceId = invoiceResponse.data.Invoice.Id;
      console.log(`Successfully created QBO Invoice with ID: ${qboInvoiceId}`);
    } catch (invoiceError: any) {
      console.error('QuickBooks Invoice creation error:', JSON.stringify(invoiceError.response?.data, null, 2));
      console.error('Full error object:', JSON.stringify(invoiceError, null, 2));
      return res.status(400).json({ 
        error: 'Failed to create invoice in QuickBooks',
        details: invoiceError.response?.data || invoiceError.message
      });
    }
    console.log(`Successfully created QBO Invoice with ID: ${qboInvoiceId}`);

    // 9. Create journal entry for COGS and inventory reduction
    let totalMaterialCOGS = 0;
    let totalLabourCOGS = 0;
    let totalOverheadCOGS = 0;
    
    if (materialItems.length > 0 || labourItems.length > 0) {
      const journalEntryLines = [];

      // Calculate COGS for material items
      for (const item of materialItems) {
        // For sales orders, use the actual line item amount as COGS
        const itemCOGS = parseFloat(item.line_amount);
        totalMaterialCOGS += itemCOGS;

        console.log(`COGS for material ${item.part_number}: ${itemCOGS} (line amount)`);
        console.log(`Running total Material COGS: ${totalMaterialCOGS}`);
      }

      // Calculate COGS for labour items (use actual values from time entries)
      for (const item of labourItems) {
        // For labour, use the actual calculated values from time entries
        const itemCOGS = parseFloat(item.line_amount);
        totalLabourCOGS += itemCOGS;

        console.log(`COGS calculation for labour ${item.part_number}: quantity_sold=${item.quantity_sold}, unit_price=${item.unit_price}, line_amount=${item.line_amount}, itemCOGS=${itemCOGS}`);
        console.log(`Running total Labour COGS: ${totalLabourCOGS}`);
      }

      // Calculate COGS for overhead items (use actual values from time entries)
      for (const item of overheadItems) {
        // For overhead, use the actual calculated values from time entries
        const itemCOGS = parseFloat(item.line_amount);
        totalOverheadCOGS += itemCOGS;

        console.log(`COGS calculation for overhead ${item.part_number}: quantity_sold=${item.quantity_sold}, unit_price=${item.unit_price}, line_amount=${item.line_amount}, itemCOGS=${itemCOGS}`);
        console.log(`Running total Overhead COGS: ${totalOverheadCOGS}`);
      }

      // Add material COGS entries (if any materials)
      if (totalMaterialCOGS > 0) {
        // Debit Cost of Materials Account (expense)
        journalEntryLines.push({
          Description: `Cost of Materials for SO #${salesOrder.sales_order_number}`,
          Amount: totalMaterialCOGS,
          DetailType: 'JournalEntryLineDetail',
          JournalEntryLineDetail: {
            PostingType: 'Debit',
            AccountRef: {
              value: accountMapping.qbo_cost_of_materials_account_id || accountMapping.qbo_cogs_account_id
            }
          }
        });

        // Credit Inventory Account (reducing inventory for materials only)
        journalEntryLines.push({
          Description: `Inventory reduction for materials - SO #${salesOrder.sales_order_number}`,
          Amount: totalMaterialCOGS,
          DetailType: 'JournalEntryLineDetail',
          JournalEntryLineDetail: {
            PostingType: 'Credit',
            AccountRef: {
              value: accountMapping.qbo_inventory_account_id
            }
          }
        });
      }

      // Add labour COGS entries (if any labour)
      if (totalLabourCOGS > 0 && accountMapping.qbo_cost_of_labour_account_id) {
        // Debit Cost of Labour Account (expense)
        journalEntryLines.push({
          Description: `Cost of Labour for SO #${salesOrder.sales_order_number}`,
          Amount: totalLabourCOGS,
          DetailType: 'JournalEntryLineDetail',
          JournalEntryLineDetail: {
            PostingType: 'Debit',
            AccountRef: {
              value: accountMapping.qbo_cost_of_labour_account_id
            }
          }
        });

        // Credit Labour Expense Reduction Account (reducing the expense)
        journalEntryLines.push({
          Description: `Labour expense reduction for SO #${salesOrder.sales_order_number}`,
          Amount: totalLabourCOGS,
          DetailType: 'JournalEntryLineDetail',
          JournalEntryLineDetail: {
            PostingType: 'Credit',
            AccountRef: {
              value: accountMapping.qbo_labour_expense_reduction_account_id
            }
          }
        });
      }

      // Add overhead COGS entries (if any overhead)
      if (totalOverheadCOGS > 0 && accountMapping.qbo_overhead_cogs_account_id) {
        // Debit Overhead COGS Account (expense)
        journalEntryLines.push({
          Description: `Cost of Overhead for SO #${salesOrder.sales_order_number}`,
          Amount: totalOverheadCOGS,
          DetailType: 'JournalEntryLineDetail',
          JournalEntryLineDetail: {
            PostingType: 'Debit',
            AccountRef: {
              value: accountMapping.qbo_overhead_cogs_account_id
            }
          }
        });

        // Get expense distribution and create multiple credit lines
        const distributionResult = await pool.query(
          'SELECT * FROM overhead_expense_distribution WHERE company_id = $1 AND is_active = TRUE ORDER BY id',
          [companyId]
        );

        if (distributionResult.rows.length > 0) {
          for (const dist of distributionResult.rows) {
            const creditAmount = totalOverheadCOGS * (dist.percentage / 100);
            journalEntryLines.push({
              Description: `Overhead reduction - ${dist.description} (${dist.percentage}%)`,
              Amount: creditAmount,
              DetailType: 'JournalEntryLineDetail',
              JournalEntryLineDetail: {
                PostingType: 'Credit',
                AccountRef: {
                  value: dist.expense_account_id
                }
              }
            });
          }
        } else {
          // If no distribution is configured, credit to a default account or log warning
          console.warn('No overhead expense distribution configured. Overhead COGS will not be properly allocated.');
        }
      }

      if (journalEntryLines.length > 0) {
        const journalEntryData = {
          Line: journalEntryLines,
          TxnDate: salesOrder.sales_date,
          DocNumber: `COGS-${salesOrder.sales_order_number}`,
          PrivateNote: `Cost of Goods Sold for Sales Order #${salesOrder.sales_order_number} (Materials: ${materialItems.length}, Labour: ${labourItems.length})`
        };

        console.log('Creating Journal Entry for COGS:', JSON.stringify(journalEntryData, null, 2));
        console.log(`Total journal entry lines: ${journalEntryLines.length}`);
        console.log(`Material COGS: ${totalMaterialCOGS}, Labour COGS: ${totalLabourCOGS}, Overhead COGS: ${totalOverheadCOGS}`);

        try {
          const journalResponse = await axios.post(
            `https://sandbox-quickbooks.api.intuit.com/v3/company/${qboConnection.realm_id}/journalentry`,
            journalEntryData,
            {
              headers: {
                'Authorization': `Bearer ${qboConnection.access_token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
              },
              params: { minorversion: '75' }
            }
          );

          console.log(`Successfully created COGS Journal Entry with ID: ${journalResponse.data.JournalEntry.Id}`);
          console.log('Journal Entry Response:', JSON.stringify(journalResponse.data, null, 2));
        } catch (journalError: any) {
          console.error('Error creating COGS journal entry:', journalError.response?.data || journalError.message);
          // Continue even if journal entry fails
        }
      } else {
        console.log('No journal entry lines to create - no COGS to record');
      }
    }

    // Note: Inventory quantities are not updated upon export to QuickBooks
    // The inventory table in Aiven remains unchanged for stock parts

    // 11. Update SO with QBO export info
    await pool.query(
      `UPDATE salesorderhistory SET 
       exported_to_qbo = TRUE, 
       qbo_invoice_id = $1,
       qbo_export_date = NOW(),
       qbo_export_status = 'exported'
       WHERE sales_order_id = $2`,
      [qboInvoiceId, id]
    );

    res.json({
      success: true,
      message: 'Sales Order exported to QuickBooks successfully',
      qboInvoiceId: qboInvoiceId,
      accountingSummary: {
        salesAmount: estimatedPrice.toFixed(2),
        gstAmount: gstAmount.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        materials: materialItems.length,
        labour: labourItems.length,
        overhead: overheadItems.length,
        total: materialItems.length + labourItems.length + overheadItems.length
      },
      costSummary: {
        materialCOGS: totalMaterialCOGS ? totalMaterialCOGS.toFixed(2) : '0.00',
        labourCOGS: totalLabourCOGS ? totalLabourCOGS.toFixed(2) : '0.00',
        overheadCOGS: totalOverheadCOGS ? totalOverheadCOGS.toFixed(2) : '0.00',
        totalCOGS: ((totalMaterialCOGS || 0) + (totalLabourCOGS || 0) + (totalOverheadCOGS || 0)).toFixed(2)
      },
      gstExported: gstAmount > 0,
      inventoryUpdated: materialItems.length
    });

  } catch (error) {
    console.error('Error exporting Sales Order to QuickBooks:', error);
    res.status(500).json({ error: 'Failed to export Sales Order to QuickBooks' });
  }
});

// Export Sales Order to QuickBooks with customer creation
router.post('/:id/export-to-qbo-with-customer', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { customerData } = req.body;
  
  try {
    // Check SO exists and is closed
    const soResult = await pool.query('SELECT * FROM salesorderhistory WHERE sales_order_id = $1', [id]);
    if (soResult.rows.length === 0) return res.status(404).json({ error: 'Sales Order not found' });
    
    const salesOrder = soResult.rows[0];
    if (salesOrder.status !== 'Closed') return res.status(400).json({ error: 'Sales Order must be closed to export to QuickBooks.' });
    if (salesOrder.exported_to_qbo) return res.status(400).json({ error: 'Sales Order already exported to QuickBooks.' });

    // Get QBO connection
    const qboResult = await pool.query('SELECT * FROM qbo_connection WHERE company_id = $1', [9]);
    if (qboResult.rows.length === 0) {
      return res.status(400).json({ error: 'QuickBooks connection not found. Please connect your QuickBooks account first.' });
    }

    const qboConnection = qboResult.rows[0];
    
    // Check if token is expired and refresh if needed
    if (new Date(qboConnection.expires_at) < new Date()) {
      try {
        const refreshResponse = await axios.post('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
          grant_type: 'refresh_token',
          refresh_token: qboConnection.refresh_token
        }, {
          auth: {
            username: process.env.QBO_CLIENT_ID!,
            password: process.env.QBO_CLIENT_SECRET!
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        const { access_token, refresh_token, expires_in } = refreshResponse.data;
        
        // Update tokens in database
        await pool.query(
          `UPDATE qbo_connection SET 
           access_token = $1, refresh_token = $2, expires_at = $3, updated_at = NOW() 
           WHERE company_id = $4`,
          [access_token, refresh_token, new Date(Date.now() + expires_in * 1000), 9]
        );

        qboConnection.access_token = access_token;
      } catch (refreshError) {
        console.error('Error refreshing QBO token:', refreshError);
        return res.status(401).json({ error: 'QuickBooks token expired and could not be refreshed. Please reconnect your account.' });
      }
    }

    // Create customer in QBO first
    const qboCustomerId = await createQBOCustomer(customerData, qboConnection.access_token, qboConnection.realm_id);

    // Get SO line items
    const lineItemsResult = await pool.query(`
      SELECT 
        soli.*,
        i.part_type
      FROM salesorderlineitems soli
      LEFT JOIN inventory i ON soli.part_number = i.part_number
      WHERE soli.sales_order_id = $1
      ORDER BY soli.sales_order_line_item_id ASC
    `, [id]);

    const lineItems = lineItemsResult.rows;

    // Get QBO account mapping
    const accountMappingResult = await pool.query('SELECT * FROM qbo_account_mapping WHERE company_id = $1', [9]);
    if (accountMappingResult.rows.length === 0) {
      return res.status(400).json({ error: 'QuickBooks account mapping not configured. Please set up account mapping in QBO Settings first.' });
    }
    const accountMapping = accountMappingResult.rows[0];

    // Separate line items by type and validate for supply items (ignore SUPPLY line items)
    const materialItems: any[] = [];
    const labourItems: any[] = [];
    const overheadItems: any[] = [];
    const supplyItems: any[] = [];

    lineItems.forEach(item => {
      if (item.part_number === 'LABOUR') {
        labourItems.push(item);
      } else if (item.part_number === 'OVERHEAD') {
        overheadItems.push(item);
      } else if (item.part_number === 'SUPPLY') {
        // Ignore SUPPLY line items - they should not be exported to QuickBooks
        console.log(`Skipping SUPPLY line item for QBO export: ${item.part_number}`);
      } else if (item.part_type === 'supply') {
        supplyItems.push(item);
      } else {
        materialItems.push(item);
      }
    });

    // Check if there are any supply items - these should not be in sales orders
    if (supplyItems.length > 0) {
      const supplyPartNumbers = supplyItems.map(item => item.part_number).join(', ');
      return res.status(400).json({ 
        error: 'Supply items not allowed in sales orders',
        message: `Sales Order contains supply items which are not allowed: ${supplyPartNumbers}. Please remove supply items from the sales order before exporting to QuickBooks.`,
        supplyItems: supplyItems.map(item => ({
          part_number: item.part_number,
          part_description: item.part_description,
          quantity_sold: item.quantity_sold
        }))
      });
    }

    // Calculate amounts based on estimated price
    const estimatedPrice = parseFloat(salesOrder.estimated_cost || salesOrder.subtotal);
    const gstAmount = estimatedPrice * 0.05; // 5% GST
    const totalAmount = estimatedPrice + gstAmount; // 1.05 × estimated price

    // Get or create QBO items for sales and GST
    const salesItemId = await getOrCreateQBOItem('Sales', 'Service', accountMapping.qbo_sales_account_id, qboConnection.access_token, qboConnection.realm_id);
    const gstItemId = await getOrCreateQBOItem('GST', 'Service', accountMapping.qbo_gst_account_id, qboConnection.access_token, qboConnection.realm_id);

    console.log(`Using QBO items: Sales=${salesItemId}, GST=${gstItemId}`);

    // Create invoice with proper account mapping
    const invoiceData = {
      CustomerRef: {
        value: qboCustomerId
      },
      ARAccountRef: {
        value: accountMapping.qbo_ar_account_id
      },
      Line: [
        {
          Amount: estimatedPrice,
          DetailType: 'SalesItemLineDetail',
          Description: `Sales for ${salesOrder.product_description}`,
          SalesItemLineDetail: {
            ItemRef: {
              value: salesItemId
            },
            Qty: 1,
            UnitPrice: estimatedPrice
          }
        },
        {
          Amount: gstAmount,
          DetailType: 'SalesItemLineDetail',
          Description: 'GST (5%)',
          SalesItemLineDetail: {
            ItemRef: {
              value: gstItemId
            },
            Qty: 1,
            UnitPrice: gstAmount
          }
        }
      ]
    };

    // Create invoice in QuickBooks
    const invoiceResponse = await axios.post(
      `https://sandbox-quickbooks.api.intuit.com/v3/company/${qboConnection.realm_id}/invoice`,
      invoiceData,
      {
        headers: {
          'Authorization': `Bearer ${qboConnection.access_token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        params: { minorversion: '75' }
      }
    );

    const qboInvoiceId = invoiceResponse.data.Invoice.Id;

    // Create journal entry for COGS and inventory reduction
    let totalMaterialCOGS = 0;
    let totalLabourCOGS = 0;
    let totalOverheadCOGS = 0;
    
    if (materialItems.length > 0 || labourItems.length > 0) {
      const journalEntryLines = [];

      // Calculate COGS for material items
      for (const item of materialItems) {
        // For sales orders, use the actual line item amount as COGS
        const itemCOGS = parseFloat(item.line_amount);
        totalMaterialCOGS += itemCOGS;
      }

      // Calculate COGS for labour items
      for (const item of labourItems) {
        const itemCOGS = parseFloat(item.line_amount);
        totalLabourCOGS += itemCOGS;
      }

      // Calculate COGS for overhead items
      for (const item of overheadItems) {
        const itemCOGS = parseFloat(item.line_amount);
        totalOverheadCOGS += itemCOGS;
      }

      // Add material COGS entries (if any materials)
      if (totalMaterialCOGS > 0) {
        journalEntryLines.push({
          Description: `Cost of Materials for SO #${salesOrder.sales_order_number}`,
          Amount: totalMaterialCOGS,
          DetailType: 'JournalEntryLineDetail',
          JournalEntryLineDetail: {
            PostingType: 'Debit',
            AccountRef: {
              value: accountMapping.qbo_cost_of_materials_account_id || accountMapping.qbo_cogs_account_id
            }
          }
        });

        journalEntryLines.push({
          Description: `Inventory reduction for materials - SO #${salesOrder.sales_order_number}`,
          Amount: totalMaterialCOGS,
          DetailType: 'JournalEntryLineDetail',
          JournalEntryLineDetail: {
            PostingType: 'Credit',
            AccountRef: {
              value: accountMapping.qbo_inventory_account_id
            }
          }
        });
      }

      // Add labour COGS entries (if any labour)
      if (totalLabourCOGS > 0 && accountMapping.qbo_cost_of_labour_account_id) {
        journalEntryLines.push({
          Description: `Cost of Labour for SO #${salesOrder.sales_order_number}`,
          Amount: totalLabourCOGS,
          DetailType: 'JournalEntryLineDetail',
          JournalEntryLineDetail: {
            PostingType: 'Debit',
            AccountRef: {
              value: accountMapping.qbo_cost_of_labour_account_id
            }
          }
        });

        journalEntryLines.push({
          Description: `Labour expense reduction for SO #${salesOrder.sales_order_number}`,
          Amount: totalLabourCOGS,
          DetailType: 'JournalEntryLineDetail',
          JournalEntryLineDetail: {
            PostingType: 'Credit',
            AccountRef: {
              value: accountMapping.qbo_labour_expense_reduction_account_id
            }
          }
        });
      }

      // Add overhead COGS entries (if any overhead)
      if (totalOverheadCOGS > 0 && accountMapping.qbo_overhead_cogs_account_id) {
        // Debit Overhead COGS Account (expense)
        journalEntryLines.push({
          Description: `Cost of Overhead for SO #${salesOrder.sales_order_number}`,
          Amount: totalOverheadCOGS,
          DetailType: 'JournalEntryLineDetail',
          JournalEntryLineDetail: {
            PostingType: 'Debit',
            AccountRef: {
              value: accountMapping.qbo_overhead_cogs_account_id
            }
          }
        });

        // Get expense distribution and create multiple credit lines
        const distributionResult = await pool.query(
          'SELECT * FROM overhead_expense_distribution WHERE company_id = $1 AND is_active = TRUE ORDER BY id',
          [9] // companyId = 9 for now
        );

        if (distributionResult.rows.length > 0) {
          for (const dist of distributionResult.rows) {
            const creditAmount = totalOverheadCOGS * (dist.percentage / 100);
            journalEntryLines.push({
              Description: `Overhead reduction - ${dist.description} (${dist.percentage}%)`,
              Amount: creditAmount,
              DetailType: 'JournalEntryLineDetail',
              JournalEntryLineDetail: {
                PostingType: 'Credit',
                AccountRef: {
                  value: dist.expense_account_id
                }
              }
            });
          }
        } else {
          // If no distribution is configured, credit to a default account or log warning
          console.warn('No overhead expense distribution configured. Overhead COGS will not be properly allocated.');
        }
      }

      if (journalEntryLines.length > 0) {
        const journalEntryData = {
          Line: journalEntryLines,
          TxnDate: salesOrder.sales_date,
          DocNumber: `COGS-${salesOrder.sales_order_number}`,
          PrivateNote: `Cost of Goods Sold for Sales Order #${salesOrder.sales_order_number} (Materials: ${materialItems.length}, Labour: ${labourItems.length})`
        };

        try {
          await axios.post(
            `https://sandbox-quickbooks.api.intuit.com/v3/company/${qboConnection.realm_id}/journalentry`,
            journalEntryData,
            {
              headers: {
                'Authorization': `Bearer ${qboConnection.access_token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
              },
              params: { minorversion: '75' }
            }
          );
        } catch (journalError: any) {
          console.error('Error creating COGS journal entry:', journalError.response?.data || journalError.message);
        }
      }
    }

    // Note: Inventory quantities are not updated upon export to QuickBooks
    // The inventory table in Aiven remains unchanged for stock parts

    // Update SO with QBO export info
    await pool.query(
      `UPDATE salesorderhistory SET 
       exported_to_qbo = TRUE, 
       qbo_invoice_id = $1,
       qbo_export_date = NOW(),
       qbo_export_status = 'exported'
       WHERE sales_order_id = $2`,
      [qboInvoiceId, id]
    );

    res.json({
      success: true,
      message: 'Customer created and Sales Order exported to QuickBooks successfully',
      qboInvoiceId: qboInvoiceId,
      qboCustomerId: qboCustomerId,
      accountingSummary: {
        salesAmount: estimatedPrice.toFixed(2),
        gstAmount: gstAmount.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        materials: materialItems.length,
        labour: labourItems.length,
        overhead: overheadItems.length,
        total: materialItems.length + labourItems.length + overheadItems.length
      },
      costSummary: {
        materialCOGS: totalMaterialCOGS ? totalMaterialCOGS.toFixed(2) : '0.00',
        labourCOGS: totalLabourCOGS ? totalLabourCOGS.toFixed(2) : '0.00',
        overheadCOGS: totalOverheadCOGS ? totalOverheadCOGS.toFixed(2) : '0.00',
        totalCOGS: ((totalMaterialCOGS || 0) + (totalLabourCOGS || 0) + (totalOverheadCOGS || 0)).toFixed(2)
      }
    });

  } catch (error: any) {
    console.error('Error creating customer and exporting Sales Order to QuickBooks:', error);
    res.status(500).json({ 
      error: 'Failed to create customer and export Sales Order to QuickBooks',
      details: error.message 
    });
  }
});

// Get export status for a Sales Order
router.get('/:id/export-status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT exported_to_qbo, qbo_invoice_id, qbo_export_date, qbo_export_status FROM salesorderhistory WHERE sales_order_id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sales Order not found' });
    }

    res.json({
      exported: result.rows[0].exported_to_qbo,
      qboInvoiceId: result.rows[0].qbo_invoice_id,
      exportDate: result.rows[0].qbo_export_date,
      exportStatus: result.rows[0].qbo_export_status
    });

  } catch (error) {
    console.error('Error getting export status:', error);
    res.status(500).json({ error: 'Failed to get export status' });
  }
});

// Get all parts to order (individual and aggregated)
router.get('/parts-to-order/all', async (req: Request, res: Response) => {
  try {
    // First, clean up orphaned entries in aggregated_parts_to_order
    // Remove parts that don't have corresponding sales order entries
    await pool.query(`
      DELETE FROM aggregated_parts_to_order 
      WHERE part_number NOT IN (
        SELECT DISTINCT part_number 
        FROM sales_order_parts_to_order sopt
        JOIN salesorderhistory soh ON sopt.sales_order_id = soh.sales_order_id
        WHERE soh.status = 'Open' AND sopt.quantity_needed > 0
      )
    `);

    // Get individual parts to order from sales_order_parts_to_order table
    const individualResult = await pool.query(`
      SELECT 
        sopt.sales_order_id,
        soh.sales_order_number,
        c.customer_name,
        sopt.part_number,
        sopt.part_description,
        sopt.quantity_needed,
        sopt.unit,
        sopt.unit_price,
        sopt.line_amount
      FROM sales_order_parts_to_order sopt
      JOIN salesorderhistory soh ON sopt.sales_order_id = soh.sales_order_id
      JOIN customermaster c ON soh.customer_id = c.customer_id
      WHERE soh.status = 'Open' 
        AND sopt.quantity_needed > 0
      ORDER BY sopt.part_number, soh.created_at
    `);

          // Get stored aggregated parts to order data (only parts with non-zero quantities)
      const aggregatedResult = await pool.query(`
        SELECT 
          part_number,
          part_description,
          total_quantity_needed,
          unit,
          unit_price,
          total_line_amount,
          min_required_quantity as min_required
        FROM aggregated_parts_to_order
        WHERE total_quantity_needed > 0
        ORDER BY part_number
      `);

    // Aggregate the parts to order from individual sales orders (for sales_orders array)
    const aggregated: { [key: string]: any } = {};
    
    individualResult.rows.forEach((item: any) => {
      const quantityNeeded = parseFloat(item.quantity_needed) || 0;
      
      // Skip items with zero quantity
      if (quantityNeeded <= 0) return;
      
      if (!aggregated[item.part_number]) {
        aggregated[item.part_number] = {
          part_number: item.part_number,
          part_description: item.part_description,
          total_quantity_needed: 0,
          unit: item.unit,
          unit_price: item.unit_price,
          total_line_amount: 0,
          min_required: 0,
          sales_orders: []
        };
      }
      
      aggregated[item.part_number].total_quantity_needed += quantityNeeded;
      aggregated[item.part_number].total_line_amount += parseFloat(item.line_amount) || 0;
      aggregated[item.part_number].min_required += quantityNeeded;
      aggregated[item.part_number].sales_orders.push(item);
    });

    // Merge stored aggregated data with individual data
    const aggregatedParts = aggregatedResult.rows.map((storedPart: any) => {
      const individualPart = aggregated[storedPart.part_number];
      return {
        ...storedPart,
        sales_orders: individualPart ? individualPart.sales_orders : []
      };
    });

    // Add any parts that exist in individual data but not in stored data
    Object.keys(aggregated).forEach(partNumber => {
      if (!aggregatedParts.find((p: any) => p.part_number === partNumber)) {
        aggregatedParts.push(aggregated[partNumber]);
      }
    });

    res.json({
      individualParts: individualResult.rows,
      aggregatedParts: aggregatedParts
    });

  } catch (error) {
    console.error('Error getting all parts to order:', error);
    res.status(500).json({ error: 'Failed to get parts to order data' });
  }
});

// Update aggregated parts to order quantity
router.put('/parts-to-order/update-quantity', async (req: Request, res: Response) => {
  try {
    const { part_number, new_quantity } = req.body;

    // Get minimum required quantity from sales_order_parts_to_order table
    const minRequiredResult = await pool.query(`
      SELECT COALESCE(SUM(quantity_needed), 0) as min_required
      FROM sales_order_parts_to_order sopt
      JOIN salesorderhistory soh ON sopt.sales_order_id = soh.sales_order_id
      WHERE sopt.part_number = $1 AND soh.status = 'Open'
    `, [part_number]);

    const minRequired = parseFloat(minRequiredResult.rows[0].min_required);

    if (new_quantity < minRequired) {
      return res.status(400).json({ 
        error: `Quantity cannot be less than minimum required (${minRequired})` 
      });
    }

    // Get part details from inventory to calculate line amount
    const inventoryResult = await pool.query(`
      SELECT part_description, unit, last_unit_cost as unit_price
      FROM inventory 
      WHERE part_number = $1
    `, [part_number]);

    const partDetails = inventoryResult.rows[0] || {};
    const unitPrice = parseFloat(partDetails.unit_price) || 0;
    const totalLineAmount = new_quantity * unitPrice;

    // Handle zero quantity by removing the entry, otherwise update or insert
    if (new_quantity <= 0) {
      // Remove the entry if quantity is zero or negative
      await pool.query(`
        DELETE FROM aggregated_parts_to_order WHERE part_number = $1
      `, [part_number]);
      console.log(`Removed part ${part_number} from aggregated_parts_to_order due to zero quantity`);
    } else {
      // Update or insert aggregated parts to order
      await pool.query(`
        INSERT INTO aggregated_parts_to_order (part_number, part_description, total_quantity_needed, unit, unit_price, total_line_amount, min_required_quantity)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (part_number) 
        DO UPDATE SET 
          total_quantity_needed = $3,
          total_line_amount = $6,
          min_required_quantity = $7,
          updated_at = CURRENT_TIMESTAMP
      `, [part_number, partDetails.part_description || '', new_quantity, partDetails.unit || 'Each', unitPrice, totalLineAmount, minRequired]);
    }

    res.json({ success: true, message: 'Quantity updated successfully' });

  } catch (error) {
    console.error('Error updating parts to order quantity:', error);
    res.status(500).json({ error: 'Failed to update quantity' });
  }
});

// Add new part to aggregated parts to order
router.post('/parts-to-order/add', async (req: Request, res: Response) => {
  try {
    const { part_number, quantity_needed } = req.body;

    // Get part details from inventory
    const inventoryResult = await pool.query(`
      SELECT part_number, part_description, unit, last_unit_cost as unit_price
      FROM inventory 
      WHERE part_number = $1
    `, [part_number]);

    if (inventoryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Part not found in inventory' });
    }

    const part = inventoryResult.rows[0];
    const unitPrice = parseFloat(part.unit_price) || 0;
    const totalLineAmount = quantity_needed * unitPrice;

    // Handle zero quantity by removing the entry, otherwise insert or update
    if (quantity_needed <= 0) {
      // Remove the entry if quantity is zero or negative
      await pool.query(`
        DELETE FROM aggregated_parts_to_order WHERE part_number = $1
      `, [part.part_number]);
      console.log(`Removed part ${part.part_number} from aggregated_parts_to_order due to zero quantity`);
    } else {
      // Check if this part has any associated sales orders before adding to aggregated table
      const salesOrderCheck = await pool.query(`
        SELECT COUNT(*) as count
        FROM sales_order_parts_to_order sopt
        JOIN salesorderhistory soh ON sopt.sales_order_id = soh.sales_order_id
        WHERE sopt.part_number = $1 AND soh.status = 'Open' AND sopt.quantity_needed > 0
      `, [part.part_number]);

      const hasSalesOrders = parseInt(salesOrderCheck.rows[0].count) > 0;
      
      if (!hasSalesOrders) {
        return res.status(400).json({ 
          error: 'Cannot add part to order without associated sales orders',
          message: 'Parts can only be added to the order list if they are associated with open sales orders. Please add this part to a sales order first.'
        });
      }

      // Insert or update aggregated parts to order
      await pool.query(`
        INSERT INTO aggregated_parts_to_order (part_number, part_description, total_quantity_needed, unit, unit_price, total_line_amount, min_required_quantity)
        VALUES ($1, $2, $3, $4, $5, $6, $3)
        ON CONFLICT (part_number) 
        DO UPDATE SET 
          total_quantity_needed = aggregated_parts_to_order.total_quantity_needed + $3,
          total_line_amount = (aggregated_parts_to_order.total_quantity_needed + $3) * $5,
          updated_at = CURRENT_TIMESTAMP
      `, [part.part_number, part.part_description, quantity_needed, part.unit, unitPrice, totalLineAmount]);
    }

    res.json({ success: true, message: 'Part added to order successfully' });

  } catch (error) {
    console.error('Error adding part to order:', error);
    res.status(500).json({ error: 'Failed to add part to order' });
  }
});

// Clear quantity_to_order for a specific part in a sales order (when line item is deleted)
router.delete('/:salesOrderId/parts-to-order/:partNumber', async (req: Request, res: Response) => {
  const { salesOrderId, partNumber } = req.params;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Delete the entry from sales_order_parts_to_order
    await client.query(`
      DELETE FROM sales_order_parts_to_order 
      WHERE sales_order_id = $1 AND part_number = $2
    `, [salesOrderId, partNumber]);
    
    // Recalculate aggregated parts to order for this part
    const remainingQuantityResult = await client.query(`
      SELECT COALESCE(SUM(quantity_needed), 0) as total_needed
      FROM sales_order_parts_to_order sopt
      JOIN salesorderhistory soh ON sopt.sales_order_id = soh.sales_order_id
      WHERE sopt.part_number = $1 AND soh.status = 'Open'
    `, [partNumber]);
    
    const totalNeeded = parseFloat(remainingQuantityResult.rows[0].total_needed);
    
    if (totalNeeded <= 0) {
      // Remove from aggregated table if no more needed
      await client.query(`
        DELETE FROM aggregated_parts_to_order WHERE part_number = $1
      `, [partNumber]);
    } else {
      // Update aggregated table with new total
      const inventoryResult = await client.query(`
        SELECT part_description, unit, last_unit_cost as unit_price
        FROM inventory 
        WHERE part_number = $1
      `, [partNumber]);
      
      const partDetails = inventoryResult.rows[0] || {};
      const unitPrice = parseFloat(partDetails.unit_price) || 0;
      const totalLineAmount = totalNeeded * unitPrice;
      
      await client.query(`
        UPDATE aggregated_parts_to_order 
        SET total_quantity_needed = $1,
            total_line_amount = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE part_number = $3
      `, [totalNeeded, totalLineAmount, partNumber]);
    }
    
    await client.query('COMMIT');
    res.json({ success: true, message: `Cleared quantity_to_order for part ${partNumber} in sales order ${salesOrderId}` });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error clearing quantity_to_order:', error);
    res.status(500).json({ error: 'Failed to clear quantity_to_order' });
  } finally {
    client.release();
  }
});

export default router; 


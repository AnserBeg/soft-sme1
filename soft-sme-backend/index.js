const express = require('express');
const { Pool } = require('pg');
const multer = require('multer'); // Import multer
const path = require('path'); // Import path for file handling
const fs = require('fs'); // Import fs for file system operations
const PDFDocument = require('pdfkit'); // Import pdfkit for PDF generation
const cors = require('cors'); // Import cors
const { authMiddleware, adminAuth } = require('./dist/middleware/authMiddleware');
const { spawn } = require('child_process');
const cookieParser = require('cookie-parser');
const { PurchaseOrderCalculationService } = require('./src/services/purchaseOrderCalculations');
const { SalesOrderService } = require('./dist/services/SalesOrderService');
require('dotenv').config();

const app = express();
const port = Number(process.env.PORT) || 10000;

// Enable compression for better performance
const compression = require('compression');
app.use(compression());

// Set keep-alive headers
app.use((req, res, next) => {
  res.set('Connection', 'keep-alive');
  res.set('Keep-Alive', 'timeout=5, max=1000');
  next();
});

// Enable CORS for all routes
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'https://localhost',
      'https://localhost:3000',
      'file://',
      'null',
      'app://-',
      'https://consequences-composition-uh-counters.trycloudflare.com',
      'https://kinda-broker-railroad-eyes.trycloudflare.com',
      'https://softsme.phoenixtrailers.ca'
    ];
    // Allow requests with no origin (like curl or some Electron requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-device-id'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.use(cookieParser());

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' }); // Temporary directory for uploads

// PostgreSQL connection pool with optimized settings
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_DATABASE || 'soft_sme_db',
  password: process.env.DB_PASSWORD || '123',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  // Connection pool optimization
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
  // Keep connections alive
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Initialize calculation service
const calculationService = new PurchaseOrderCalculationService(pool);

// Initialize sales order service
const salesOrderService = new SalesOrderService(pool);



// Test the database connection
pool.connect((err, client, done) => {
  if (err) {
    console.error('Database connection error', err);
    return;
  }
  console.log('Connected to the database');
  client.release(); // Release the client back to the pool
});

// Middleware to parse JSON requests
app.use(express.json());

// Add authentication middleware for all /api routes except registration
app.use('/api', (req, res, next) => {
  // Skip auth middleware for registration endpoints
  if (req.path === '/auth/register-company' || req.path === '/auth/login') {
    return next();
  }
  authMiddleware(req, res, next);
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve static files from the uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Add this before the routes
app.use('/uploads', express.static('uploads'));

// Add this with other route registrations
const businessProfileRouter = require('./routes/businessProfile').default || require('./routes/businessProfile');
const timeTrackingRouter = require('./routes/timeTracking').default || require('./routes/timeTracking');
const authRoutes = require('./dist/routes/authRoutes').default;
const inventoryRoutes = require('./dist/routes/inventoryRoutes').default;
const employeeRoutes = require('./dist/routes/employeeRoutes').default;
const purchaseOrderRoutes = require('./dist/routes/purchaseOrderRoutes').default;
const salesOrderRoutes = require('./dist/routes/salesOrderRoutes').default;
const quoteRoutes = require('./dist/routes/quoteRoutes').default;
const marginScheduleRoutes = require('./dist/routes/marginScheduleRoutes').default;
const purchaseHistoryRoutes = require('./dist/routes/purchaseHistoryRoutes').default;
const customerRoutes = require('./dist/routes/customerRoutes').default;
const vendorRoutes = require('./dist/routes/vendorRoutes').default;
const productRoutes = require('./dist/routes/productRoutes').default;
const categoryRoutes = require('./dist/routes/categoryRoutes').default;

app.use('/api/business-profile', businessProfileRouter);
app.use('/api/time-tracking', timeTrackingRouter);
app.use('/api/auth', authRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/sales-orders', salesOrderRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/margin-schedule', marginScheduleRoutes);
app.use('/api/purchase-history', purchaseHistoryRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);

// API endpoint to get all employees for a company (Admin Only)
// Note: This route is now handled by modular employeeRoutes

// API endpoint to delete an employee (Admin Only)
// Note: This route is now handled by modular employeeRoutes

// Health check endpoint for connection warmup
app.get('/api/auth/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Render health check route
app.get('/', (_req, res) => res.status(200).send('OK'));

// Database connectivity health check
app.get('/health/db', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM VendorMaster LIMIT 1');
    res.send('SME Inventory Backend is running and connected to the database. VendorMaster table check successful.');
  } catch (err) {
    console.error('Error checking VendorMaster table:', err);
    res.status(500).send('SME Inventory Backend is running but encountered an error checking the database tables. Check backend console for details.');
  }
});

// API endpoint to get all vendors
// Note: This route is now handled by modular vendorRoutes

// API endpoint to add a new vendor
// Note: This route is now handled by modular vendorRoutes

// API endpoint to get all customers
// Note: This route is now handled by modular customerRoutes

// Add API endpoint to delete a purchase order by ID
// Note: This route is now handled by modular purchaseHistoryRoutes

// --- Purchase History GET Routes (Reordered for specificity) ---

// API endpoint to get a specific OPEN purchase order by ID
app.get('/api/purchase-history/open/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const purchaseOrderResult = await pool.query(
      `SELECT 
        ph.*,
        CAST(ph.subtotal AS FLOAT) as subtotal,
        CAST(ph.total_gst_amount AS FLOAT) as total_gst_amount,
        CAST(ph.total_amount AS FLOAT) as total_amount,
        COALESCE(vm.vendor_name, 'No Vendor') as vendor_name 
      FROM PurchaseHistory ph 
      LEFT JOIN VendorMaster vm ON ph.vendor_id = vm.vendor_id 
      WHERE ph.purchase_id = $1 AND LOWER(ph.status) = 'open'`,
      [id]
    );

    if (purchaseOrderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Open purchase order not found' });
    }

    const purchaseOrder = purchaseOrderResult.rows[0];

    const lineItemsResult = await pool.query(
      'SELECT * FROM purchaselineitems WHERE purchase_id = $1',
      [id]
    );

    const fullPurchaseOrder = { ...purchaseOrder, lineItems: lineItemsResult.rows };

    res.json(fullPurchaseOrder);
  } catch (err) {
    console.error(`Error fetching open purchase order ${id}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to get all OPEN purchase order records
app.get('/api/purchase-history/open', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        ph.*,
        CAST(ph.subtotal AS FLOAT) as subtotal,
        CAST(ph.total_gst_amount AS FLOAT) as total_gst_amount,
        CAST(ph.total_amount AS FLOAT) as total_amount,
        COALESCE(vm.vendor_name, 'No Vendor') as vendor_name 
      FROM PurchaseHistory ph 
      LEFT JOIN VendorMaster vm ON ph.vendor_id = vm.vendor_id 
      WHERE LOWER(ph.status) = 'open'
      ORDER BY ph.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching open purchase orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to get a specific purchase order by ID (for both open and closed orders)
app.get('/api/purchase-history/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Fetch the main purchase order details, joining with VendorMaster
    const purchaseOrderResult = await pool.query(
      `SELECT ph.*, ph.subtotal, ph.total_gst_amount, vm.vendor_name 
       FROM PurchaseHistory ph 
       JOIN VendorMaster vm ON ph.vendor_id = vm.vendor_id 
       WHERE ph.purchase_id = $1`,
      [id]
    );

    if (purchaseOrderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }

    const purchaseOrder = purchaseOrderResult.rows[0];

    // Fetch line items for the purchase order
    const lineItemsResult = await pool.query(
      'SELECT * FROM purchaselineitems WHERE purchase_id = $1',
      [id]
    );

    // Combine purchase order details with line items
    const fullPurchaseOrder = { ...purchaseOrder, lineItems: lineItemsResult.rows };

    res.json(fullPurchaseOrder);
  } catch (err) {
    console.error(`Error fetching purchase order ${id}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to generate PDF for a specific purchase order
app.get('/api/purchase-history/:id/pdf', async (req, res) => {
  const { id } = req.params;
  try {
    const purchaseOrderResult = await pool.query(
      `SELECT ph.*, COALESCE(vm.vendor_name, 'No Vendor') as vendor_name, vm.street_address, vm.city, vm.province, vm.country, vm.telephone_number, vm.email FROM PurchaseHistory ph LEFT JOIN VendorMaster vm ON ph.vendor_id = vm.vendor_id WHERE ph.purchase_id = $1`,
      [id]
    );

    if (purchaseOrderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }

    const purchaseOrder = purchaseOrderResult.rows[0];
    console.log('PDF Generation - Fetched Purchase Order Data:', purchaseOrder);

    const lineItemsResult = await pool.query(
      'SELECT * FROM purchaselineitems WHERE purchase_id = $1',
      [id]
    );
    purchaseOrder.lineItems = lineItemsResult.rows;
    console.log('PDF Generation - Fetched Line Items:', purchaseOrder.lineItems);

    const doc = new PDFDocument({ margin: 50 });
    let filename = `Purchase_Order_${purchaseOrder.purchase_number}.pdf`;
    console.log('PDF Generation - Filename:', filename);

    filename = encodeURIComponent(filename);
    res.setHeader('Content-disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-type', 'application/pdf');

    doc.pipe(res);

    console.log('PDF Generation - Adding header text for purchase number:', purchaseOrder.purchase_number);
    doc.fontSize(20).text(`PURCHASE ORDER: ${purchaseOrder.purchase_number}`, { align: 'center' });
    doc.moveDown();

    // Vendor Details
    console.log('PDF Generation - Vendor Details:', purchaseOrder.vendor_name, purchaseOrder.street_address, purchaseOrder.city, purchaseOrder.province, purchaseOrder.country, purchaseOrder.telephone_number, purchaseOrder.email);
    doc.fontSize(12).text(`Vendor: ${purchaseOrder.vendor_name}`);

    if (purchaseOrder.street_address) {
        doc.text(`${purchaseOrder.street_address}`);
    }
    if (purchaseOrder.city) {
        doc.text(`${purchaseOrder.city}`);
    }
    if (purchaseOrder.province) {
        doc.text(`${purchaseOrder.province}`);
    }
    if (purchaseOrder.country) {
        doc.text(`${purchaseOrder.country}`);
    }
    if (purchaseOrder.telephone_number) {
        doc.text(`Phone: ${purchaseOrder.telephone_number}`);
    }
    if (purchaseOrder.email) {
        doc.text(`Email: ${purchaseOrder.email}`);
    }
    doc.moveDown();

    // PO Details
    console.log('PDF Generation - PO Details:', purchaseOrder.created_at, purchaseOrder.bill_number, purchaseOrder.status);
    if (purchaseOrder.created_at) {
      doc.text(`Created Date: ${new Date(purchaseOrder.created_at).toLocaleDateString()}`);
    }
    if (purchaseOrder.bill_number) {
        doc.text(`Bill Number: ${purchaseOrder.bill_number}`);
    }
    doc.text(`Status: ${purchaseOrder.status}`);
    doc.moveDown();

    // Line Items Table
    const tableHeaders = ['Part Number', 'Description', 'Qty', 'Unit', 'Unit Cost', 'Line Amount'];
    const tableTop = doc.y + 10;
    const colWidths = [120, 200, 50, 50, 80, 80]; // Increased description width from 150 to 200
    const minRowHeight = 20;
    let currentX = doc.page.margins.left;

    // Draw Headers
    doc.font('Helvetica-Bold');
    tableHeaders.forEach((header, i) => {
        doc.text(header, currentX, tableTop, { width: colWidths[i], align: 'left' });
        currentX += colWidths[i];
    });
    doc.font('Helvetica');
    doc.moveTo(doc.page.margins.left, tableTop + minRowHeight - 5)
       .lineTo(doc.page.width - doc.page.margins.right, tableTop + minRowHeight - 5)
       .stroke();

    // Draw Rows with dynamic height
    let y = tableTop + minRowHeight;
    purchaseOrder.lineItems.forEach(item => {
        console.log('PDF Generation - Line Item Data:', item);
        
        // Calculate required height for this row based on text content
        const partNumberLines = doc.heightOfString(item.part_number || '', { width: colWidths[0] });
        const descriptionLines = doc.heightOfString(item.part_description || '', { width: colWidths[1] });
        const maxTextHeight = Math.max(partNumberLines, descriptionLines, minRowHeight);
        const rowHeight = Math.max(maxTextHeight + 10, minRowHeight); // Add padding
        
        // Check if we need a new page
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
            y = doc.page.margins.top;
        }
        
        currentX = doc.page.margins.left;
        
        // Part Number (with wrapping)
        doc.text(item.part_number || '', currentX, y, { 
            width: colWidths[0], 
            align: 'left',
            height: rowHeight,
            valign: 'top'
        });
        currentX += colWidths[0];
        
        // Description (with wrapping)
        doc.text(item.part_description || '', currentX, y, { 
            width: colWidths[1], 
            align: 'left',
            height: rowHeight,
            valign: 'top'
        });
        currentX += colWidths[1];
        
        // Quantity
        doc.text(parseFloat(item.quantity).toString(), currentX, y, { 
            width: colWidths[2], 
            align: 'left',
            height: rowHeight,
            valign: 'top'
        });
        currentX += colWidths[2];
        
        // Unit
        doc.text(item.unit || '', currentX, y, { 
            width: colWidths[3], 
            align: 'left',
            height: rowHeight,
            valign: 'top'
        });
        currentX += colWidths[3];
        
        // Unit Cost
        doc.text(parseFloat(item.unit_cost).toFixed(2), currentX, y, { 
            width: colWidths[4], 
            align: 'right',
            height: rowHeight,
            valign: 'top'
        });
        currentX += colWidths[4];
        
        // Line Amount
        doc.text(parseFloat(item.line_amount).toFixed(2), currentX, y, { 
            width: colWidths[5], 
            align: 'right',
            height: rowHeight,
            valign: 'top'
        });
        
        y += rowHeight;
    });

    // Totals
    console.log('PDF Generation - Totals Data:', purchaseOrder.subtotal, purchaseOrder.total_gst_amount, purchaseOrder.total_amount);
    doc.moveDown();
    doc.text('Subtotal:', doc.page.width - doc.page.margins.right - 150, doc.y, { align: 'right', width: 100 });
    doc.text(parseFloat(purchaseOrder.subtotal).toFixed(2), doc.page.width - doc.page.margins.right - 50, doc.y, { align: 'right', width: 50 });
    doc.text('Total GST:', doc.page.width - doc.page.margins.right - 150, doc.y, { align: 'right', width: 100 });
    doc.text(parseFloat(purchaseOrder.total_gst_amount).toFixed(2), doc.page.width - doc.page.margins.right - 50, doc.y, { align: 'right', width: 50 });
    doc.fontSize(14).text('Total Amount:', doc.page.width - doc.page.margins.right - 150, doc.y, { align: 'right', width: 100 });
    doc.text(parseFloat(purchaseOrder.total_amount).toFixed(2), doc.page.width - doc.page.margins.right - 50, doc.y, { align: 'right', width: 50 });

    doc.end();

  } catch (err) {
    console.error(`Error generating PDF for purchase order ${id}:`, err);
    res.status(500).json({ error: 'Internal server error during PDF generation' });
  }
});

// API endpoint to get all purchase history records (CLOSED orders)
app.get('/api/purchase-history', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        ph.*,
        CAST(ph.subtotal AS FLOAT) as subtotal,
        CAST(ph.total_gst_amount AS FLOAT) as total_gst_amount,
        CAST(ph.total_amount AS FLOAT) as total_amount,
        COALESCE(vm.vendor_name, 'No Vendor') as vendor_name 
      FROM PurchaseHistory ph 
      LEFT JOIN VendorMaster vm ON ph.vendor_id = vm.vendor_id 
      WHERE LOWER(ph.status) = 'closed'
      ORDER BY ph.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching purchase history:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to create a new purchase order
app.post('/api/purchase-history', async (req, res) => {
  const client = await pool.connect();
  try {
    // Expecting vendor_id, bill_number, total_amount, lineItems, globalGstRate
    const { vendor_id, bill_number, total_amount, lineItems, globalGstRate } = req.body;

    console.log('Received purchase order data:', req.body);

    // Trim string fields
    const trimmedBillNumber = bill_number ? bill_number.trim() : '';
    const trimmedLineItems = lineItems.map(item => ({
      ...item,
      part_number: item.part_number ? item.part_number.trim() : '',
      part_description: item.part_description ? item.part_description.trim() : '',
      unit: item.unit ? item.unit.trim() : ''
    }));

    // Validate vendor_id
    if (!vendor_id) {
      return res.status(400).json({ error: 'Vendor ID is required' });
    }

    // Verify vendor exists
    const vendorCheck = await client.query('SELECT vendor_id FROM VendorMaster WHERE vendor_id = $1', [vendor_id]);
    if (vendorCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid vendor ID' });
    }

    // Check for duplicate bill number if bill number is provided
    if (bill_number && bill_number.trim()) {
      const duplicateCheck = await client.query(
        'SELECT COUNT(*) as count FROM PurchaseHistory WHERE bill_number = $1',
        [bill_number.trim()]
      );
      const count = parseInt(duplicateCheck.rows[0].count);
      if (count > 0) {
        return res.status(409).json({ 
          error: 'Duplicate bill number',
          message: `Bill number "${bill_number}" already exists in another purchase order.`
        });
      }
    }

    // Start a transaction
    await client.query('BEGIN');

    // Calculate subtotal and total GST amount from line items
    let calculatedSubTotal = 0;

    // Before inserting, calculate the pre-GST line amount and aggregate subtotal
    const processedLineItems = lineItems.map(item => {
      const quantity = parseFloat(String(item.quantity)) || 0;
      const unitCost = parseFloat(String(item.unit_cost)) || 0;

      const lineAmountPreGST = quantity * unitCost;
      calculatedSubTotal += lineAmountPreGST;

      return {
        ...item,
        line_amount: lineAmountPreGST, // Store pre-GST amount
      };
    });

    // Calculate total GST amount using the global GST rate
    const gstRateNum = parseFloat(globalGstRate) || 0;
    const calculatedTotalGSTAmount = calculatedSubTotal * (gstRateNum / 100);

    // Generate sequential purchase number (YYYY-######)
    const currentYear = new Date().getFullYear();
    const yearPrefix = `${currentYear}-`;

    // Find the highest sequential number for the current year
    const lastPurchaseNumberQuery = await client.query(
      'SELECT purchase_number FROM PurchaseHistory WHERE purchase_number LIKE $1 ORDER BY purchase_number DESC LIMIT 1',
      [yearPrefix + '%']
    );

    let nextSequence = 1;
    if (lastPurchaseNumberQuery.rows.length > 0) {
      const lastPurchaseNumber = lastPurchaseNumberQuery.rows[0].purchase_number;
      const lastSequenceStr = lastPurchaseNumber.substring(yearPrefix.length);
      const lastSequence = parseInt(lastSequenceStr, 10);
      if (!isNaN(lastSequence)) {
        nextSequence = lastSequence + 1;
      }
    }

    const generatedPurchaseNumber = `${yearPrefix}${nextSequence.toString().padStart(6, '0')}`;

    // Ensure numeric values are not NaN before inserting
    const finalSubTotal = isNaN(calculatedSubTotal) ? 0 : calculatedSubTotal;
    const finalTotalGSTAmount = isNaN(calculatedTotalGSTAmount) ? 0 : calculatedTotalGSTAmount;
    const finalTotalAmount = finalSubTotal + finalTotalGSTAmount;

    // Insert into PurchaseHistory
    const purchaseHistoryResult = await client.query(
      'INSERT INTO PurchaseHistory (vendor_id, bill_number, purchase_number, subtotal, total_gst_amount, total_amount, status, global_gst_rate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING purchase_id, purchase_number, global_gst_rate, vendor_id',
      [vendor_id, trimmedBillNumber, generatedPurchaseNumber, finalSubTotal, finalTotalGSTAmount, finalTotalAmount, 'Open', globalGstRate]
    );
    const newPurchaseOrderId = purchaseHistoryResult.rows[0].purchase_id;
    const returnedPurchaseNumber = purchaseHistoryResult.rows[0].purchase_number;
    const returnedGlobalGstRate = purchaseHistoryResult.rows[0].global_gst_rate;
    const returnedVendorId = purchaseHistoryResult.rows[0].vendor_id;
    console.log('PurchaseHistory record inserted with ID:', newPurchaseOrderId, 'and Purchase Number:', returnedPurchaseNumber);

    // Insert line items (skip zero quantities)
    for (const item of processedLineItems) {
      if (!item.part_number) {
        console.warn('Skipping line item due to missing part number:', item);
        continue;
      }
      
      // Skip items with zero or negative quantity
      const quantity = parseFloat(String(item.quantity)) || 0;
      if (quantity <= 0) {
        console.log(`Skipping zero quantity line item: ${item.part_number}`);
        continue;
      }
      
      // Find the corresponding trimmed line item
      const trimmedItem = trimmedLineItems.find(ti => ti.part_number === item.part_number);
      
      await client.query(
        'INSERT INTO purchaselineitems (purchase_id, part_number, part_description, quantity, unit, unit_cost, line_amount) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [newPurchaseOrderId, trimmedItem.part_number, trimmedItem.part_description, item.quantity, trimmedItem.unit, item.unit_cost, item.line_amount]
      );
      console.log('Line item inserted for purchase order:', item.part_number);
    }

    // Recalculate and update purchase order totals after creation
    console.log(`Recalculating totals for new PO ${newPurchaseOrderId}...`);
    try {
      const updatedTotals = await calculationService.recalculateAndUpdateTotals(newPurchaseOrderId, client);
      console.log(`✅ Updated totals for new PO ${newPurchaseOrderId}:`, updatedTotals);
    } catch (calcError) {
      console.error(`❌ Error recalculating totals for new PO ${newPurchaseOrderId}:`, calcError);
      // Don't fail the entire operation, but log the error
    }

    await client.query('COMMIT');

    // Get vendor name
    const vendorResult = await client.query(
      'SELECT vendor_name FROM VendorMaster WHERE vendor_id = $1',
      [returnedVendorId]
    );
    const vendorName = vendorResult.rows[0]?.vendor_name || '';

    // Get line items
    const purchaseLineItems = await client.query(
      'SELECT * FROM purchaselineitems WHERE purchase_id = $1',
      [newPurchaseOrderId]
    );

    const responseData = {
      purchase_id: newPurchaseOrderId,
      purchase_number: returnedPurchaseNumber,
      vendor_id: returnedVendorId,
      vendor_name: vendorName,
      bill_number: bill_number,
      subtotal: finalSubTotal,
      total_gst_amount: finalTotalGSTAmount,
      total_amount: finalTotalAmount,
      status: 'Open',
      global_gst_rate: returnedGlobalGstRate,
      lineItems: purchaseLineItems.rows
    };

    console.log('Sending response data:', responseData);
    res.status(201).json(responseData);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating purchase order:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// API endpoint to update a purchase order by ID (for open purchase orders)
app.put('/api/purchase-history/:id', async (req, res) => {
  console.log('PUT /api/purchase-history/:id called with params:', req.params, 'and body:', req.body);
  const { id } = req.params;
  const client = await pool.connect();
  try {
    const { vendor_id, bill_number, total_amount, lineItems, status: newStatus, globalGstRate, global_gst_rate } = req.body;

    console.log('Backend received PUT request for PO ID:', id, 'with body:', req.body);

    // Trim string fields
    const trimmedBillNumber = bill_number ? bill_number.trim() : '';
    const trimmedLineItems = lineItems.map(item => ({
      ...item,
      part_number: item.part_number ? item.part_number.trim() : '',
      part_description: item.part_description ? item.part_description.trim() : '',
      unit: item.unit ? item.unit.trim() : ''
    }));

    // Fetch the current status and line items of the PO from the database
    const currentPoResult = await client.query(
      `SELECT status FROM PurchaseHistory WHERE purchase_id = $1`,
      [id]
    );

    if (currentPoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase order not found.' });
    }
    const oldStatus = currentPoResult.rows[0].status;

    let existingLineItemsInDb = [];
    if (oldStatus === 'Closed') {
      const existingLineItemsResult = await client.query(
        'SELECT part_number, quantity FROM purchaselineitems WHERE purchase_id = $1',
        [id]
      );
      existingLineItemsInDb = existingLineItemsResult.rows;
    }

    // Validation: If status is being set to 'Closed', bill_number is mandatory
    if (newStatus === 'Closed' && (!bill_number || bill_number.trim() === '')) {
      return res.status(400).json({ error: 'Bill number is required to close a purchase order.' });
    }

    // Check for duplicate bill number if bill number is provided (excluding current purchase order)
    if (bill_number && bill_number.trim()) {
      const duplicateCheck = await client.query(
        'SELECT COUNT(*) as count FROM PurchaseHistory WHERE bill_number = $1 AND purchase_id != $2',
        [bill_number.trim(), id]
      );
      const count = parseInt(duplicateCheck.rows[0].count);
      if (count > 0) {
        return res.status(409).json({ 
          error: 'Duplicate bill number',
          message: `Bill number "${bill_number}" already exists in another purchase order.`
        });
      }
    }

    await client.query('BEGIN');

    // Calculate subtotal and total GST amount from line items for update
    let calculatedSubTotal = 0;

    // Before updating, calculate the pre-GST line amount and aggregate subtotal
    const processedLineItems = lineItems.map(item => {
      const quantity = parseFloat(String(item.quantity)) || 0;
      const unitCost = parseFloat(String(item.unit_cost)) || 0;

      const lineAmountPreGST = quantity * unitCost;
      calculatedSubTotal += lineAmountPreGST;

      return {
        ...item,
        line_amount: lineAmountPreGST, // Store pre-GST amount
      };
    });

    // Calculate total GST amount using the global GST rate
    const gstRateNum = parseFloat(globalGstRate ?? global_gst_rate) || 0;
    const calculatedTotalGSTAmount = calculatedSubTotal * (gstRateNum / 100);

    console.log('Backend Calculated SubTotal:', calculatedSubTotal);
    console.log('Backend Calculated Total GST Amount:', calculatedTotalGSTAmount);
    console.log('Backend Calculated Total Amount:', calculatedSubTotal + calculatedTotalGSTAmount);

    // --- Inventory Adjustment Logic based on Status Change ---
    if (newStatus === 'Closed' && oldStatus === 'Open') {
      console.log('PO transitioning from Open to Closed. Adding quantities to inventory and updating last_unit_cost.');
      for (const item of processedLineItems) {
        if (!item.part_number) continue;
        
        const unitCost = parseFloat(String(item.unit_cost)) || 0;
        const quantity = parseFloat(String(item.quantity)) || 0;
        
        // Always update both quantity and last_unit_cost for existing parts
        // For new parts, insert with the new unit cost
        await client.query(
          `INSERT INTO Inventory (part_number, part_description, unit, last_unit_cost, quantity_on_hand, part_type) 
           VALUES ($1, $2, $3, $4, $5, $6) 
           ON CONFLICT (part_number) 
           DO UPDATE SET 
             quantity_on_hand = Inventory.quantity_on_hand + EXCLUDED.quantity_on_hand,
             last_unit_cost = EXCLUDED.last_unit_cost,
             part_description = EXCLUDED.part_description,
             unit = EXCLUDED.unit`,
          [item.part_number, item.part_description, item.unit, unitCost, quantity, 'stock']
        );
        console.log(`Updated inventory for ${item.part_number}: added ${quantity} units, set last_unit_cost to ${unitCost}`);
      }
    }

    // Update last_unit_cost in inventory for all line items when PO is saved (regardless of status)
    // This ensures that cost changes are reflected immediately
    console.log('Updating last_unit_cost in inventory for all line items.');
    for (const item of processedLineItems) {
      if (!item.part_number) continue;
      
      const unitCost = parseFloat(String(item.unit_cost)) || 0;
      
      // Update the last_unit_cost for existing parts in inventory
      const updateResult = await client.query(
        'UPDATE Inventory SET last_unit_cost = $1 WHERE part_number = $2',
        [unitCost, item.part_number]
      );
      
      if (updateResult.rowCount > 0) {
        console.log(`Updated last_unit_cost for ${item.part_number} to ${unitCost}`);
      } else {
        console.log(`Part ${item.part_number} not found in inventory, skipping last_unit_cost update`);
      }
    }

    // Subtract inventory when reopening a PO
    if (newStatus === 'Open' && oldStatus === 'Closed') {
      console.log('PO transitioning from Closed to Open. Subtracting quantities from inventory.');
      for (const item of processedLineItems) {
        if (!item.part_number) continue;

        // Check current inventory before subtracting
        const invRes = await client.query(
          'SELECT quantity_on_hand FROM Inventory WHERE part_number = $1',
          [item.part_number]
        );
        const currentQty = invRes.rows[0]?.quantity_on_hand ?? 0;
        const subtractQty = parseFloat(String(item.quantity)) || 0;
        if (currentQty - subtractQty < 0) {
          await client.query('ROLLBACK');
          console.error('Negative inventory error for part:', item);
          return res.status(400).json({
            error: 'Inventory cannot be negative',
            message: `Cannot reopen PO. Reopening would result in negative inventory for part: ${item.part_number || '[unknown part]'}`,
            part_number: item.part_number || null
          });
        }

        // Proceed with subtraction
        const result = await client.query(
          'UPDATE Inventory SET quantity_on_hand = quantity_on_hand - $1 WHERE part_number = $2 RETURNING *',
          [subtractQty, item.part_number]
        );
        console.log(`Tried to subtract ${item.quantity} of ${item.part_number} from inventory. Rows affected: ${result.rowCount}`);
        if (result.rows.length > 0) {
          console.log('Updated inventory row:', result.rows[0]);
        } else {
          console.log('No inventory row updated for part_number:', item.part_number);
        }
      }
    }

    // Ensure numeric values are not NaN before updating
    const finalSubTotalUpdate = isNaN(calculatedSubTotal) ? 0 : calculatedSubTotal;
    const finalTotalGSTAmountUpdate = isNaN(calculatedTotalGSTAmount) ? 0 : calculatedTotalGSTAmount;
    const finalTotalAmountUpdate = finalSubTotalUpdate + finalTotalGSTAmountUpdate;

    // Update PurchaseHistory main record
    console.log('Updating PurchaseHistory with:', {
      vendor_id,
      bill_number,
      calculatedSubTotal: finalSubTotalUpdate,
      calculatedTotalGSTAmount: finalTotalGSTAmountUpdate,
      total_amount_used_in_db: finalTotalAmountUpdate,
      status: newStatus,
      purchase_id: id
    });
    await client.query(
      'UPDATE PurchaseHistory SET vendor_id = $1, bill_number = $2, subtotal = $3, total_gst_amount = $4, total_amount = $5, status = $6 WHERE purchase_id = $7',
      [vendor_id, trimmedBillNumber, finalSubTotalUpdate, finalTotalGSTAmountUpdate, finalTotalAmountUpdate, newStatus, id]
    );
    console.log('PurchaseHistory main record updated.');

    // Delete old line items and insert new ones
    await client.query('DELETE FROM purchaselineitems WHERE purchase_id = $1', [id]);
    console.log('Old PurchaseLineItems deleted.');

    for (const item of processedLineItems) {
      if (!item.part_number) {
        console.warn('Skipping PurchaseLineItems insert for line item due to missing part number:', item);
        continue;
      }
      
      // Skip items with zero or negative quantity
      const quantity = parseFloat(String(item.quantity)) || 0;
      if (quantity <= 0) {
        console.log(`Skipping zero quantity line item: ${item.part_number}`);
        continue;
      }
      
      // Find the corresponding trimmed line item
      const trimmedItem = trimmedLineItems.find(ti => ti.part_number === item.part_number);
      
      await client.query(
        'INSERT INTO purchaselineitems (purchase_id, part_number, part_description, quantity, unit, unit_cost, line_amount) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, trimmedItem.part_number, trimmedItem.part_description, item.quantity, trimmedItem.unit, item.unit_cost, item.line_amount]
      );
      console.log('PurchaseLineItem inserted:', item.part_number);
    }

    // Recalculate and update purchase order totals after update
    console.log(`Recalculating totals for PO ${id} after update...`);
    try {
      const updatedTotals = await calculationService.recalculateAndUpdateTotals(parseInt(id), client);
      console.log(`✅ Updated totals for PO ${id}:`, updatedTotals);
    } catch (calcError) {
      console.error(`❌ Error recalculating totals for PO ${id}:`, calcError);
      // Don't fail the entire operation, but log the error
    }

    await client.query('COMMIT');
    console.log('Successfully finished PO update');
    res.json({ message: 'Purchase order updated successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating purchase order:', err, err?.stack);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
    console.log('Client released');
  }
});

// API endpoint to get a specific OPEN sales order by ID
app.get('/api/sales-order-history/open/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const salesOrderResult = await pool.query(
      `SELECT soh.*, cm.customer_name FROM SalesOrderHistory soh JOIN CustomerMaster cm ON soh.customer_id = cm.customer_id WHERE soh.sales_order_id = $1 AND soh.status = 'Open'`,
      [id]
    );

    if (salesOrderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Open sales order not found' });
    }

    const salesOrder = salesOrderResult.rows[0];

    const lineItemsResult = await pool.query(
      'SELECT * FROM SalesOrderLineItems WHERE sales_order_id = $1',
      [id]
    );

    const fullSalesOrder = { ...salesOrder, lineItems: lineItemsResult.rows };

    res.json(fullSalesOrder);
  } catch (err) {
    console.error(`Error fetching open sales order ${id}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to get all OPEN sales order records
app.get('/api/sales-order-history/open', async (req, res) => {
  try {
    const result = await pool.query(`SELECT 
      soh.*, 
      cm.customer_name,
      soh.product_name, 
      soh.product_description
    FROM SalesOrderHistory soh 
    JOIN CustomerMaster cm ON soh.customer_id = cm.customer_id 
    WHERE soh.status = 'Open' ORDER BY soh.created_at DESC`);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching open sales orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to get a specific sales order by ID (now for CLOSED orders)
app.get('/api/sales-order-history/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Fetch the main sales order details, joining with CustomerMaster
    const salesOrderResult = await pool.query(
      `SELECT soh.*, cm.customer_name FROM SalesOrderHistory soh JOIN CustomerMaster cm ON soh.customer_id = cm.customer_id WHERE soh.sales_order_id = $1 AND soh.status = 'Closed'`,
      [id]
    );

    if (salesOrderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Sales order not found (closed)' });
    }

    const salesOrder = salesOrderResult.rows[0];

    const lineItemsResult = await pool.query(
      'SELECT * FROM SalesOrderLineItems WHERE sales_order_id = $1',
      [id]
    );

    const fullSalesOrder = { ...salesOrder, lineItems: lineItemsResult.rows };

    res.json(fullSalesOrder);
  } catch (err) {
    console.error(`Error fetching sales order (closed) ${id}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to get all sales order history records (now for CLOSED orders)
app.get('/api/sales-order-history', async (req, res) => {
  try {
    const { productId } = req.query;
    let query = `
      SELECT
        soh.*,
        cm.customer_name
      FROM SalesOrderHistory soh
      JOIN CustomerMaster cm ON soh.customer_id = cm.customer_id
      WHERE soh.status = 'Closed'
    `;
    const queryParams = [];
    let paramIndex = 1;

    query += ' ORDER BY soh.created_at DESC';

    const result = await pool.query(query, queryParams);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching sales order history (closed):', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to create a new sales order
app.post('/api/sales-order-history', async (req, res) => {
  const client = await pool.connect();
  try {
    console.log('Incoming sales order POST request:', req.body);
    await client.query('BEGIN');

    const {
      customer_id,
      sales_date,
      product_name, // Top-level product name
      product_description, // Top-level product description
      subtotal,
      totalGSTAmount,
      totalAmount,
      lineItems,
      status
    } = req.body;

    // Only require sales_date and lineItems if status is 'Closed'
    if (!customer_id || !sales_date || !product_name || !product_description) {
      return res.status(400).json({ error: 'Missing required sales order fields.' });
    }
    if (status === 'Closed') {
      if (!sales_date) {
        return res.status(400).json({ error: 'Sales date is required to close a sales order.' });
      }
      if (!lineItems || lineItems.length === 0) {
        return res.status(400).json({ error: 'At least one line item is required to close a sales order.' });
      }
    }

    // Check if enough quantity on hand for each line item before insertion (only if lineItems present)
    if (lineItems && lineItems.length > 0) {
      for (const item of lineItems) {
        if (!item.part_number) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Part Number is required for all line items.' });
        }
        const inventoryResult = await client.query('SELECT quantity_on_hand FROM inventory WHERE part_number = $1;', [item.part_number]);
        if (inventoryResult.rows.length === 0 || inventoryResult.rows[0].quantity_on_hand < item.quantity_sold) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Insufficient quantity on hand for part number: ${item.part_number}` });
        }
      }
    }

    // Generate sequential sales order number (YYYY-XXXXX)
    const currentYear = new Date().getFullYear();
    const yearPrefix = `${currentYear}-`;
    const lastSalesOrderNumberQuery = await client.query(
      'SELECT sales_order_number FROM salesorderhistory WHERE sales_order_number LIKE $1 ORDER BY sales_order_number DESC LIMIT 1',
      [yearPrefix + '%']
    );
    let nextSalesOrderSequence = 1;
    if (lastSalesOrderNumberQuery.rows.length > 0) {
      const lastSalesOrderNumber = lastSalesOrderNumberQuery.rows[0].sales_order_number;
      const lastSequenceStr = lastSalesOrderNumber.substring(yearPrefix.length);
      const lastSequence = parseInt(lastSequenceStr, 10);
      if (!isNaN(lastSequence)) {
        nextSalesOrderSequence = lastSequence + 1;
      }
    }
    const generatedSalesOrderNumber = `${yearPrefix}${nextSalesOrderSequence.toString().padStart(5, '0')}`;

    // Calculate subtotal, GST, and total if not provided
    let calcSubtotal = 0;
    if (lineItems && lineItems.length > 0) {
      calcSubtotal = lineItems.reduce((sum, item) => sum + Number(item.line_amount || 0), 0);
    }
    const GST_RATE = 0.05; // Adjust if needed
    const calcGST = calcSubtotal * GST_RATE;
    const calcTotal = calcSubtotal + calcGST;

    const finalSubtotal = subtotal !== undefined && subtotal !== null ? subtotal : calcSubtotal;
    const finalGST = totalGSTAmount !== undefined && totalGSTAmount !== null ? totalGSTAmount : calcGST;
    const finalTotal = totalAmount !== undefined && totalAmount !== null ? totalAmount : calcTotal;


    const salesOrderResult = await client.query(
      `INSERT INTO salesorderhistory (
        sales_order_number, customer_id, sales_date, product_name, product_description,
        subtotal, total_gst_amount, total_amount, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING sales_order_id;`,
      [
        generatedSalesOrderNumber,
        customer_id, sales_date || null, product_name, product_description,
        finalSubtotal, finalGST, finalTotal, status
      ]
    );
    const salesOrderId = salesOrderResult.rows[0].sales_order_id;

    if (lineItems && lineItems.length > 0) {
      for (const item of lineItems) {
        await client.query(
          `INSERT INTO salesorderlineitems (
            sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount
          ) VALUES ($1, $2, $3, $4, $5, $6, $7);`,
          [
            salesOrderId, item.part_number, item.part_description, item.quantity_sold,
            item.unit, item.unit_price, item.line_amount
          ]
        );

        // Decrease quantity_on_hand in inventory for each sold item
        await client.query(
          'UPDATE inventory SET quantity_on_hand = quantity_on_hand - $1 WHERE part_number = $2;',
          [item.quantity_sold, item.part_number]
        );
      }
    }

    // Recalculate and update sales order totals after creation
    console.log(`Recalculating totals for new sales order ${salesOrderId}...`);
    try {
      await salesOrderService.recalculateAndUpdateSummary(salesOrderId, client);
      console.log(`✅ Updated totals for new sales order ${salesOrderId}`);
    } catch (calcError) {
      console.error(`❌ Error recalculating totals for sales order ${salesOrderId}:`, calcError);
      // Don't fail the entire operation, but log the error
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Sales Order created successfully', sales_order_id: salesOrderId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating sales order:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// API endpoint to update a sales order by ID (for open sales orders)
app.put('/api/sales-order-history/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    console.log('Incoming sales order PUT request:', req.body);
    await client.query('BEGIN');

    const {
      customer_id,
      sales_date,
      product_name, // Top-level product name
      product_description, // Top-level product description
      subtotal,
      totalGSTAmount,
      totalAmount,
      lineItems,
      status
    } = req.body;

    // Only require sales_date and lineItems if status is 'Closed'
    if (!customer_id || !sales_date || !product_name || !product_description) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Missing required sales order fields.' });
    }
    if (status === 'Closed') {
      if (!sales_date) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Sales date is required to close a sales order.' });
      }
      if (!lineItems || lineItems.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'At least one line item is required to close a sales order.' });
      }
    }

    // Fetch old line items to calculate quantity changes for inventory adjustment
    const oldLineItemsResult = await client.query(
      'SELECT part_number, quantity_sold FROM salesorderlineitems WHERE sales_order_id = $1;',
      [id]
    );
    const oldLineItemsMap = new Map();
    oldLineItemsResult.rows.forEach(item => {
      oldLineItemsMap.set(item.part_number, item.quantity_sold);
    });

    // Return inventory for removed line items
    const newPartNumbers = new Set(lineItems.map(item => item.part_number));
    for (const [oldPartNumber, oldQty] of oldLineItemsMap.entries()) {
      if (!newPartNumbers.has(oldPartNumber)) {
        // This part was removed, so return its quantity to inventory
        await client.query(
          'UPDATE inventory SET quantity_on_hand = quantity_on_hand + $1 WHERE part_number = $2;',
          [oldQty, oldPartNumber]
        );
      }
    }

    // Update sales order header (totals will be recalculated after line items are updated)
    const salesOrderResult = await client.query(
      `UPDATE salesorderhistory SET
        customer_id = $1, sales_date = $2, product_name = $3, product_description = $4, status = $5
      WHERE sales_order_id = $6 RETURNING *;`,
      [
        customer_id, sales_date || null, product_name, product_description, status, id
      ]
    );

    if (salesOrderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Sales Order not found' });
    }

    // Delete old line items and add new ones for simplicity in update
    await client.query('DELETE FROM salesorderlineitems WHERE sales_order_id = $1;', [id]);

    if (lineItems && lineItems.length > 0) {
      for (const item of lineItems) {
        await client.query(
          `INSERT INTO salesorderlineitems (
            sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount
          ) VALUES ($1, $2, $3, $4, $5, $6, $7);`,
          [
            id, item.part_number, item.part_description, item.quantity_sold,
            item.unit, item.unit_price, item.line_amount
          ]
        );

        // Adjust inventory based on the net change
        const oldQuantity = oldLineItemsMap.get(item.part_number) || 0;
        const quantityChange = item.quantity_sold - oldQuantity;

        if (quantityChange !== 0) {
          await client.query(
            'UPDATE inventory SET quantity_on_hand = quantity_on_hand - $1 WHERE part_number = $2;',
            [quantityChange, item.part_number]
          );
        }
      }
    }

    // Recalculate and update sales order totals after update
    console.log(`Recalculating totals for sales order ${id} after update...`);
    try {
      await salesOrderService.recalculateAndUpdateSummary(parseInt(id), client);
      console.log(`✅ Updated totals for sales order ${id}`);
    } catch (calcError) {
      console.error(`❌ Error recalculating totals for sales order ${id}:`, calcError);
      // Don't fail the entire operation, but log the error
    }

    await client.query('COMMIT');
    res.status(200).json({ message: 'Sales Order updated successfully', salesOrder: salesOrderResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating sales order:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// API endpoint to get all inventory records
app.get('/api/inventory', async (req, res) => {
  try {
    const { partType } = req.query;
    let query = 'SELECT * FROM Inventory';
    let params = [];

    // Add part_type filter if provided
    if (partType && (partType === 'stock' || partType === 'supply')) {
      query += ' WHERE part_type = $1';
      params.push(partType);
    }

    query += ' ORDER BY part_number ASC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching inventory:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to add a new inventory item
app.post('/api/inventory', async (req, res) => {
  const client = await pool.connect();
  try {
    // Expect partNumber, partDescription, unit, lastUnitCost, quantityOnHand, partType
    const { partNumber, partDescription, unit, lastUnitCost, quantityOnHand, partType } = req.body;

    console.log('Received new inventory item data:', { partNumber, partDescription, unit, lastUnitCost, quantityOnHand, partType });

    // Validate part_type
    if (!partType || !['stock', 'supply'].includes(partType)) {
      return res.status(400).json({ error: 'Part type must be either "stock" or "supply"' });
    }

    const result = await client.query(
      'INSERT INTO Inventory (part_number, part_description, unit, last_unit_cost, quantity_on_hand, part_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *'
      , [partNumber, partDescription, unit, lastUnitCost, quantityOnHand, partType]
    );

    const newItem = result.rows[0];

    res.status(201).json({ message: 'Inventory item created successfully', item: newItem });

  } catch (err) {
    console.error('Error creating inventory item:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Inventory update endpoint is now handled by modular inventoryRoutes
/*
app.put('/api/inventory/:partNumber', async (req, res) => {
  const { partNumber } = req.params;
  // Expecting quantityOnHand, reorderPoint, lastUnitCost, part_number, category, etc.
  const { quantityOnHand, reorderPoint, lastUnitCost, part_number, category, part_description, unit } = req.body;
  
  console.log('🔍 PUT /api/inventory/:partNumber called');
  console.log('📋 URL param partNumber:', partNumber);
  console.log('📋 Request body:', req.body);
  console.log('📋 part_number from body:', part_number);
  console.log('📋 part_number !== partNumber:', part_number !== partNumber);

  const client = await pool.connect();

  try {
    // Check if part_number is being changed
    if (part_number && part_number !== partNumber) {
      console.log(`Part number change detected: ${partNumber} -> ${part_number}`);
      
      // Use the update_part_number function to handle all related updates
      const updateResult = await client.query('SELECT update_part_number($1, $2)', [partNumber, part_number]);
      
      if (!updateResult.rows[0].update_part_number) {
        return res.status(400).json({ error: 'Failed to update part number' });
      }
      
      // Now update other fields if provided
      const additionalUpdateFields = [];
      const additionalQueryParams = [];
      let paramIndex = 1;
      
      if (quantityOnHand !== undefined) {
        if (typeof quantityOnHand !== 'number') {
          return res.status(400).json({ error: 'Quantity must be a number' });
        }
        additionalUpdateFields.push(`quantity_on_hand = $${paramIndex++}`);
        additionalQueryParams.push(quantityOnHand);
      }

      if (reorderPoint !== undefined) {
        if (typeof reorderPoint !== 'number') {
          return res.status(400).json({ error: 'Reorder point must be a number' });
        }
        additionalUpdateFields.push(`reorder_point = $${paramIndex++}`);
        additionalQueryParams.push(reorderPoint);
      }

      if (lastUnitCost !== undefined) {
        if (typeof lastUnitCost !== 'number') {
          const numericLastUnitCost = parseFloat(String(lastUnitCost));
          if (isNaN(numericLastUnitCost)) {
            return res.status(400).json({ error: 'Last unit cost must be a number' });
          }
          additionalUpdateFields.push(`last_unit_cost = $${paramIndex++}`);
          additionalQueryParams.push(numericLastUnitCost);
        } else {
          additionalUpdateFields.push(`last_unit_cost = $${paramIndex++}`);
          additionalQueryParams.push(lastUnitCost);
        }
      }

      if (category !== undefined) {
        additionalUpdateFields.push(`category = $${paramIndex++}`);
        additionalQueryParams.push(category);
      }

      if (part_description !== undefined) {
        additionalUpdateFields.push(`part_description = $${paramIndex++}`);
        additionalQueryParams.push(part_description);
      }

      if (unit !== undefined) {
        additionalUpdateFields.push(`unit = $${paramIndex++}`);
        additionalQueryParams.push(unit);
      }

      // Update additional fields if any
      if (additionalUpdateFields.length > 0) {
        additionalQueryParams.push(part_number); // Use new part number
        const additionalQuery = `UPDATE Inventory SET ${additionalUpdateFields.join(', ')} WHERE part_number = $${paramIndex} RETURNING *;`;
        const additionalResult = await client.query(additionalQuery, additionalQueryParams);
        
        if (additionalResult.rows.length === 0) {
          return res.status(404).json({ error: 'Item not found in inventory after part number update' });
        }
        
        res.json({ message: 'Inventory updated successfully', updatedItem: additionalResult.rows[0] });
      } else {
        // Just get the updated item
        const result = await client.query('SELECT * FROM Inventory WHERE part_number = $1', [part_number]);
        res.json({ message: 'Inventory updated successfully', updatedItem: result.rows[0] });
      }
      
    } else {
      // No part number change, handle as before
      const updateFields = [];
      const queryParams = [];
      let paramIndex = 1;

      if (quantityOnHand !== undefined) {
        if (typeof quantityOnHand !== 'number') {
          return res.status(400).json({ error: 'Quantity must be a number' });
        }
        updateFields.push(`quantity_on_hand = $${paramIndex++}`);
        queryParams.push(quantityOnHand);
      }

      if (reorderPoint !== undefined) {
        if (typeof reorderPoint !== 'number') {
          return res.status(400).json({ error: 'Reorder point must be a number' });
        }
        updateFields.push(`reorder_point = $${paramIndex++}`);
        queryParams.push(reorderPoint);
      }

      if (lastUnitCost !== undefined) {
        if (typeof lastUnitCost !== 'number') {
          const numericLastUnitCost = parseFloat(String(lastUnitCost));
          if (isNaN(numericLastUnitCost)) {
            return res.status(400).json({ error: 'Last unit cost must be a number' });
          }
          updateFields.push(`last_unit_cost = $${paramIndex++}`);
          queryParams.push(numericLastUnitCost);
        } else {
          updateFields.push(`last_unit_cost = $${paramIndex++}`);
          queryParams.push(lastUnitCost);
        }
      }

      if (category !== undefined) {
        updateFields.push(`category = $${paramIndex++}`);
        queryParams.push(category);
      }

      if (part_description !== undefined) {
        updateFields.push(`part_description = $${paramIndex++}`);
        queryParams.push(part_description);
      }

      if (unit !== undefined) {
        updateFields.push(`unit = $${paramIndex++}`);
        queryParams.push(unit);
      }

      // If no fields are provided, return a bad request error
      if (updateFields.length === 0) {
        return res.status(400).json({ error: 'No update fields provided' });
      }

      // Add the partNumber to the query parameters for the WHERE clause
      updateFields.push(`part_number = $${paramIndex++}`);
      queryParams.push(partNumber);

      const query = `UPDATE Inventory SET ${updateFields.slice(0, -1).join(', ')} WHERE ${updateFields.slice(-1)[0]} RETURNING *;`;

      const result = await client.query(query, queryParams);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Item not found in inventory' });
      }

      // Return the updated item
      res.json({ message: 'Inventory updated successfully', updatedItem: result.rows[0] });
    }

  } catch (err) {
    console.error(`Error updating inventory for ${partNumber}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});
*/

// API endpoint to get all margin schedule records
app.get('/api/margin-schedule', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM marginschedule');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching margin schedule:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to add a new margin schedule record
app.post('/api/margin-schedule', async (req, res) => {
  const client = await pool.connect();
  try {
    const { cost_lower_bound, cost_upper_bound, margin_factor } = req.body;

    const result = await client.query(
      'INSERT INTO marginschedule (cost_lower_bound, cost_upper_bound, margin_factor) VALUES ($1, $2, $3) RETURNING margin_id, cost_lower_bound, cost_upper_bound, margin_factor',
      [cost_lower_bound, cost_upper_bound, margin_factor]
    );

    const newMargin = result.rows[0];

    res.status(201).json({ message: 'Margin schedule entry created successfully', margin: newMargin });
  } catch (err) {
    console.error('Error creating margin schedule entry:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// API endpoint to update a margin schedule record by ID
app.put('/api/margin-schedule/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    const { cost_lower_bound, cost_upper_bound, margin_factor } = req.body;

    const result = await client.query(
      'UPDATE marginschedule SET cost_lower_bound = $1, cost_upper_bound = $2, margin_factor = $3 WHERE margin_id = $4 RETURNING *;',
      [cost_lower_bound, cost_upper_bound, margin_factor, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Margin schedule entry not found' });
    }

    res.json({ message: 'Margin schedule entry updated successfully', margin: result.rows[0] });
  } catch (err) {
    console.error(`Error updating margin schedule entry ${id}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// API endpoint to delete a margin schedule record by ID
app.delete('/api/margin-schedule/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    const result = await client.query(
      'DELETE FROM marginschedule WHERE margin_id = $1 RETURNING *;',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Margin schedule entry not found' });
    }

    res.json({ message: 'Margin schedule entry deleted successfully', margin: result.rows[0] });
  } catch (err) {
    console.error(`Error deleting margin schedule entry ${id}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Add API endpoint to delete an inventory item by part number
app.delete('/api/inventory/:partNumber', async (req, res) => {
  const { partNumber } = req.params; // Get partNumber from URL parameters
  const client = await pool.connect();
  try {
    const result = await client.query(
      'DELETE FROM Inventory WHERE part_number = $1 RETURNING *;',
      [partNumber] // Use partNumber from the URL
    );

    if (result.rows.length === 0) {
      // No row was deleted, likely because the partNumber was not found
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    // Return the deleted item or a success message
    res.json({ message: 'Inventory item deleted successfully', deletedItem: result.rows[0] });

  } catch (err) {
    console.error(`Error deleting inventory item ${partNumber}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Add API endpoint to delete a vendor by ID
app.delete('/api/vendors/:vendorId', async (req, res) => {
  const { vendorId } = req.params; // Get vendorId from URL parameters
  const client = await pool.connect();
  try {
    const result = await client.query(
      'DELETE FROM VendorMaster WHERE vendor_id = $1 RETURNING *;',
      [vendorId] // Use vendorId from the URL
    );

    if (result.rows.length === 0) {
      // No row was deleted, likely because the vendorId was not found
      return res.status(404).json({ error: 'Vendor not found' });
    }

    // Return the deleted item or a success message
    res.json({ message: 'Vendor deleted successfully', deletedVendor: result.rows[0] });

  } catch (err) {
    console.error(`Error deleting vendor ${vendorId}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Add API endpoint to update a vendor by ID
app.put('/api/vendors/:vendorId', async (req, res) => {
  const { vendorId } = req.params;
  const { name, street_address, city, province, country, contact, phone, email, website } = req.body;

  const client = await pool.connect();

  // Build the update query dynamically based on provided fields
  const updateFields = [];
  const queryParams = [];
  let paramIndex = 1;

  if (name !== undefined) { updateFields.push(`vendor_name = $${paramIndex++}`); queryParams.push(name); }
  if (street_address !== undefined) { updateFields.push(`street_address = $${paramIndex++}`); queryParams.push(street_address); }
  if (city !== undefined) { updateFields.push(`city = $${paramIndex++}`); queryParams.push(city); }
  if (province !== undefined) { updateFields.push(`province = $${paramIndex++}`); queryParams.push(province); }
  if (country !== undefined) { updateFields.push(`country = $${paramIndex++}`); queryParams.push(country); }
  if (contact !== undefined) { updateFields.push(`contact_person = $${paramIndex++}`); queryParams.push(contact); }
  if (phone !== undefined) { updateFields.push(`telephone_number = $${paramIndex++}`); queryParams.push(phone); }
  if (email !== undefined) { updateFields.push(`email = $${paramIndex++}`); queryParams.push(email); }
  if (website !== undefined) { updateFields.push(`website = $${paramIndex++}`); queryParams.push(website); }

  if (updateFields.length === 0) {
    return res.status(400).json({ error: 'No update fields provided' });
  }

  // Add the vendorId to the query parameters for the WHERE clause
  updateFields.push(`vendor_id = $${paramIndex++}`);
  queryParams.push(vendorId);

  const query = `UPDATE VendorMaster SET ${updateFields.slice(0, -1).join(', ')} WHERE ${updateFields.slice(-1)[0]} RETURNING *;`;

  try {
    const result = await client.query(query, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    res.json({ message: 'Vendor updated successfully', updatedVendor: result.rows[0] });

  } catch (err) {
    console.error(`Error updating vendor ${vendorId}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Customer creation is now handled by customerRoutes.ts
// This endpoint has been removed to prevent conflicts

// Customer operations are now handled by customerRoutes.ts
// These duplicate endpoints have been removed to prevent conflicts

// API endpoint to get all products
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT product_id, product_name, product_description FROM products ORDER BY product_name;');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Product operations are now handled by productRoutes.ts
// These duplicate endpoints have been removed to prevent conflicts

// Create quotes table
pool.query(`
  CREATE TABLE IF NOT EXISTS quotes (
    quote_id SERIAL PRIMARY KEY,
    quote_number VARCHAR(11) UNIQUE,
    customer_id INTEGER REFERENCES customermaster(customer_id),
    quote_date DATE NOT NULL,
    valid_until DATE NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_description TEXT,
    estimated_cost DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`).catch(err => console.error('Error creating quotes table:', err));

// Get all quotes
app.get('/api/quotes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        q.*,
        c.customer_name,
        CAST(q.estimated_cost AS FLOAT) as estimated_cost,
        q.quote_number
      FROM quotes q
      JOIN customermaster c ON q.customer_id = c.customer_id
      ORDER BY q.quote_date DESC;
    `);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching quotes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new quote
app.post('/api/quotes', async (req, res) => {
  const {
    customer_id,
    quote_date,
    valid_until,
    product_name,
    product_description,
    estimated_cost,
    status
  } = req.body;

  console.log('Received quote data:', req.body);

  if (!customer_id || !quote_date || !valid_until || !product_name || !estimated_cost) {
    console.log('Missing required fields:', { customer_id, quote_date, valid_until, product_name, estimated_cost });
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // First verify that the customer exists
    const customerCheck = await client.query('SELECT customer_id FROM customermaster WHERE customer_id = $1', [customer_id]);
    if (customerCheck.rows.length === 0) {
      console.log('Customer not found:', customer_id);
      return res.status(400).json({ error: `Customer with ID ${customer_id} not found` });
    }

    // Generate sequential quote number (YYYY-XXXXX)
    const currentYear = new Date().getFullYear();
    const yearPrefix = `${currentYear}-`;

    // Find the highest sequential number for the current year
    const lastQuoteNumberQuery = await client.query(
      'SELECT quote_number FROM quotes WHERE quote_number LIKE $1 ORDER BY quote_number DESC LIMIT 1',
      [yearPrefix + '%']
    );

    let nextSequence = 1;
    if (lastQuoteNumberQuery.rows.length > 0) {
      const lastQuoteNumber = lastQuoteNumberQuery.rows[0].quote_number;
      const lastSequenceStr = lastQuoteNumber.substring(yearPrefix.length);
      const lastSequence = parseInt(lastSequenceStr, 10);
      if (!isNaN(lastSequence)) {
        nextSequence = lastSequence + 1;
      }
    }

    const generatedQuoteNumber = `${yearPrefix}${nextSequence.toString().padStart(5, '0')}`;

    const result = await client.query(
      `INSERT INTO quotes (
        quote_number, customer_id, quote_date, valid_until, product_name, product_description,
        estimated_cost, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;`,
      [generatedQuoteNumber, customer_id, quote_date, valid_until, product_name, product_description, estimated_cost, status || 'Draft']
    );
    console.log('Quote created successfully:', result.rows[0]);
    
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating quote:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      where: error.where
    });
    res.status(500).json({ error: 'Internal server error', details: error.message });
  } finally {
    client.release();
  }
});

// Update a quote
app.put('/api/quotes/:quoteId', async (req, res) => {
  const { quoteId } = req.params;
  const {
    customer_id,
    quote_date,
    valid_until,
    product_name,
    product_description,
    estimated_cost,
    status
  } = req.body;

  if (!customer_id || !quote_date || !valid_until || !product_name || !estimated_cost) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const result = await pool.query(
      `UPDATE quotes SET
        customer_id = $1,
        quote_date = $2,
        valid_until = $3,
        product_name = $4,
        product_description = $5,
        estimated_cost = $6,
        status = $7,
        updated_at = CURRENT_TIMESTAMP
      WHERE quote_id = $8 RETURNING *;`,
      [customer_id, quote_date, valid_until, product_name, product_description, estimated_cost, status, quoteId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error updating quote:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a quote
app.delete('/api/quotes/:quoteId', async (req, res) => {
  const { quoteId } = req.params;

  try {
    const result = await pool.query('DELETE FROM quotes WHERE quote_id = $1 RETURNING *;', [quoteId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    res.status(200).json({ message: 'Quote deleted successfully' });
  } catch (error) {
    console.error('Error deleting quote:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Convert quote to sales order
app.post('/api/quotes/:quoteId/convert', async (req, res) => {
  const { quoteId } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get quote details
    const quoteResult = await client.query(
      'SELECT * FROM quotes WHERE quote_id = $1;',
      [quoteId]
    );

    if (quoteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Quote not found' });
    }

    const quote = quoteResult.rows[0];

    // Generate sequential sales order number (YYYY-XXXXX)
    const currentYear = new Date().getFullYear();
    const yearPrefix = `${currentYear}-`;

    // Find the highest sequential number for the current year
    const lastSalesOrderNumberQuery = await client.query(
      'SELECT sales_order_number FROM salesorderhistory WHERE sales_order_number LIKE $1 ORDER BY sales_order_number DESC LIMIT 1',
      [yearPrefix + '%']
    );

    let nextSalesOrderSequence = 1;
    if (lastSalesOrderNumberQuery.rows.length > 0) {
      const lastSalesOrderNumber = lastSalesOrderNumberQuery.rows[0].sales_order_number;
      const lastSequenceStr = lastSalesOrderNumber.substring(yearPrefix.length);
      const lastSequence = parseInt(lastSequenceStr, 10);
      if (!isNaN(lastSequence)) {
        nextSalesOrderSequence = lastSequence + 1;
      }
    }
    const generatedSalesOrderNumber = `${yearPrefix}${nextSalesOrderSequence.toString().padStart(5, '0')}`;

    // Calculate GST and Total Amount
    const estimatedCost = parseFloat(quote.estimated_cost);
    const gstRate = 0.05; // Assuming 5% GST, adjust if needed
    const totalGSTAmount = estimatedCost * gstRate;
    const totalAmount = estimatedCost + totalGSTAmount;

    // Create sales order with sales_date and bill_date as NULL, no line items
    const salesOrderResult = await client.query(
      `INSERT INTO salesorderhistory (
        sales_order_number, customer_id, sales_date, product_name, product_description,
        subtotal, total_gst_amount, total_amount, status, estimated_cost
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Open', $9) RETURNING sales_order_id;`,
      [
        generatedSalesOrderNumber,
        quote.customer_id,
        null, // sales_date
        quote.product_name,
        quote.product_description,
        null, // subtotal
        null, // total_gst_amount
        null, // total_amount
        estimatedCost // estimated_cost
      ]
    );

    const salesOrderId = salesOrderResult.rows[0].sales_order_id;

    // Do NOT create any line items

    // Update quote status or delete the quote
    await client.query(
      'DELETE FROM quotes WHERE quote_id = $1;',
      [quoteId]
    );
    console.log(`Quote ${quoteId} deleted after conversion.`);

    await client.query('COMMIT');
    res.status(200).json({
      message: 'Quote converted to sales order and deleted successfully',
      sales_order_id: salesOrderId
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error converting quote to sales order:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// API endpoint to generate PDF for a specific quote
app.get('/api/quotes/:id/pdf', async (req, res) => {
  const { id } = req.params;
  try {
    // Fetch quote and customer info
    const result = await pool.query(`
      SELECT q.*, c.customer_name, c.street_address AS customer_street_address, c.city AS customer_city, c.province AS customer_province, c.country AS customer_country
      FROM quotes q
      JOIN customermaster c ON q.customer_id = c.customer_id
      WHERE q.quote_id = $1
    `, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    const quote = result.rows[0];

    // Fetch business profile
    const businessProfileResult = await pool.query('SELECT * FROM business_profile ORDER BY id DESC LIMIT 1');
    const businessProfile = businessProfileResult.rows[0];

    // Create PDF
    const doc = new PDFDocument({ margin: 40 });
    let filename = `Quote_${quote.quote_number || quote.quote_id}.pdf`;
    filename = encodeURIComponent(filename);
    res.setHeader('Content-disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    // --- HEADER ---
    // Logo (top left)
    let y = 40;
    const logoPath = path.join(__dirname, 'assets', 'default-logo.png');
      if (fs.existsSync(logoPath)) {
        try {
          doc.image(logoPath, 40, y, { fit: [200, 100] });
        } catch (error) {
          console.error('Error adding logo to PDF:', error);
        }
      } else {
      console.warn('Default logo file not found:', logoPath);
    }
    // Business name and address (top right)
    if (businessProfile) {
      doc.font('Helvetica-Bold').fontSize(14).text(businessProfile.business_name, 350, y, { align: 'left' });
      doc.font('Helvetica').fontSize(10).text(
        `${businessProfile.street_address}\n${businessProfile.city}, ${businessProfile.province}, ${businessProfile.postal_code}, ${businessProfile.country}`,
        350, y + 18, { align: 'left' }
      );
    }
    y += 100; // Move down more after logo/business info

    // --- BILL TO & QUOTE INFO ---
    // Bill To (left)
    doc.font('Helvetica-Bold').fontSize(11).text('Bill To:', 40, y, { continued: true });
    doc.font('Helvetica').fontSize(11).text(` ${quote.customer_name}`, { continued: false });
    // Customer address
    let customerAddressY = y + 16;
    if (quote.customer_street_address) {
      doc.font('Helvetica').fontSize(10).text(quote.customer_street_address, 40, customerAddressY);
      customerAddressY += 14;
    }
    if (quote.customer_city || quote.customer_province || quote.customer_country) {
      const cityLine = [quote.customer_city, quote.customer_province, quote.customer_country].filter(Boolean).join(', ');
      doc.font('Helvetica').fontSize(10).text(cityLine, 40, customerAddressY);
      customerAddressY += 14;
    }
    // Add a blank line before the product table
    customerAddressY += 10;

    // Quote Info (right)
    doc.font('Helvetica-Bold').fontSize(11).text(`QUOTE #${quote.quote_number || quote.quote_id}`, 350, y);
    doc.font('Helvetica').fontSize(10)
      .text(`Date: ${quote.quote_date ? new Date(quote.quote_date).toLocaleDateString() : ''}`, 350, y + 16)
      .text(`Valid Until: ${quote.valid_until ? new Date(quote.valid_until).toLocaleDateString() : ''}`, 350, y + 32);

    // --- LINE SEPARATOR ---
    let yTable = Math.max(customerAddressY, y + 56);
    doc.moveTo(40, yTable).lineTo(555, yTable).stroke();
    yTable += 16;

    // --- PRODUCT TABLE HEADER ---
    const tableTop = yTable;
    const col1 = 40, col2 = 200, col3 = 420;
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('PRODUCT', col1, tableTop, { width: 150 });
    doc.text('DESCRIPTION', col2, tableTop, { width: 200 });
    doc.text('ESTIMATED COST', col3, tableTop, { width: 100, align: 'right' });
    yTable = tableTop + 20;
    doc.moveTo(40, yTable).lineTo(555, yTable).stroke();
    yTable += 8;

    // --- PRODUCT TABLE ROW ---
    doc.font('Helvetica').fontSize(11);
    doc.text(quote.product_name, col1, yTable, { width: 150 });
    doc.text(quote.product_description || '', col2, yTable, { width: 200 });
    doc.text(`$${parseFloat(quote.estimated_cost).toFixed(2)}`, col3, yTable, { width: 100, align: 'right' });
    yTable += 24;
    doc.moveTo(40, yTable).lineTo(555, yTable).stroke();

    // --- FOOTER (optional: page number) ---
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).text(
        `Page ${i + 1} of ${pageCount}`,
        doc.page.width - 100,
        doc.page.height - 40,
        { align: 'center' }
      );
    }

    doc.end();
  } catch (err) {
    console.error('Error generating PDF for quote:', err);
    res.status(500).json({ error: 'Internal server error during PDF generation' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Backend server listening on port ${port}`);
  console.log('Server successfully started and listening.');
});

// Catch unhandled exceptions
process.on('uncaughtException', (err) => {
  console.error('Unhandled Exception:', err);
  process.exit(1); // Exit the process after logging
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1); // Exit the process after logging
});

// Listen for server close event
app.on('close', () => {
  console.log('Backend server is closing down.');
});

// Endpoint to get sales order line items by sales_order_id
app.get('/api/sales-order-line-items/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM salesorderlineitems WHERE sales_order_id = $1',
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching sales order line items:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add this at the end of your Express setup, after all routes
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  // Only set status 500 if not already set to 4xx or 5xx
  if (res.statusCode < 400) {
    res.status(500);
  }
  console.error('UNCAUGHT ERROR:', err, err?.stack);
  res.json({ error: 'Internal server error (uncaught)' });
});

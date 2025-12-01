import express, { Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import { pool } from '../db';
import { InvoiceService, InvoiceInput } from '../services/InvoiceService';
import { getLogoImageSource } from '../utils/pdfLogoHelper';

const router = express.Router();
const invoiceService = new InvoiceService(pool);

const formatCurrency = (value: number | string | null | undefined): string => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '$0.00';
  const isNegative = amount < 0;
  const absolute = Math.abs(amount);
  const [whole, cents] = absolute.toFixed(2).split('.');
  const withSeparators = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${isNegative ? '-$' : '$'}${withSeparators}.${cents}`;
};

const normalizeId = (value: any) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const parseMonthRange = (monthParam?: string | string[]) => {
  const raw = Array.isArray(monthParam) ? monthParam[0] : monthParam;
  const now = new Date();
  const [yearStr, monthStr] = (raw || '').split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const valid =
    Number.isInteger(year) &&
    Number.isInteger(monthIndex) &&
    monthIndex >= 0 &&
    monthIndex <= 11;
  const start = valid ? new Date(Date.UTC(year, monthIndex, 1)) : new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const label = start.toLocaleString('default', { month: 'long', year: 'numeric' });
  return { start, end, label };
};

const fetchBusinessProfile = async () => {
  const businessProfileRes = await pool.query(
    `SELECT 
      business_name AS company_name,
      street_address,
      city,
      province,
      country,
      postal_code,
      telephone_number,
      email,
      logo_url
     FROM business_profile
     ORDER BY id DESC
     LIMIT 1`
  );
  return businessProfileRes.rows[0] || {};
};

const renderInvoiceTable = (
  doc: PDFKit.PDFDocument,
  invoices: any[],
  linesMap: Record<number, any[]>
) => {
  const tableHeaders = ['Invoice #', 'Date', 'Due Date', 'Status', 'Amount'];
  const columnWidths = [120, 80, 80, 80, 100];
  let y = doc.y;
  let x = doc.x;
  doc.fontSize(10);
  tableHeaders.forEach((header, idx) => {
    doc.text(header, x, y, { width: columnWidths[idx], continued: false });
    x += columnWidths[idx];
  });
  y += 16;
  doc.moveTo(40, y).lineTo(520, y).stroke();
  y += 6;

  invoices.forEach((invoice) => {
    if (y > doc.page.height - 120) {
      doc.addPage();
      y = doc.y;
    }
    x = 40;
    const dueDate = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : '';
    const invDate = invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString() : '';
    const status = (invoice.status || '').toUpperCase();
    [invoice.invoice_number, invDate, dueDate, status, formatCurrency(invoice.total_amount)].forEach((value, idx) => {
      doc.text(value || '', x, y, { width: columnWidths[idx] });
      x += columnWidths[idx];
    });
    y += 16;

    const lines = linesMap[invoice.invoice_id] || [];
    if (lines.length) {
      doc.font('Helvetica-Oblique').fontSize(9);
      lines.forEach((line) => {
        if (y > doc.page.height - 100) {
          doc.addPage();
          y = doc.y;
        }
        doc.text(`- ${line.part_description || line.part_number || 'Line Item'}`, 60, y, { width: 260 });
        doc.text(String(line.quantity || 0), 330, y, { width: 60, align: 'right' });
        doc.text(formatCurrency(line.line_amount || 0), 400, y, { width: 120, align: 'right' });
        y += 12;
      });
      doc.font('Helvetica').fontSize(10);
      y += 4;
    }
  });
};

const buildCustomerStatement = async (
  doc: PDFKit.PDFDocument,
  customer: any,
  businessProfile: any,
  dateRange: { start: Date; end: Date; label: string }
) => {
  const { start, end, label } = dateRange;
  const client = await pool.connect();
  try {
    const invoicesRes = await client.query(
      `SELECT invoice_id, invoice_number, invoice_date, due_date, status, subtotal, total_gst_amount, total_amount
       FROM invoices
       WHERE customer_id = $1
         AND LOWER(status) <> 'paid'
         AND invoice_date < $2
       ORDER BY invoice_date, invoice_id`,
      [customer.customer_id, end]
    );
    const invoices = invoicesRes.rows;
    const invoiceIds = invoices.map((inv) => inv.invoice_id);

    const linesMap: Record<number, any[]> = {};
    if (invoiceIds.length > 0) {
      const linesRes = await client.query(
        `SELECT * FROM invoicelineitems WHERE invoice_id = ANY($1::int[]) ORDER BY invoice_id, invoice_line_item_id`,
        [invoiceIds]
      );
      for (const line of linesRes.rows) {
        if (!linesMap[line.invoice_id]) linesMap[line.invoice_id] = [];
        linesMap[line.invoice_id].push(line);
      }
    }

    const priorBalance = invoices
      .filter((inv) => new Date(inv.invoice_date) < start)
      .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
    const currentCharges = invoices
      .filter((inv) => new Date(inv.invoice_date) >= start && new Date(inv.invoice_date) < end)
      .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
    const totalOutstanding = invoices.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
    const now = new Date();
    const totalOverdue = invoices
      .filter((inv) => inv.due_date && new Date(inv.due_date) < now)
      .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

    const logoSource = await getLogoImageSource(businessProfile.logo_url);
    if (logoSource) {
      try {
        doc.image(logoSource as any, 40, 30, { width: 140 });
      } catch (err) {
        console.warn('invoiceRoutes: failed to render logo', err);
      }
    }

    doc.font('Helvetica-Bold').fontSize(18).text('Monthly Statement', 200, 40, { align: 'right' });
    doc.font('Helvetica').fontSize(12).text(label, { align: 'right' });

    doc.moveDown();
    doc.font('Helvetica-Bold').text('Company');
    doc.font('Helvetica').text(businessProfile.company_name || 'N/A');
    const companyAddress = [
      businessProfile.street_address,
      businessProfile.city,
      businessProfile.province,
      businessProfile.country,
      businessProfile.postal_code,
    ]
      .filter(Boolean)
      .join(', ');
    if (companyAddress) doc.text(companyAddress);
    if (businessProfile.telephone_number) doc.text(`Phone: ${businessProfile.telephone_number}`);
    if (businessProfile.email) doc.text(`Email: ${businessProfile.email}`);

    doc.moveDown();
    doc.font('Helvetica-Bold').text('Customer');
    doc.font('Helvetica').text(customer.customer_name || '');
    const customerAddress = [
      customer.street_address,
      customer.city,
      customer.province,
      customer.country,
      customer.postal_code,
    ]
      .filter(Boolean)
      .join(', ');
    if (customerAddress) doc.text(customerAddress);
    if (customer.telephone_number) doc.text(`Phone: ${customer.telephone_number}`);
    if (customer.email) doc.text(`Email: ${customer.email}`);

    doc.moveDown();
    doc.font('Helvetica-Bold').text('Summary');
    doc.font('Helvetica').text(`Prior Balance: ${formatCurrency(priorBalance)}`);
    doc.text(`Current Charges (${label}): ${formatCurrency(currentCharges)}`);
    doc.text(`Total Outstanding: ${formatCurrency(totalOutstanding)}`);
    doc.text(`Total Overdue: ${formatCurrency(totalOverdue)}`);

    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(14).text('Unpaid Invoices (through end of month)', { underline: true });
    doc.moveDown(0.5);

    renderInvoiceTable(doc, invoices, linesMap);
  } finally {
    client.release();
  }
};

// List invoices with summary totals
router.get('/', async (req: Request, res: Response) => {
  try {
    const customerId = req.query.customer_id ? normalizeId(req.query.customer_id) : undefined;
    if (req.query.customer_id && customerId === null) {
      return res.status(400).json({ error: 'Invalid customer id' });
    }
    const status = req.query.status
      ? String(req.query.status).trim().toLowerCase() === 'paid'
        ? 'Paid'
        : 'Unpaid'
      : undefined;

    const result = await invoiceService.listInvoices({
      customer_id: customerId ?? undefined,
      status,
    });
    res.json(result);
  } catch (error) {
    console.error('invoiceRoutes: list error', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// Create invoice from a closed sales order
router.post('/from-sales-order/:salesOrderId', async (req: Request, res: Response) => {
  const salesOrderId = normalizeId(req.params.salesOrderId);
  if (!salesOrderId) {
    return res.status(400).json({ error: 'Invalid sales order id' });
  }
  try {
    const created = await invoiceService.createInvoiceFromSalesOrder(salesOrderId);
    res.status(201).json(created);
  } catch (error: any) {
    console.error('invoiceRoutes: create from SO error', error);
    const message = error?.message || 'Failed to create invoice';
    if (message.toLowerCase().includes('closed sales order') || message.toLowerCase().includes('not found')) {
      return res.status(400).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

// Create an invoice manually
router.post('/', async (req: Request, res: Response) => {
  const payload: InvoiceInput = {
    ...req.body,
    line_items: req.body.line_items ?? req.body.lineItems ?? [],
  };
  if (!payload.customer_id) {
    return res.status(400).json({ error: 'customer_id is required' });
  }
  try {
    const created = await invoiceService.createInvoice(payload);
    res.status(201).json(created);
  } catch (error) {
    console.error('invoiceRoutes: create error', error);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// Download monthly statement PDF for a customer (includes all unpaid through selected month)
router.get('/customers/:customerId/statement', async (req: Request, res: Response) => {
  const customerId = normalizeId(req.params.customerId);
  if (!customerId) {
    return res.status(400).json({ error: 'Invalid customer id' });
  }

  try {
    const { start, end, label } = parseMonthRange(req.query.month as string | undefined);
    const client = await pool.connect();
    const customerRes = await client.query('SELECT * FROM customermaster WHERE customer_id = $1', [customerId]);
    client.release();
    if (customerRes.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const customer = customerRes.rows[0];
    const businessProfile = await fetchBusinessProfile();

    const doc = new PDFDocument({ margin: 40 });
    const filename = `customer-statement-${customer.customer_name}-${label.replace(/\s+/g, '-').toLowerCase()}.pdf`;
    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    await buildCustomerStatement(doc, customer, businessProfile, { start, end, label });

    doc.end();
  } catch (error) {
    console.error('invoiceRoutes: statement error', error);
    res.status(500).json({ error: 'Failed to generate statement' });
  }
});

// Download monthly statements for all customers (or a single one via query)
router.get('/statement', async (req: Request, res: Response) => {
  try {
    const customerId = req.query.customer_id ? normalizeId(req.query.customer_id) : undefined;
    if (req.query.customer_id && customerId === null) {
      return res.status(400).json({ error: 'Invalid customer id' });
    }
    const { start, end, label } = parseMonthRange(req.query.month as string | undefined);
    const businessProfile = await fetchBusinessProfile();

    const client = await pool.connect();
    let customers: any[] = [];
    try {
      if (customerId) {
        const customerRes = await client.query('SELECT * FROM customermaster WHERE customer_id = $1', [customerId]);
        if (customerRes.rows.length === 0) {
          return res.status(404).json({ error: 'Customer not found' });
        }
        customers = customerRes.rows;
      } else {
        const customersRes = await client.query(
          `SELECT DISTINCT cm.*
           FROM customermaster cm
           JOIN invoices i ON i.customer_id = cm.customer_id
           WHERE LOWER(i.status) <> 'paid'`
        );
        customers = customersRes.rows;
      }
    } finally {
      client.release();
    }

    if (customers.length === 0) {
      return res.status(404).json({ error: 'No customers with outstanding invoices' });
    }

    const filenameBase = customerId && customers[0] ? customers[0].customer_name : 'all-customers';
    const filename = `statements-${filenameBase}-${label.replace(/\s+/g, '-').toLowerCase()}.pdf`;
    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/pdf');

    const doc = new PDFDocument({ margin: 40, bufferPages: true });
    doc.pipe(res);

    for (let i = 0; i < customers.length; i++) {
      if (i > 0) doc.addPage();
      await buildCustomerStatement(doc, customers[i], businessProfile, { start, end, label });
    }

    doc.end();
  } catch (error) {
    console.error('invoiceRoutes: bulk statement error', error);
    res.status(500).json({ error: 'Failed to generate statements' });
  }
});

// Invoice PDF
router.get('/:id/pdf', async (req: Request, res: Response) => {
  const invoiceId = normalizeId(req.params.id);
  if (!invoiceId) return res.status(400).json({ error: 'Invalid invoice id' });
  try {
    let invoice;
    let lineItems: any[] = [];
    try {
      const data = await invoiceService.getInvoice(invoiceId);
      invoice = data.invoice;
      lineItems = data.lineItems || [];
    } catch (err: any) {
      const msg = err?.message || '';
      console.error('invoiceRoutes: pdf invoice fetch error', err);
      if (msg.toLowerCase().includes('not found')) {
        return res.status(404).json({ error: 'Invoice not found' });
      }
      throw err;
    }

    const bp = await pool.query(
      `SELECT 
        business_name AS company_name,
        street_address,
        city,
        province,
        country,
        postal_code,
        telephone_number,
        email,
        logo_url
      FROM business_profile
      ORDER BY id DESC
      LIMIT 1`
    );
    const businessProfile = bp.rows[0] || {};
    const logoSource = await getLogoImageSource(businessProfile.logo_url);

    const doc = new PDFDocument({ margin: 40 });
    doc.on('error', (err: any) => {
      console.error('invoiceRoutes: pdf stream error', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to generate invoice PDF' });
      } else {
        res.end();
      }
    });

    const filename = `${invoice.invoice_number || 'invoice'}.pdf`;
    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    // Header (no logo)
    const headingY = 40;
    doc.font('Helvetica-Bold').fontSize(18).text(businessProfile.company_name || 'Invoice', 40, headingY);
    doc.font('Helvetica-Bold').fontSize(18).text('Invoice', 420, headingY, { align: 'right' });
    doc.font('Helvetica').fontSize(12).text(invoice.invoice_number || '', 420, headingY + 18, { align: 'right' });

    // Divider
    doc.moveTo(40, headingY + 40).lineTo(560, headingY + 40).stroke();

    // Company & Customer blocks
    const blockTop = headingY + 55;
    doc.font('Helvetica-Bold').fontSize(12).text('Company Information', 40, blockTop);
    doc.font('Helvetica').fontSize(11)
      .text(businessProfile.company_name || '', 40, blockTop + 16)
      .text(businessProfile.street_address || '', 40, doc.y)
      .text([businessProfile.city, businessProfile.province, businessProfile.country, businessProfile.postal_code].filter(Boolean).join(', '), 40, doc.y)
      .text(businessProfile.telephone_number ? `Phone: ${businessProfile.telephone_number}` : '', 40, doc.y)
      .text(businessProfile.email ? `Email: ${businessProfile.email}` : '', 40, doc.y);

    doc.font('Helvetica-Bold').fontSize(12).text('Customer', 320, blockTop);
    doc.font('Helvetica').fontSize(11)
      .text(invoice.customer_name || '', 320, blockTop + 16)
      .text(invoice.street_address || '', 320, doc.y)
      .text([invoice.city, invoice.province, invoice.country, invoice.postal_code].filter(Boolean).join(', '), 320, doc.y)
      .text(invoice.telephone_number ? `Phone: ${invoice.telephone_number}` : '', 320, doc.y)
      .text(invoice.email ? `Email: ${invoice.email}` : '', 320, doc.y);

    // Divider
    doc.moveDown();
    doc.moveTo(40, doc.y + 8).lineTo(560, doc.y + 8).stroke();
    doc.moveDown(2);

    // Invoice metadata
    const invoiceDate = invoice.invoice_date ? new Date(invoice.invoice_date) : null;
    const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
    const metaRowHeight = 18;
    const metaStartY = doc.y;
    const invoiceDateText = invoiceDate && !isNaN(invoiceDate.getTime()) ? invoiceDate.toLocaleDateString() : '';
    const dueDateText = dueDate && !isNaN(dueDate.getTime()) ? dueDate.toLocaleDateString() : '';
    const renderField = (label: string, value: string, xLabel: number, xValue: number, y: number, width = 140) => {
      if (!value) return;
      doc.font('Helvetica-Bold').fontSize(11).text(label, xLabel, y);
      doc.font('Helvetica').fontSize(11).text(value, xValue, y, { width });
    };

    // Row 1: Invoice/Due dates (fixed positions)
    doc.font('Helvetica-Bold').fontSize(11).text('Invoice Date:', 40, metaStartY);
    doc.font('Helvetica').fontSize(11).text(invoiceDateText || 'N/A', 140, metaStartY, { width: 140 });
    doc.font('Helvetica-Bold').fontSize(11).text('Due Date:', 320, metaStartY);
    doc.font('Helvetica').fontSize(11).text(dueDateText || 'N/A', 400, metaStartY, { width: 140 });

    // Row 2: Unit # (left), Make (under Due Date), Model, VIN # (optional)
    const vehicleRowY = metaStartY + metaRowHeight;
    renderField('Unit #:', invoice.unit_number || '', 40, 120, vehicleRowY, 140);
    renderField('Make:', invoice.vehicle_make || '', 320, 400, vehicleRowY, 140); // aligned under Due Date
    renderField('Model:', invoice.vehicle_model || '', 480, 540, vehicleRowY, 80);
    renderField('VIN #:', invoice.vin_number || '', 480, 540, vehicleRowY + metaRowHeight, 140);

    // Row 3: Product only
    const productRowY = vehicleRowY + metaRowHeight * 2;
    doc.font('Helvetica-Bold').fontSize(11).text('Product:', 40, productRowY);
    doc.font('Helvetica').fontSize(11).text(invoice.product_name || 'N/A', 140, productRowY, { width: 420 });

    // Row 4: Product Description
    const descLabelY = productRowY + metaRowHeight;
    doc.font('Helvetica-Bold').fontSize(11).text('Product Description:', 40, descLabelY);
    doc.font('Helvetica').fontSize(11).text(invoice.product_description || 'N/A', 40, descLabelY + 12, { width: 520 });

    doc.y = descLabelY + metaRowHeight + 4;

    // Terms (notes)
    if (invoice.notes) {
      doc.moveDown();
      doc.font('Helvetica-Bold').text('Terms:');
      doc.font('Helvetica').text(invoice.notes, { width: 520 });
    }

    // Line items
    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(12).text('Line Items', 40);
    doc.moveTo(40, doc.y + 4).lineTo(560, doc.y + 4).stroke();
    doc.moveDown(1);

    doc.font('Helvetica-Bold').fontSize(10);
    const headers = ['Part #', 'Description', 'Qty', 'Unit', 'Unit Price', 'Line Total'];
    const widths = [80, 200, 60, 50, 80, 80];
    let y = doc.y;
    let x = 40;
    headers.forEach((h, idx) => {
      doc.text(h, x, y, { width: widths[idx] });
      x += widths[idx];
    });
    y += 14;
    doc.moveTo(40, y).lineTo(560, y).stroke();
    y += 6;

    doc.font('Helvetica').fontSize(10);
    lineItems.forEach((li: any) => {
      if (y > doc.page.height - 120) {
        doc.addPage();
        y = doc.y;
      }
      x = 40;
      const row = [
        li.part_number || '',
        li.part_description || '',
        String(li.quantity ?? ''),
        li.unit || '',
        formatCurrency(Number(li.unit_price) || 0),
        formatCurrency(Number(li.line_amount) || 0),
      ];
      row.forEach((val, idx) => {
        doc.text(val || '', x, y, { width: widths[idx] });
        x += widths[idx];
      });
      y += 14;
    });

    // Totals
    doc.moveDown(1.5);
    const totalsX = 360;
    doc.font('Helvetica-Bold').fontSize(11).text('Subtotal:', totalsX, y, { continued: true }).font('Helvetica').text(formatCurrency(Number(invoice.subtotal) || 0), { align: 'right', width: 200 });
    doc.font('Helvetica-Bold').text('GST:', totalsX, doc.y + 4, { continued: true }).font('Helvetica').text(formatCurrency(Number(invoice.total_gst_amount) || 0), { align: 'right', width: 200 });
    doc.font('Helvetica-Bold').text('Total:', totalsX, doc.y + 4, { continued: true }).font('Helvetica').text(formatCurrency(Number(invoice.total_amount) || 0), { align: 'right', width: 200 });

    console.info('invoiceRoutes: pdf success', { invoiceId, lineItemCount: lineItems.length });
    doc.end();
  } catch (error) {
    console.error('invoiceRoutes: pdf error', error instanceof Error ? error.stack || error.message : error);
    const message = error instanceof Error ? error.message : 'Failed to generate invoice PDF';
    res.status(500).json({ error: 'Failed to generate invoice PDF', details: message });
  }
});

// Get invoice detail
router.get('/:id', async (req: Request, res: Response) => {
  const invoiceId = normalizeId(req.params.id);
  if (!invoiceId) return res.status(400).json({ error: 'Invalid invoice id' });
  try {
    const data = await invoiceService.getInvoice(invoiceId);
    res.json(data);
  } catch (error: any) {
    const message = error?.message || 'Failed to fetch invoice';
    const status = message.toLowerCase().includes('not found') ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

// Update invoice
router.put('/:id', async (req: Request, res: Response) => {
  const invoiceId = normalizeId(req.params.id);
  if (!invoiceId) return res.status(400).json({ error: 'Invalid invoice id' });
  try {
    await invoiceService.updateInvoice(invoiceId, {
      ...req.body,
      line_items: req.body.line_items ?? req.body.lineItems ?? [],
    });
    res.json({ message: 'Invoice updated' });
  } catch (error) {
    console.error('invoiceRoutes: update error', error);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// Delete invoice
router.delete('/:id', async (req: Request, res: Response) => {
  const invoiceId = normalizeId(req.params.id);
  if (!invoiceId) return res.status(400).json({ error: 'Invalid invoice id' });
  try {
    await invoiceService.deleteInvoice(invoiceId);
    res.json({ message: 'Invoice deleted' });
  } catch (error) {
    console.error('invoiceRoutes: delete error', error);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

export default router;


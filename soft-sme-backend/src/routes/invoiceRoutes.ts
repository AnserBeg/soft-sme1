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

// Download monthly statement PDF for a customer
router.get('/customers/:customerId/statement', async (req: Request, res: Response) => {
  const customerId = normalizeId(req.params.customerId);
  if (!customerId) {
    return res.status(400).json({ error: 'Invalid customer id' });
  }

  try {
    const { start, end, label } = parseMonthRange(req.query.month as string | undefined);
    const client = await pool.connect();
    try {
      const customerRes = await client.query('SELECT * FROM customermaster WHERE customer_id = $1', [customerId]);
      if (customerRes.rows.length === 0) {
        return res.status(404).json({ error: 'Customer not found' });
      }
      const customer = customerRes.rows[0];

      const businessProfileRes = await client.query(
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
      const businessProfile = businessProfileRes.rows[0] || {};

      const invoicesRes = await client.query(
        `SELECT invoice_id, invoice_number, invoice_date, due_date, status, subtotal, total_gst_amount, total_amount
         FROM invoices
         WHERE customer_id = $1
           AND LOWER(status) <> 'paid'
           AND invoice_date >= $2
           AND invoice_date < $3
         ORDER BY invoice_date, invoice_id`,
        [customerId, start, end]
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

      const outstandingRes = await client.query(
        `SELECT total_amount, due_date, status FROM invoices WHERE customer_id = $1 AND LOWER(status) <> 'paid'`,
        [customerId]
      );

      const totalOutstanding = outstandingRes.rows.reduce(
        (sum, inv) => sum + Number(inv.total_amount || 0),
        0
      );
      const now = new Date();
      const totalOverdue = outstandingRes.rows
        .filter((inv) => inv.due_date && new Date(inv.due_date) < now)
        .reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);

      const doc = new PDFDocument({ margin: 40 });
      const filename = `customer-statement-${customer.customer_name}-${label.replace(/\s+/g, '-').toLowerCase()}.pdf`;
      res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-type', 'application/pdf');
      doc.pipe(res);

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
      doc.font('Helvetica').text(`Total Outstanding: ${formatCurrency(totalOutstanding)}`);
      doc.text(`Total Overdue: ${formatCurrency(totalOverdue)}`);

      doc.moveDown();
      doc.font('Helvetica-Bold').fontSize(14).text('Unpaid Invoices', { underline: true });
      doc.moveDown(0.5);
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
        [invoice.invoice_number, invDate, dueDate, status, formatCurrency(invoice.total_amount)].forEach(
          (value, idx) => {
            doc.text(value || '', x, y, { width: columnWidths[idx] });
            x += columnWidths[idx];
          }
        );
        y += 16;

        const lines = linesMap[invoice.invoice_id] || [];
        if (lines.length) {
          doc.font('Helvetica-Oblique').fontSize(9);
          lines.forEach((line) => {
            if (y > doc.page.height - 100) {
              doc.addPage();
              y = doc.y;
            }
            doc.text(`• ${line.part_description || line.part_number || 'Line Item'}`, 60, y, { width: 260 });
            doc.text(String(line.quantity || 0), 330, y, { width: 60, align: 'right' });
            doc.text(formatCurrency(line.line_amount || 0), 400, y, { width: 120, align: 'right' });
            y += 12;
          });
          doc.font('Helvetica').fontSize(10);
          y += 4;
        }
      });

      doc.end();
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('invoiceRoutes: statement error', error);
    res.status(500).json({ error: 'Failed to generate statement' });
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

    if (logoSource) {
      try { doc.image(logoSource as any, 40, 30, { width: 140 }); } catch {}
    }
    doc.font('Helvetica-Bold').fontSize(18).text('Invoice', 200, 40, { align: 'right' });
    doc.font('Helvetica').fontSize(12).text(invoice.invoice_number || '', { align: 'right' });

    doc.moveDown();
    doc.font('Helvetica-Bold').text('From');
    doc.font('Helvetica').text(businessProfile.company_name || '');
    const companyAddress = [
      businessProfile.street_address,
      businessProfile.city,
      businessProfile.province,
      businessProfile.country,
      businessProfile.postal_code,
    ].filter(Boolean).join(', ');
    if (companyAddress) doc.text(companyAddress);
    if (businessProfile.telephone_number) doc.text(`Phone: ${businessProfile.telephone_number}`);
    if (businessProfile.email) doc.text(`Email: ${businessProfile.email}`);

    doc.moveDown();
    doc.font('Helvetica-Bold').text('Bill To');
    doc.font('Helvetica').text(invoice.customer_name || '');
    const customerAddress = [
      invoice.street_address,
      invoice.city,
      invoice.province,
      invoice.country,
      invoice.postal_code,
    ].filter(Boolean).join(', ');
    if (customerAddress) doc.text(customerAddress);
    if (invoice.telephone_number) doc.text(`Phone: ${invoice.telephone_number}`);
    if (invoice.email) doc.text(`Email: ${invoice.email}`);

    doc.moveDown();
    const invoiceDate = invoice.invoice_date ? new Date(invoice.invoice_date) : null;
    const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
    doc.font('Helvetica-Bold').text('Invoice Date: ', { continued: true }).font('Helvetica').text(invoiceDate && !isNaN(invoiceDate.getTime()) ? invoiceDate.toLocaleDateString() : '');
    doc.font('Helvetica-Bold').text('Due Date: ', { continued: true }).font('Helvetica').text(dueDate && !isNaN(dueDate.getTime()) ? dueDate.toLocaleDateString() : '');
    doc.font('Helvetica-Bold').text('Status: ', { continued: true }).font('Helvetica').text(invoice.status || '');
    if (invoice.source_sales_order_number) {
      doc.font('Helvetica-Bold').text('Source Sales Order: ', { continued: true }).font('Helvetica').text(invoice.source_sales_order_number);
    }
    if (invoice.notes) {
      doc.moveDown().font('Helvetica-Bold').text('Notes').font('Helvetica').text(invoice.notes);
    }

    doc.moveDown().font('Helvetica-Bold').fontSize(12).text('Line Items');
    doc.moveDown(0.5).font('Helvetica').fontSize(10);
    const headers = ['Part #', 'Description', 'Qty', 'Unit', 'Unit Price', 'Line Total'];
    const widths = [80, 200, 50, 60, 80, 80];
    let y = doc.y;
    let x = doc.x;
    headers.forEach((h, idx) => {
      doc.text(h, x, y, { width: widths[idx] });
      x += widths[idx];
    });
    y += 16;
    doc.moveTo(40, y).lineTo(520, y).stroke();
    y += 6;

    lineItems.forEach((li: any) => {
      if (y > doc.page.height - 100) {
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
        doc.text(val, x, y, { width: widths[idx] });
        x += widths[idx];
      });
      y += 14;
    });

    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(12).text('Subtotal: ', { continued: true }).font('Helvetica').text(formatCurrency(Number(invoice.subtotal) || 0));
    doc.font('Helvetica-Bold').text('GST: ', { continued: true }).font('Helvetica').text(formatCurrency(Number(invoice.total_gst_amount) || 0));
    doc.font('Helvetica-Bold').text('Total: ', { continued: true }).font('Helvetica').text(formatCurrency(Number(invoice.total_amount) || 0));

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

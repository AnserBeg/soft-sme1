import express, { Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import multer from 'multer';
import csv from 'csv-parser';
import fs from 'fs';
import path from 'path';
import { pool } from '../db';
import { InvoiceService, InvoiceInput } from '../services/InvoiceService';
import { getLogoImageSource } from '../utils/pdfLogoHelper';
import { canonicalizeName } from '../lib/normalize';

const router = express.Router();
const invoiceService = new InvoiceService(pool);
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const upload = multer({
  dest: uploadsDir,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
  limits: {
    // Allow larger historical imports (up to ~20MB CSV)
    fileSize: 20 * 1024 * 1024,
  },
});

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

const normalizeHeader = (value: string) => {
  // Preserve '#' so QuickBooks "#" column maps correctly
  const trimmed = (value || '').replace(/^\uFEFF/, '').trim();
  const cleaned = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned && trimmed.includes('#')) return '#';
  if (trimmed.includes('#')) return cleaned || '#';
  return cleaned;
};

const normalizeCell = (value: unknown) => (value == null ? '' : String(value).trim());
const pickFirst = (row: Record<string, string>, keys: string[]) => {
  for (const key of keys) {
    const val = normalizeCell(row[key]);
    if (val) return val;
  }
  return '';
};

const headerMap: Record<string, string> = {
  '#': 'invoice_number',
  no: 'invoice_number',
  number: 'invoice_number',
  txn_no: 'invoice_number',
  transaction_no: 'invoice_number',
  transaction_number: 'invoice_number',
  transaction_: 'invoice_number',
  transaction: 'invoice_number',
  transactio: 'invoice_number', // Some QB exports truncate the header label
  transactio_: 'invoice_number',
  txn: 'invoice_number',
  '': 'invoice_number',
  transaction_date: 'transaction_date',
  txn_date: 'transaction_date',
  customer_full_name: 'customer_name',
  customer: 'customer_name',
  customer_name: 'customer_name',
  customerid: 'customer_name',
  memo: 'memo',
  memo_description: 'memo',
  description: 'memo',
  part_description: 'part_description',
  part_desc: 'part_description',
  product_service: 'product_service',
  product: 'product_service',
  part: 'product_service',
  part_no: 'product_service',
  part_number: 'product_service',
  quantity: 'quantity',
  qty: 'quantity',
  unit: 'unit',
  unit_of_measure: 'unit',
  uom: 'unit',
  unit_price: 'unit_price',
  unit_cost: 'unit_price',
  price: 'unit_price',
  amount: 'amount',
  line_amount: 'line_amount',
  line_total: 'line_amount',
  vin_no: 'vin_number',
  vin_no_: 'vin_number',
  vin: 'vin_number',
  vin_number: 'vin_number',
  make_year: 'make_year',
  make: 'make_year',
  make_model: 'make_year',
  model: 'vehicle_model',
  unit_number: 'unit_number',
  unit_no: 'unit_number',
  a_r_paid: 'payment_status',
  ar_paid: 'payment_status',
  status: 'payment_status',
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const toNumberSafe = (value: unknown, defaultValue = 0) => {
  if (value == null || value === '') return defaultValue;
  const cleaned = typeof value === 'string' ? value.replace(/[^0-9.\-]+/g, '') : value;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : defaultValue;
};
const GST_RATE = 0.05;

const parseCsvDate = (value: string): Date | null => {
  if (!value) return null;
  const direct = new Date(value);
  if (!isNaN(direct.getTime())) return direct;
  const parts = value.split(/[/-]/).map((p) => Number(p));
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    const [a, b, c] = parts;
    const year = c < 100 ? 2000 + c : c;
    const month = a > 12 ? b : a;
    const day = a > 12 ? a : b;
    const parsed = new Date(year, month - 1, day);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return null;
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

// Download CSV template for historical invoice import
router.get('/csv-template', (_req: Request, res: Response) => {
  const csvTemplate = `Product/Service,Transaction date,Transaction type,#,Customer full name,Memo/Description,Quantity,Amount,VIN NO -,MAKE/YEAR,A/R paid
CVIP,10/01/2025,Invoice,15205,CHAUMAD INTEGRATED RESOURCES LTD.,VEHICLE SAFETY INSPECTION,1,200,GT4232,FRTL/2015,Paid
DW1302,10/01/2025,Invoice,15205,CHAUMAD INTEGRATED RESOURCES LTD.,WINDSHIELD,1,180,GT4232,FRTL/2015,Paid`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=\"invoice_import_template.csv\"');
  res.send(csvTemplate);
});

// Bulk import historical invoices from a QuickBooks CSV export
router.post('/upload-csv', (req: Request, res: Response) => {
  upload.single('file')(req, res, async (err: any) => {
    if (err) {
      console.error('invoiceRoutes: upload csv multer error', err);
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'CSV file too large (max 20MB)' });
      }
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    const rawRows: any[] = [];

    try {
      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(req.file!.path)
          .pipe(csv())
          .on('data', (data) => rawRows.push(data))
          .on('end', () => resolve())
          .on('error', (readErr) => reject(readErr));
      });
    } catch (readErr) {
      console.error('invoiceRoutes: failed to read CSV', readErr);
      fs.unlink(req.file.path, () => undefined);
      return res.status(400).json({ error: 'Unable to read CSV file' });
    }

    if (rawRows.length === 0) {
      fs.unlink(req.file.path, () => undefined);
      return res.status(400).json({ error: 'CSV file is empty' });
    }

  type ImportLine = {
    part_number: string;
    part_description: string;
    quantity: number;
    unit: string;
    unit_price: number;
    line_amount: number;
  };

  type ImportInvoice = {
    invoiceNumber: string;
    customerName: string;
    canonicalName: string;
    invoiceDate: Date | null;
    status: 'Paid' | 'Unpaid';
    subtotal: number;
    productName?: string;
    productDescription?: string;
    vin_number?: string;
    vehicle_make?: string;
    vehicle_model?: string;
    unit_number?: string;
    mileage?: number;
    memo?: string;
    lines: ImportLine[];
  };

    const invoiceMap = new Map<string, ImportInvoice>();

    rawRows.forEach((row, idx) => {
      const rowNumber = idx + 2; // account for header row
      const normalizedRow: Record<string, string> = {};
      Object.entries(row).forEach(([key, value]) => {
        const mappedKey = headerMap[normalizeHeader(key)] || normalizeHeader(key);
        normalizedRow[mappedKey] = normalizeCell(value);
    });

    const hasAnyValue = Object.values(normalizedRow).some((v) => normalizeCell(v));
    if (!hasAnyValue) {
      // Entirely blank row; skip quietly
      return;
    }

    const invoiceNumber = pickFirst(normalizedRow, [
      'invoice_number',
      '#',
      'number',
      'no',
      'txn_no',
      'transaction_no',
      'transaction_number',
      'transaction_',
      'transaction',
      'transactio',
      'transactio_',
      'txn',
    ]);
    if (!invoiceNumber) {
      errors.push(`Row ${rowNumber}: Missing invoice number (# column)`);
      return;
    }

    const customerName = normalizedRow.customer_name;
    if (!customerName) {
      errors.push(`Row ${rowNumber}: Missing customer name`);
      return;
    }
    const canonicalName = canonicalizeName(customerName);
    if (!canonicalName) {
      errors.push(`Row ${rowNumber}: Customer name could not be normalized`);
      return;
    }

    const invoiceDate = parseCsvDate(normalizedRow.transaction_date || '') || null;

    const rawStatus = (normalizedRow.payment_status || normalizedRow.transaction_type || '').toLowerCase();
    const status: 'Paid' | 'Unpaid' =
      rawStatus.includes('unpaid') || rawStatus.startsWith('un') || rawStatus === 'no' ? 'Unpaid' : rawStatus.includes('paid') ? 'Paid' : 'Unpaid';

    const rawQty = toNumberSafe(normalizedRow.quantity, 0);
    const quantity = rawQty;
    if (rawQty <= 0) {
      warnings.push(`Row ${rowNumber}: Quantity was ${rawQty}; kept as provided`);
    }

    const amountRaw = pickFirst(normalizedRow, ['amount', 'line_amount', 'line_total']);
    let amount = toNumberSafe(amountRaw, NaN);
    const unitPriceRaw = normalizedRow.unit_price;
    let unitPrice = toNumberSafe(unitPriceRaw, NaN);
    if (!Number.isFinite(amount) && Number.isFinite(unitPrice)) {
      amount = round2(unitPrice * quantity);
    }
    if (!Number.isFinite(unitPrice) && Number.isFinite(amount)) {
      unitPrice = quantity !== 0 ? round2(amount / quantity) : round2(amount);
    }
    if (!Number.isFinite(amount)) {
      warnings.push(`Row ${rowNumber}: Amount missing/invalid; defaulted to 0`);
      amount = 0;
    }

    const productService = normalizedRow.product_service;
    const memo = normalizedRow.memo;
    const partDescription = normalizedRow.part_description;
    const vinNumber = normalizedRow.vin_number;
    const makeYearRaw = normalizedRow.make_year;
    const [firstPart, ...restParts] = makeYearRaw ? makeYearRaw.split('/').map((p) => p.trim()).filter(Boolean) : [];
    const vehicle_make = restParts.length ? firstPart : makeYearRaw || undefined;
    const vehicle_model = restParts.length ? restParts.join('/') : undefined;
    const unit_number = normalizedRow.unit_number;
    const mileageVal = normalizedRow.mileage ? Number(normalizedRow.mileage) : undefined;

      const key = `${canonicalName}::${invoiceNumber}`;
      if (!invoiceMap.has(key)) {
        invoiceMap.set(key, {
          invoiceNumber,
          customerName,
          canonicalName,
          invoiceDate,
          status,
          subtotal: 0,
          productName: productService || undefined,
          productDescription: memo || undefined,
          vin_number: vinNumber || undefined,
          vehicle_make,
          vehicle_model,
          unit_number: unit_number || undefined,
          mileage: mileageVal ?? undefined,
          memo: memo || undefined,
          lines: [],
        });
      }

      const invoice = invoiceMap.get(key)!;
      if (invoice.status !== 'Paid' && status === 'Paid') {
        invoice.status = 'Paid';
      }
      if (status === 'Unpaid') {
        invoice.status = 'Unpaid';
      }
      if (!invoice.invoiceDate && invoiceDate) {
        invoice.invoiceDate = invoiceDate;
      } else if (invoice.invoiceDate && invoiceDate && invoice.invoiceDate.getTime() !== invoiceDate.getTime()) {
        warnings.push(`Invoice ${invoiceNumber}: multiple dates found; using first date ${invoice.invoiceDate.toLocaleDateString()}`);
      }
      if (!invoice.vin_number && vinNumber) {
        invoice.vin_number = vinNumber;
      } else if (vinNumber && invoice.vin_number && invoice.vin_number !== vinNumber) {
        warnings.push(`Invoice ${invoiceNumber}: multiple VIN values found; kept "${invoice.vin_number}"`);
      }
      if (!invoice.vehicle_make && vehicle_make) invoice.vehicle_make = vehicle_make;
      if (!invoice.vehicle_model && vehicle_model) invoice.vehicle_model = vehicle_model;
      if (!invoice.unit_number && unit_number) invoice.unit_number = unit_number;
      if (invoice.mileage === undefined && mileageVal !== undefined && !Number.isNaN(mileageVal)) invoice.mileage = mileageVal;
      if (!invoice.memo && memo) invoice.memo = memo;
      if (!invoice.productName && productService) invoice.productName = productService;
      if (!invoice.productDescription && (partDescription || memo)) invoice.productDescription = partDescription || memo;

      invoice.lines.push({
        part_number: productService || memo || partDescription || `Line ${invoice.lines.length + 1}`,
        part_description: partDescription || memo || productService || 'Imported line item',
        quantity,
        unit: normalizedRow.unit || 'Each',
        unit_price: unitPrice,
        line_amount: round2(amount),
      });
      invoice.subtotal = round2(invoice.subtotal + round2(amount));
    });

    if (errors.length) {
      fs.unlink(req.file.path, () => undefined);
      return res.status(400).json({ error: 'Validation failed', errors, warnings });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const canonicalNames = Array.from(new Set(Array.from(invoiceMap.values()).map((inv) => inv.canonicalName)));
      const customersRes = await client.query(
        'SELECT customer_id, canonical_name, default_payment_terms_in_days FROM customermaster WHERE canonical_name = ANY($1)',
        [canonicalNames]
      );
      const customerMap = new Map<string, { customer_id: number; terms: number }>();
      customersRes.rows.forEach((row: any) => {
        const terms = Number(row.default_payment_terms_in_days);
        customerMap.set(row.canonical_name, { customer_id: row.customer_id, terms: Number.isFinite(terms) && terms > 0 ? terms : 30 });
      });

      // Auto-create any missing customers with minimal info so the import never blocks
      for (const name of canonicalNames) {
        if (customerMap.has(name)) continue;
        const original = Array.from(invoiceMap.values()).find((inv) => inv.canonicalName === name);
        const customerName = original?.customerName || name;
        const insert = await client.query(
          `INSERT INTO customermaster (
            customer_name,
            canonical_name,
            street_address,
            city,
            province,
            country,
            postal_code,
            contact_person,
            telephone_number,
            email,
            website,
            general_notes,
            default_payment_terms_in_days
          ) VALUES ($1,$2,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$3,$4) RETURNING customer_id, default_payment_terms_in_days`,
          [customerName, name, 'Created via invoice import', 30]
        );
        const terms = Number(insert.rows[0].default_payment_terms_in_days);
        customerMap.set(name, { customer_id: insert.rows[0].customer_id, terms: Number.isFinite(terms) && terms > 0 ? terms : 30 });
        warnings.push(`Customer "${customerName}" was missing and created automatically`);
      }

      const incomingNumbers = Array.from(invoiceMap.values()).map((inv) => inv.invoiceNumber);
      const existingRes = await client.query('SELECT invoice_number FROM invoices WHERE invoice_number = ANY($1)', [incomingNumbers]);
      // Track invoice numbers that already exist or get created in this import to avoid unique violations
      const existingNumbers = new Set(existingRes.rows.map((r: any) => r.invoice_number));
      const createdNumbers = new Set<string>();

      const createdInvoices: { invoice_id: number; invoice_number: string }[] = [];
      const skippedInvoices: string[] = [];

      for (const invoice of invoiceMap.values()) {
        if (existingNumbers.has(invoice.invoiceNumber) || createdNumbers.has(invoice.invoiceNumber)) {
          warnings.push(`Invoice ${invoice.invoiceNumber} already exists; skipped to avoid duplicate import`);
          skippedInvoices.push(invoice.invoiceNumber);
          continue;
        }

        const customer = customerMap.get(invoice.canonicalName)!;
        const invoiceDate = invoice.invoiceDate ?? new Date();
        const dueDate = new Date(invoiceDate);
        dueDate.setDate(dueDate.getDate() + customer.terms);
      const subtotal = round2(invoice.subtotal);
      const total_gst_amount = round2(subtotal * GST_RATE);
      const total_amount = round2(subtotal + total_gst_amount);

      const insertInvoice = await client.query(
        `INSERT INTO invoices (
            invoice_number, sequence_number, customer_id, sales_order_id, source_sales_order_number,
            status, invoice_date, due_date, payment_terms_in_days, subtotal, total_gst_amount, total_amount, notes,
            product_name, product_description, vin_number, unit_number, vehicle_make, vehicle_model, mileage
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
          RETURNING invoice_id`,
          [
            invoice.invoiceNumber,
            invoice.invoiceNumber.slice(-16),
            customer.customer_id,
            null,
            null,
            invoice.status,
            invoiceDate,
            dueDate,
            customer.terms,
            subtotal,
            total_gst_amount,
            total_amount,
            invoice.memo || null,
            invoice.productName || null,
            invoice.productDescription || null,
            invoice.vin_number || null,
            invoice.unit_number || null,
            invoice.vehicle_make || null,
            invoice.vehicle_model || null,
            invoice.mileage ?? null,
          ]
        );

        const invoiceId = insertInvoice.rows[0].invoice_id;
        for (const line of invoice.lines) {
          await client.query(
            `INSERT INTO invoicelineitems
             (invoice_id, part_id, part_number, part_description, quantity, unit, unit_price, line_amount)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              invoiceId,
              null,
              line.part_number,
              line.part_description,
              line.quantity,
              line.unit,
              line.unit_price,
              line.line_amount,
            ]
          );
        }

        createdInvoices.push({ invoice_id: invoiceId, invoice_number: invoice.invoiceNumber });
        createdNumbers.add(invoice.invoiceNumber);
      }

      await client.query('COMMIT');
      res.json({
        message: 'Invoice CSV upload completed',
        summary: {
          rowsProcessed: rawRows.length,
          invoicesCreated: createdInvoices.length,
          invoicesSkipped: skippedInvoices.length,
        },
        createdInvoices,
        skippedInvoices,
        errors,
        warnings,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('invoiceRoutes: upload csv error', error);
      res.status(500).json({ error: 'Failed to import invoices from CSV' });
    } finally {
      client.release();
      fs.unlink(req.file.path, () => undefined);
    }
  });
});

// Bulk update unit numbers on existing invoices from a simple CSV (columns: #, Name, Unit, Date)
router.post('/upload-unit-numbers', (req: Request, res: Response) => {
  upload.single('file')(req, res, async (err: any) => {
    if (err) {
      console.error('invoiceRoutes: upload unit csv multer error', err);
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'CSV file too large (max 20MB)' });
      }
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    const warnings: string[] = [];
    const rawRows: any[] = [];

    try {
      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(req.file!.path)
          .pipe(csv())
          .on('data', (data) => rawRows.push(data))
          .on('end', () => resolve())
          .on('error', (readErr) => reject(readErr));
      });
    } catch (readErr) {
      console.error('invoiceRoutes: failed to read unit CSV', readErr);
      fs.unlink(req.file.path, () => undefined);
      return res.status(400).json({ error: 'Unable to read CSV file' });
    }

    if (rawRows.length === 0) {
      fs.unlink(req.file.path, () => undefined);
      return res.status(400).json({ error: 'CSV file is empty' });
    }

    type UnitUpdate = { unit: string; rows: number[] };
    const updateMap = new Map<string, UnitUpdate>();

    rawRows.forEach((row, idx) => {
      const rowNumber = idx + 2; // account for header
      const normalizedRow: Record<string, string> = {};
      Object.entries(row).forEach(([key, value]) => {
        const mappedKey = headerMap[normalizeHeader(key)] || normalizeHeader(key);
        normalizedRow[mappedKey] = normalizeCell(value);
      });

      const hasAnyValue = Object.values(normalizedRow).some((v) => normalizeCell(v));
      if (!hasAnyValue) return;

      const invoiceNumber = pickFirst(normalizedRow, [
        'invoice_number',
        '#',
        'number',
        'no',
        'txn_no',
        'transaction_no',
        'transaction_number',
        'transaction_',
        'transaction',
        'transactio',
        'transactio_',
        'txn',
      ]);
      if (!invoiceNumber) {
        warnings.push(`Row ${rowNumber}: Missing invoice number (# column)`);
        return;
      }

      const unitRaw = pickFirst(normalizedRow, ['unit_number', 'unit', 'unit_no']);
      const unit = unitRaw.trim();
      if (!unit) {
        warnings.push(`Invoice ${invoiceNumber}: No unit value provided (row ${rowNumber})`);
        return;
      }

      const existing = updateMap.get(invoiceNumber);
      if (existing) {
        existing.rows.push(rowNumber);
        if (!existing.unit) {
          existing.unit = unit;
        } else if (existing.unit !== unit) {
          warnings.push(`Invoice ${invoiceNumber}: Conflicting unit values "${existing.unit}" and "${unit}" (rows ${existing.rows.join(', ')})`);
        }
      } else {
        updateMap.set(invoiceNumber, { unit, rows: [rowNumber] });
      }
    });

    if (updateMap.size === 0) {
      fs.unlink(req.file.path, () => undefined);
      return res.status(400).json({ error: 'No usable rows found in CSV', warnings });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const invoiceNumbers = Array.from(updateMap.keys());
      const existingRes = await client.query(
        'SELECT invoice_id, invoice_number, unit_number FROM invoices WHERE invoice_number = ANY($1)',
        [invoiceNumbers]
      );
      const existingMap = new Map<string, { invoice_id: number; unit_number: string | null }>();
      existingRes.rows.forEach((row: any) => {
        existingMap.set(row.invoice_number, { invoice_id: row.invoice_id, unit_number: row.unit_number });
      });

      const missingInvoices = invoiceNumbers.filter((inv) => !existingMap.has(inv));
      const updatedInvoices: { invoice_number: string; unit_number: string }[] = [];
      let skippedMissingUnit = 0;
      let skippedAlreadyHadUnit = 0;

      for (const [invoiceNumber, info] of updateMap.entries()) {
        const existing = existingMap.get(invoiceNumber);
        if (!existing) continue;
        const newUnit = info.unit.trim();
        if (!newUnit) {
          skippedMissingUnit += 1;
          continue;
        }
        const currentUnit = (existing.unit_number || '').trim();
        if (currentUnit) {
          skippedAlreadyHadUnit += 1;
          continue;
        }
        await client.query('UPDATE invoices SET unit_number = $1, updated_at = NOW() WHERE invoice_id = $2', [
          newUnit,
          existing.invoice_id,
        ]);
        updatedInvoices.push({ invoice_number: invoiceNumber, unit_number: newUnit });
      }

      await client.query('COMMIT');
      res.json({
        message: 'Invoice unit numbers updated',
        summary: {
          rowsProcessed: rawRows.length,
          invoicesMatched: invoiceNumbers.length - missingInvoices.length,
          updated: updatedInvoices.length,
          skippedMissingUnit,
          skippedAlreadyHadUnit,
          missingInvoices: missingInvoices.length,
        },
        updatedInvoices,
        missingInvoices,
        warnings,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('invoiceRoutes: upload unit csv error', error);
      res.status(500).json({ error: 'Failed to update invoice unit numbers from CSV' });
    } finally {
      client.release();
      fs.unlink(req.file.path, () => undefined);
    }
  });
});

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

    const limitRaw = req.query.limit ? Number(req.query.limit) : undefined;
    const offsetRaw = req.query.offset ? Number(req.query.offset) : undefined;
    const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
    const offset = Number.isFinite(offsetRaw) ? offsetRaw : undefined;

    const result = await invoiceService.listInvoices({
      customer_id: customerId ?? undefined,
      status,
      limit,
      offset,
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
        business_number,
        logo_url
      FROM business_profile
      ORDER BY id DESC
      LIMIT 1`
    );
    const businessProfile = bp.rows[0] || {};
    const logoSource = await getLogoImageSource(businessProfile.logo_url);

    const doc = new PDFDocument({ margin: 40, bufferPages: true });
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

    const startX = doc.page.margins.left;
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // Header (no logo)
    const headingY = 40;
    doc.font('Helvetica-Bold').fontSize(18).text(businessProfile.company_name || 'Invoice', startX, headingY);
    doc.font('Helvetica-Bold').fontSize(18).text('Invoice', startX + usableWidth / 2, headingY, { align: 'right', width: usableWidth / 2 });
    doc.font('Helvetica').fontSize(12).text(invoice.invoice_number || '', startX + usableWidth / 2, headingY + 18, {
      align: 'right',
      width: usableWidth / 2,
    });

    // Divider
    doc.moveTo(startX, headingY + 40).lineTo(startX + usableWidth, headingY + 40).stroke();

    // Company & Customer blocks
    const blockTop = headingY + 55;
    doc.font('Helvetica-Bold').fontSize(12).text('Company Information', startX, blockTop);
    doc.font('Helvetica').fontSize(11)
      .text(businessProfile.company_name || '', startX, blockTop + 16)
      .text(businessProfile.street_address || '', startX, doc.y)
      .text([businessProfile.city, businessProfile.province, businessProfile.country, businessProfile.postal_code].filter(Boolean).join(', '), startX, doc.y)
      .text(businessProfile.telephone_number ? `Phone: ${businessProfile.telephone_number}` : '', startX, doc.y)
      .text(businessProfile.email ? `Email: ${businessProfile.email}` : '', startX, doc.y);

    doc.font('Helvetica-Bold').fontSize(12).text('Customer', startX + usableWidth / 2, blockTop);
    doc.font('Helvetica').fontSize(11)
      .text(invoice.customer_name || '', startX + usableWidth / 2, blockTop + 16)
      .text(invoice.street_address || '', startX + usableWidth / 2, doc.y)
      .text([invoice.city, invoice.province, invoice.country, invoice.postal_code].filter(Boolean).join(', '), startX + usableWidth / 2, doc.y)
      .text(invoice.telephone_number ? `Phone: ${invoice.telephone_number}` : '', startX + usableWidth / 2, doc.y)
      .text(invoice.email ? `Email: ${invoice.email}` : '', startX + usableWidth / 2, doc.y);

    // Divider
    doc.moveDown();
    doc.moveTo(startX, doc.y + 8).lineTo(startX + usableWidth, doc.y + 8).stroke();
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
    doc.font('Helvetica-Bold').fontSize(11).text('Invoice Date:', startX, metaStartY);
    doc.font('Helvetica').fontSize(11).text(invoiceDateText || 'N/A', startX + 90, metaStartY, { width: 140 });
    doc.font('Helvetica-Bold').fontSize(11).text('Due Date:', startX + usableWidth / 2, metaStartY);
    doc.font('Helvetica').fontSize(11).text(dueDateText || 'N/A', startX + usableWidth / 2 + 80, metaStartY, { width: 120 });

    // Row 2: Unit #, Make, Mileage all on one line
    const vehicleRowY = metaStartY + metaRowHeight;
    renderField('Unit #:', invoice.unit_number || '', startX, startX + 80, vehicleRowY, 180);
    renderField('Make:', invoice.vehicle_make || '', startX + usableWidth / 3, startX + usableWidth / 3 + 60, vehicleRowY, usableWidth / 3 - 80);
    renderField('Mileage:', invoice.mileage != null ? String(invoice.mileage) : '', startX + (usableWidth * 2) / 3, startX + (usableWidth * 2) / 3 + 70, vehicleRowY, usableWidth / 3 - 70);

    // Row 3: Model and VIN
    renderField('Model:', invoice.vehicle_model || '', startX, startX + 80, vehicleRowY + metaRowHeight, usableWidth / 2 - 80);
    renderField('VIN #:', invoice.vin_number || '', startX + usableWidth / 2, startX + usableWidth / 2 + 60, vehicleRowY + metaRowHeight, usableWidth / 2 - 60);

    // Row 3: Product only
    const productRowY = vehicleRowY + metaRowHeight * 2;
    doc.font('Helvetica-Bold').fontSize(11).text('Product:', startX, productRowY);
    doc.font('Helvetica').fontSize(11).text(invoice.product_name || 'N/A', startX + 80, productRowY, { width: usableWidth - 80 });

    // Row 4: Product Description
    const descLabelY = productRowY + metaRowHeight;
    doc.font('Helvetica-Bold').fontSize(11).text('Product Description:', startX, descLabelY);
    doc.font('Helvetica').fontSize(11).text(invoice.product_description || 'N/A', startX, descLabelY + 14, { width: usableWidth, lineGap: 2 });
    doc.y = doc.y + 8;

    // Terms (notes)
    if (invoice.notes) {
      doc.moveDown();
      doc.font('Helvetica-Bold').text('Terms:');
      doc.font('Helvetica').text(invoice.notes, { width: usableWidth });
    }

    // Line items
    const ensureTableSpace = (heightNeeded: number) => {
      if (doc.y + heightNeeded > doc.page.height - doc.page.margins.bottom - 40) {
        doc.addPage();
        renderTableHeader();
      }
    };

    const columnWidths = [80, usableWidth - (80 + 50 + 50 + 70 + 82), 50, 50, 70, 82];
    const columnAlign: Array<'left' | 'center' | 'right'> = ['left', 'left', 'right', 'center', 'right', 'right'];

    const renderTableHeader = () => {
      doc.moveDown();
      doc.font('Helvetica-Bold').fontSize(12).text('Line Items', startX);
      doc.moveTo(startX, doc.y + 4).lineTo(startX + usableWidth, doc.y + 4).stroke();
      doc.moveDown(0.5);

      doc.font('Helvetica-Bold').fontSize(10);
      const headerY = doc.y;
      let headerX = startX;
      ['Part #', 'Description', 'Qty', 'Unit', 'Unit Price', 'Line Total'].forEach((h, idx) => {
        doc.text(h, headerX, headerY, { width: columnWidths[idx], align: columnAlign[idx] });
        headerX += columnWidths[idx];
      });
      const headerHeight = Math.max(
        ...['Part #', 'Description', 'Qty', 'Unit', 'Unit Price', 'Line Total'].map((h, idx) =>
          doc.heightOfString(h, { width: columnWidths[idx] })
        )
      );
      const underlineY = headerY + headerHeight + 4;
      doc.moveTo(startX, underlineY).lineTo(startX + usableWidth, underlineY).stroke();
      doc.y = underlineY + 4;
    };

    renderTableHeader();

    const minRowHeight = 14;
    doc.font('Helvetica').fontSize(10);
    lineItems.forEach((li: any) => {
      const cells = [
        li.part_number || '-',
        li.part_description || '',
        li.quantity != null ? String(li.quantity) : '',
        li.unit || '',
        formatCurrency(Number(li.unit_price) || 0),
        formatCurrency(Number(li.line_amount) || 0),
      ];

      const rowHeight =
        Math.max(
          ...cells.map((val, idx) => doc.heightOfString(val || '', { width: columnWidths[idx], align: columnAlign[idx] }))
        ) + 6;

      ensureTableSpace(rowHeight + 6);

      const rowY = doc.y;
      let rowX = startX;
      cells.forEach((val, idx) => {
        doc.text(val || '', rowX, rowY, { width: columnWidths[idx], align: columnAlign[idx] });
        rowX += columnWidths[idx];
      });

      doc.y = rowY + Math.max(rowHeight, minRowHeight);
    });

    // Totals
    doc.moveDown(1.5);
    if (doc.y + 80 > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
    }
    const totalsX = startX + usableWidth - 200;
    const totalsY = doc.y;
    const totalsLineHeight = 16;

    doc.font('Helvetica-Bold').fontSize(11).text('Subtotal:', totalsX, totalsY, { width: 100, align: 'left' });
    doc.font('Helvetica').fontSize(11).text(formatCurrency(Number(invoice.subtotal) || 0), totalsX + 100, totalsY, { width: 100, align: 'right' });

    doc.font('Helvetica-Bold').fontSize(11).text('GST:', totalsX, totalsY + totalsLineHeight, { width: 100, align: 'left' });
    doc.font('Helvetica').fontSize(11).text(formatCurrency(Number(invoice.total_gst_amount) || 0), totalsX + 100, totalsY + totalsLineHeight, { width: 100, align: 'right' });

    doc.font('Helvetica-Bold').fontSize(12).text('Total:', totalsX, totalsY + totalsLineHeight * 2, { width: 100, align: 'left' });
    doc.font('Helvetica-Bold').fontSize(12).text(formatCurrency(Number(invoice.total_amount) || 0), totalsX + 100, totalsY + totalsLineHeight * 2, { width: 100, align: 'right' });

    // Business number footer (bottom-right on last page)
    if (businessProfile && businessProfile.business_number) {
      const range = doc.bufferedPageRange();
      const lastPageIndex = range.start + range.count - 1;
      doc.switchToPage(lastPageIndex);
      doc.font('Helvetica-Bold')
        .fontSize(10)
        .text(`Business Number: ${businessProfile.business_number}`, startX, doc.page.height - doc.page.margins.bottom + 10, {
          width: usableWidth,
          align: 'right',
        });
    }

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

import express, { Request, Response } from 'express';
import { pool } from '../db';
import PDFDocument from 'pdfkit';
import multer from 'multer';
import csv from 'csv-parser';
import fs from 'fs';
import path from 'path';
import { canonicalizeName } from '../lib/normalize';
import { getLogoImageSource } from '../utils/pdfLogoHelper';
import { SalesOrderService } from '../services/SalesOrderService';

// Format unit costs with up to 4 decimals; keep at least 2 decimals.
const formatUnitCost = (value: any): string => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '0.00';
  }
  const rounded = Number(num.toFixed(4));
  let text = rounded.toFixed(4).replace(/0+$/, '');
  if (text.endsWith('.')) {
    text = text.slice(0, -1);
  }
  if (!text.includes('.')) {
    return `${text}.00`;
  }
  const [whole, decimals] = text.split('.');
  if ((decimals || '').length < 2) {
    return `${whole}.${(decimals || '').padEnd(2, '0')}`;
  }
  return text;
};

const router = express.Router();
const salesOrderService = new SalesOrderService(pool);
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
    fileSize: 20 * 1024 * 1024, // allow larger historical imports
  },
});

const normalizeHeader = (value: string) => {
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
  '#': 'purchase_number',
  number: 'purchase_number',
  txn_no: 'purchase_number',
  transaction_no: 'purchase_number',
  transaction_number: 'purchase_number',
  po_number: 'purchase_number',
  transaction_date: 'transaction_date',
  txn_date: 'transaction_date',
  date: 'transaction_date',
  supplier: 'vendor_name',
  supplier_name: 'vendor_name',
  vendor: 'vendor_name',
  vendor_name: 'vendor_name',
  product_service: 'product_service',
  product_service_full_name: 'product_service',
  product_service_full: 'product_service',
  product: 'product_service',
  item: 'product_service',
  part_number: 'product_service',
  memo: 'memo',
  memo_description: 'memo',
  description: 'memo',
  quantity: 'quantity',
  qty: 'quantity',
  rate: 'unit_cost',
  unit_cost: 'unit_cost',
  cost: 'unit_cost',
  amount: 'line_total',
  line_amount: 'line_total',
  line_total: 'line_total',
};
const round2 = (value: number) => Math.round(value * 100) / 100;
const toNumberSafe = (value: unknown, defaultValue = 0) => {
  if (value == null || value === '') return defaultValue;
  const cleaned = typeof value === 'string' ? value.replace(/[^0-9.\-]+/g, '') : value;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : defaultValue;
};
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

// Download CSV template for historical purchase order import
router.get('/csv-template', (_req: Request, res: Response) => {
  const csvTemplate = `Supplier,Transaction date,#,Product/Service full name,Memo/Description,Quantity,Rate,Amount
ABC Supply,02/12/2024,17780243,2401225AL,2401225AL FRTL RADIATOR,1,799,799
ABC Supply,02/12/2024,17780243,2401225AL,Second line example,2,10,20`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="purchase_order_import_template.csv"');
  res.send(csvTemplate);
});

// Bulk import historical purchase orders from CSV (non-impacting, no vendor creation, no inventory updates)
router.post('/upload-csv', (req: Request, res: Response) => {
  upload.single('file')(req, res, async (err: any) => {
    if (err) {
      console.error('purchaseHistoryRoutes: upload csv multer error', err);
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
      console.error('purchaseHistoryRoutes: failed to read CSV', readErr);
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
      unit_cost: number;
      line_total: number;
    };

    type ImportPurchase = {
      purchaseNumber: string;
      billNumber?: string;
      vendorName: string;
      canonicalVendor: string;
      purchaseDate: Date | null;
      subtotal: number;
      lines: ImportLine[];
    };

    const purchaseMap = new Map<string, ImportPurchase>();

    rawRows.forEach((row, idx) => {
      const rowNumber = idx + 2; // account for header row
      const normalizedRow: Record<string, string> = {};
      Object.entries(row).forEach(([key, value]) => {
        const mappedKey = headerMap[normalizeHeader(key)] || normalizeHeader(key);
        normalizedRow[mappedKey] = normalizeCell(value);
      });

      const hasAnyValue = Object.values(normalizedRow).some((v) => normalizeCell(v));
      if (!hasAnyValue) {
        return;
      }

      const purchaseNumber = pickFirst(normalizedRow, ['purchase_number', '#', 'number', 'txn_no', 'transaction_no', 'po_number']);
      if (!purchaseNumber) {
        errors.push(`Row ${rowNumber}: Missing purchase order number (# column)`);
        return;
      }

      const vendorName = pickFirst(normalizedRow, ['vendor_name', 'supplier', 'supplier_name', 'vendor']);
      if (!vendorName) {
        errors.push(`Row ${rowNumber}: Missing vendor/supplier name`);
        return;
      }
      const canonicalVendor = canonicalizeName(vendorName);
      if (!canonicalVendor) {
        errors.push(`Row ${rowNumber}: Vendor name could not be normalized`);
        return;
      }

      const purchaseDate = parseCsvDate(normalizedRow.transaction_date || normalizedRow.date || '') || null;

      const quantityRaw = toNumberSafe(normalizedRow.quantity, NaN);
      const quantity = Number.isFinite(quantityRaw) ? quantityRaw : 1;
      if (!Number.isFinite(quantityRaw)) {
        warnings.push(`Row ${rowNumber}: Quantity missing/invalid; defaulted to 1`);
      }

      const unitCostRaw = normalizedRow.unit_cost || normalizedRow.rate || '';
      let unit_cost = toNumberSafe(unitCostRaw, NaN);
      const amountRaw = pickFirst(normalizedRow, ['line_total', 'line_amount', 'amount']);
      let line_total = toNumberSafe(amountRaw, NaN);
      if (!Number.isFinite(line_total) && Number.isFinite(unit_cost)) {
        line_total = round2(unit_cost * quantity);
      }
      if (!Number.isFinite(unit_cost) && Number.isFinite(line_total) && quantity !== 0) {
        unit_cost = round2(line_total / quantity);
      }
      if (!Number.isFinite(line_total)) {
        warnings.push(`Row ${rowNumber}: Amount missing/invalid; defaulted to 0`);
        line_total = 0;
      }
      if (!Number.isFinite(unit_cost)) {
        unit_cost = 0;
      }

      const productService = pickFirst(normalizedRow, ['product_service', 'item', 'product', 'part_number']);
      const memo = normalizedRow.memo;

      if (!purchaseMap.has(purchaseNumber)) {
        purchaseMap.set(purchaseNumber, {
          purchaseNumber,
          billNumber: purchaseNumber,
          vendorName,
          canonicalVendor,
          purchaseDate,
          subtotal: 0,
          lines: [],
        });
      }

      const po = purchaseMap.get(purchaseNumber)!;
      if (po.canonicalVendor !== canonicalVendor) {
        warnings.push(`Purchase ${purchaseNumber}: multiple vendors found; using ${po.vendorName}`);
      }
      if (!po.purchaseDate && purchaseDate) {
        po.purchaseDate = purchaseDate;
      } else if (po.purchaseDate && purchaseDate && po.purchaseDate.getTime() !== purchaseDate.getTime()) {
        warnings.push(`Purchase ${purchaseNumber}: multiple dates found; using first date ${po.purchaseDate.toLocaleDateString()}`);
      }

      po.lines.push({
        part_number: productService || memo || `Line ${po.lines.length + 1}`,
        part_description: memo || productService || 'Imported line item',
        quantity,
        unit: normalizedRow.unit || 'Each',
        unit_cost,
        line_total: round2(line_total),
      });
      po.subtotal = round2(po.subtotal + round2(line_total));
    });

    if (errors.length) {
      fs.unlink(req.file.path, () => undefined);
      return res.status(400).json({ error: 'Validation failed', errors, warnings });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const canonicalVendors = Array.from(new Set(Array.from(purchaseMap.values()).map((po) => po.canonicalVendor)));
      const vendorsRes = canonicalVendors.length
        ? await client.query('SELECT vendor_id, canonical_name FROM vendormaster WHERE canonical_name = ANY($1)', [canonicalVendors])
        : { rows: [] as any[] };
      const vendorMap = new Map<string, number>();
      vendorsRes.rows.forEach((row: any) => vendorMap.set(row.canonical_name, row.vendor_id));

      const incomingNumbers = Array.from(purchaseMap.values()).map((po) => po.purchaseNumber);
      const existingRes =
        incomingNumbers.length > 0
          ? await client.query('SELECT purchase_number FROM purchasehistory WHERE purchase_number = ANY($1)', [incomingNumbers])
          : { rows: [] as any[] };
      const existingNumbers = new Set(existingRes.rows.map((r: any) => r.purchase_number));

      const createdPurchaseOrders: { purchase_id: number; purchase_number: string }[] = [];
      const skippedPurchaseOrders: string[] = [];

      for (const po of purchaseMap.values()) {
        if (existingNumbers.has(po.purchaseNumber)) {
          warnings.push(`Purchase order ${po.purchaseNumber} already exists; skipped to avoid duplicate import`);
          skippedPurchaseOrders.push(po.purchaseNumber);
          continue;
        }

        const vendorId = vendorMap.get(po.canonicalVendor) ?? null;
        if (!vendorId) {
          warnings.push(`Vendor "${po.vendorName}" not found; imported without linking to a vendor record`);
        }

        const purchaseDate = po.purchaseDate ?? new Date();
        const subtotal = round2(po.subtotal);
        const gstRate = 0; // keep historical imports non-impacting
        const total_gst_amount = 0;
        const total_amount = subtotal;

        const insertPo = await client.query(
          `INSERT INTO purchasehistory (
            purchase_number, bill_number, vendor_id, purchase_date, subtotal, total_gst_amount, total_amount, gst_rate, status, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
          RETURNING purchase_id`,
          [
            po.purchaseNumber,
            po.billNumber || po.purchaseNumber,
            vendorId,
            purchaseDate,
            subtotal,
            total_gst_amount,
            total_amount,
            gstRate,
            'Closed',
          ]
        );

        const purchaseId = insertPo.rows[0].purchase_id;
        for (const line of po.lines) {
          await client.query(
            `INSERT INTO purchaselineitems (
              purchase_id, part_id, part_number, part_description, quantity, unit, unit_cost, gst_amount, line_total
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              purchaseId,
              null,
              line.part_number,
              line.part_description,
              line.quantity,
              line.unit,
              line.unit_cost,
              0,
              line.line_total,
            ]
          );
        }

        createdPurchaseOrders.push({ purchase_id: purchaseId, purchase_number: po.purchaseNumber });
        existingNumbers.add(po.purchaseNumber);
      }

      await client.query('COMMIT');
      res.json({
        message: 'Purchase order CSV upload completed',
        summary: {
          rowsProcessed: rawRows.length,
          purchaseOrdersCreated: createdPurchaseOrders.length,
          purchaseOrdersSkipped: skippedPurchaseOrders.length,
        },
        createdPurchaseOrders,
        skippedPurchaseOrders,
        errors,
        warnings,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('purchaseHistoryRoutes: upload csv error', error);
      res.status(500).json({ error: 'Failed to import purchase orders from CSV' });
    } finally {
      client.release();
      fs.unlink(req.file.path, () => undefined);
    }
  });
});

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
        COALESCE(vm.vendor_name, 'No Vendor') as vendor_name,
        ph.gst_rate,
        COALESCE(ros.requested_count, 0) AS return_requested_count,
        COALESCE(ros.returned_count, 0) AS return_returned_count,
        (COALESCE(ros.requested_count, 0) + COALESCE(ros.returned_count, 0)) > 0 AS has_returns
      FROM purchasehistory ph
      LEFT JOIN vendormaster vm ON ph.vendor_id = vm.vendor_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE ro.status = 'Requested') AS requested_count,
          COUNT(*) FILTER (WHERE ro.status = 'Returned') AS returned_count
        FROM return_orders ro
        WHERE ro.purchase_id = ph.purchase_id
      ) ros ON TRUE
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
        COALESCE(vm.vendor_name, 'No Vendor') as vendor_name,
        ph.gst_rate,
        COALESCE(ros.requested_count, 0) AS return_requested_count,
        COALESCE(ros.returned_count, 0) AS return_returned_count,
        (COALESCE(ros.requested_count, 0) + COALESCE(ros.returned_count, 0)) > 0 AS has_returns
      FROM purchasehistory ph
      LEFT JOIN vendormaster vm ON ph.vendor_id = vm.vendor_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE ro.status = 'Requested') AS requested_count,
          COUNT(*) FILTER (WHERE ro.status = 'Returned') AS returned_count
        FROM return_orders ro
        WHERE ro.purchase_id = ph.purchase_id
      ) ros ON TRUE
      WHERE LOWER(ph.status) = 'open'
      ORDER BY ph.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('purchaseHistoryRoutes: Error fetching open purchase orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check for duplicate bill number
router.get('/check-bill-number', async (req: Request, res: Response) => {
  const { bill_number, exclude_purchase_id } = req.query;
  
  try {
    if (!bill_number) {
      return res.status(400).json({ error: 'Bill number is required' });
    }

    let query = 'SELECT COUNT(*) as count FROM purchasehistory WHERE bill_number = $1';
    const params = [bill_number];

    // If exclude_purchase_id is provided, exclude that purchase order from the check
    if (exclude_purchase_id) {
      query += ' AND purchase_id != $2';
      params.push(exclude_purchase_id);
    }

    const result = await pool.query(query, params);
    const count = parseInt(result.rows[0].count);
    
    res.json({ exists: count > 0 });
  } catch (err) {
    console.error('Error checking duplicate bill number:', err);
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

        // Convert part_number to uppercase for consistency, keep visual '-' but ensure duplicate-safe checks elsewhere
        const visualPartNumber = item.part_number.toString().trim().toUpperCase();
        
        // Prefer part_id from purchaselineitems if available
        let existingPartResult;
        if (item.part_id) {
          existingPartResult = await client.query(
            `SELECT part_id, part_number, part_type FROM inventory WHERE part_id = $1`,
            [item.part_id]
          );
        } else {
          existingPartResult = await client.query(
            `SELECT part_id, part_number, part_type FROM inventory 
             WHERE REPLACE(REPLACE(UPPER(part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER($1), '-', ''), ' ', '')`,
            [visualPartNumber]
          );
        }
        
        // Only update quantity_on_hand for stock items, not supply items
        if (existingPartResult.rows.length === 0) {
          // New part - insert as stock by default
          console.log(`purchaseHistoryRoutes: Adding new part to inventory: '${visualPartNumber}' (quantity: ${quantity}, unit_cost: ${unitCost})`);
          await client.query(
            `INSERT INTO inventory (part_number, part_description, unit, last_unit_cost, quantity_on_hand, part_type)
             VALUES ($1, $2, $3, $4, $5, 'stock')`,
            [visualPartNumber, item.part_description, item.unit, unitCost, quantity]
          );
        } else {
          const partType = existingPartResult.rows[0].part_type;
          const existingPartId: number = existingPartResult.rows[0].part_id;
          if (partType === 'stock') {
            // Update quantity_on_hand for stock items
            console.log(`purchaseHistoryRoutes: Updating inventory for stock part: '${visualPartNumber}' (quantity: ${quantity}, unit_cost: ${unitCost})`);
            await client.query(
              `UPDATE inventory SET
               quantity_on_hand = COALESCE(NULLIF(quantity_on_hand, 'NA')::NUMERIC, 0) + CAST($1 AS NUMERIC),
               last_unit_cost = $2,
               updated_at = NOW()
               WHERE part_id = $3`,
              [quantity, unitCost, existingPartId]
            );
          } else {
            // For supply items, only update last_unit_cost, not quantity_on_hand
            console.log(`purchaseHistoryRoutes: Updating last_unit_cost for supply part: '${visualPartNumber}' (unit_cost: ${unitCost})`);
            await client.query(
              `UPDATE inventory SET
               last_unit_cost = $1,
               updated_at = NOW()
               WHERE part_id = $2`,
              [unitCost, existingPartId]
            );
          }
        }
        console.log(`purchaseHistoryRoutes: Inventory update for part '${visualPartNumber}' completed.`);
      }
    } else if (status === 'Open' && oldStatus === 'Closed') {
      await client.query('ROLLBACK');
      console.warn(`Reopen attempt blocked for purchase order ${id}.`);
      return res.status(400).json({
        error: 'Reopen not allowed',
        message: 'Closed purchase orders cannot be reopened. Create a new purchase order if additional items are required.'
      });
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

// Export purchase history to PDF
router.get('/export/pdf', async (req: Request, res: Response) => {
  console.log('Purchase history PDF export endpoint hit');
  try {
    const { status } = req.query;
    let query = `
      SELECT 
        ph.*,
        CAST(ph.subtotal AS FLOAT) as subtotal,
        CAST(ph.total_gst_amount AS FLOAT) as total_gst_amount,
        CAST(ph.total_amount AS FLOAT) as total_amount,
        vm.vendor_name,
        ph.gst_rate
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

    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ');
    }

    query += ' ORDER BY ph.created_at DESC';

    const result = await pool.query(query, queryParams);
    const purchaseOrders = result.rows;

    const doc = new PDFDocument({ margin: 50 });
    const filename = `purchase_orders_${new Date().toISOString().split('T')[0]}.pdf`;
    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    // Header
    doc.font('Helvetica-Bold').fontSize(20).text('Purchase Orders', { align: 'center' });
    doc.moveDown();
    doc.font('Helvetica').fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(2);

    // Table headers
    const headers = ['Purchase #', 'Vendor', 'Bill Date', 'Bill #', 'Subtotal', 'GST', 'Total', 'Status'];
    const columnWidths = [100, 120, 80, 80, 80, 60, 80, 60];
    let y = doc.y;

    // Draw header row
    doc.font('Helvetica-Bold').fontSize(9);
    let x = 50;
    headers.forEach((header, index) => {
      doc.text(header, x, y, { width: columnWidths[index] });
      x += columnWidths[index];
    });

    y += 20;
    doc.moveTo(50, y).lineTo(670, y).stroke();

    // Draw data rows
    doc.font('Helvetica').fontSize(8);
    purchaseOrders.forEach((order, index) => {
      if (y > doc.page.height - 100) {
        doc.addPage();
        y = 50;
      }

      x = 50;
      doc.text(order.purchase_number || '', x, y, { width: columnWidths[0] });
      x += columnWidths[0];
      doc.text(order.vendor_name || '', x, y, { width: columnWidths[1] });
      x += columnWidths[1];
      
      const billDate = order.purchase_date ? new Date(order.purchase_date).toLocaleDateString() : '';
      doc.text(billDate, x, y, { width: columnWidths[2] });
      x += columnWidths[2];
      
      doc.text(order.purchase_number || '', x, y, { width: columnWidths[3] });
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
      doc.moveTo(50, y).lineTo(670, y).stroke();
      y += 5;
    });

    doc.end();
  } catch (err) {
    const error = err as Error;
    console.error('purchaseHistoryRoutes: Error generating PDF:', error);
    res.status(500).json({ error: 'Internal server error during PDF generation', details: error.message, stack: error.stack });
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
      `SELECT ph.*, vm.vendor_name, vm.street_address as vendor_street_address, vm.city as vendor_city, vm.province as vendor_province, vm.country as vendor_country, vm.postal_code as vendor_postal_code, vm.telephone_number as vendor_phone, vm.email as vendor_email, ph.gst_rate FROM PurchaseHistory ph JOIN VendorMaster vm ON ph.vendor_id = vm.vendor_id WHERE ph.purchase_id = $1`,
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
    const logoSource = await getLogoImageSource(businessProfile?.logo_url);
    if (logoSource) {
      try {
        doc.image(logoSource, logoX, headerY, { fit: [logoWidth, logoHeight] });
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
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(businessProfile?.business_name || '', 50, y);
    doc.text(businessProfile?.street_address || '', 50, y + 14);
    doc.text(
      [businessProfile?.city, businessProfile?.province, businessProfile?.country, businessProfile?.postal_code].filter(Boolean).join(', '),
      50, y + 28
    );
    doc.text(businessProfile?.email || '', 50, y + 42);
    doc.text(businessProfile?.telephone_number || '', 50, y + 56);
    // Vendor info (right column)
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(purchaseOrder.vendor_name || '', 320, y);
    doc.text(purchaseOrder.vendor_street_address || '', 320, y + 14);
    doc.text(
      [purchaseOrder.vendor_city, purchaseOrder.vendor_province, purchaseOrder.vendor_country, purchaseOrder.vendor_postal_code].filter(Boolean).join(', '),
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
      let rowY = y;
      
      // Calculate required height for this row based on text content
      const snHeight = doc.heightOfString(sn.toString(), { width: colWidths[0] });
      const partNumberHeight = doc.heightOfString(item.part_number || '', { width: colWidths[1] });
      const partDescHeight = doc.heightOfString(item.part_description || '', { width: colWidths[2] });
      const qtyHeight = doc.heightOfString(parseFloat(item.quantity).toString(), { width: colWidths[3] });
      const unitHeight = doc.heightOfString(item.unit || '', { width: colWidths[4] });
      const unitCostHeight = doc.heightOfString(formatUnitCost(item.unit_cost), { width: colWidths[5] });
      const lineTotalHeight = doc.heightOfString(parseFloat(item.line_total).toFixed(2), { width: colWidths[6] });
      
      const maxTextHeight = Math.max(snHeight, partNumberHeight, partDescHeight, qtyHeight, unitHeight, unitCostHeight, lineTotalHeight);
      const rowHeight = Math.max(maxTextHeight + 6, 16); // Add padding, minimum 16px
      
      // Check if we need a new page
      if (y + rowHeight > doc.page.height - 100) {
        doc.addPage();
        y = 50;
        rowY = y;
      }
      
      // SN
      doc.text(sn.toString(), currentX, rowY, { 
        width: colWidths[0], 
        align: 'left',
        height: rowHeight
      });
      currentX += colWidths[0];
      
      // Part Number
      doc.text(item.part_number || '', currentX, rowY, { 
        width: colWidths[1], 
        align: 'left',
        height: rowHeight
      });
      currentX += colWidths[1];
      
      // Part Description
      doc.text(item.part_description || '', currentX, rowY, { 
        width: colWidths[2], 
        align: 'left',
        height: rowHeight
      });
      currentX += colWidths[2];
      
      // Quantity
      doc.text(parseFloat(item.quantity).toString(), currentX, rowY, { 
        width: colWidths[3], 
        align: 'left',
        height: rowHeight
      });
      currentX += colWidths[3];
      
      // Unit
      doc.text(item.unit || '', currentX, rowY, { 
        width: colWidths[4], 
        align: 'left',
        height: rowHeight
      });
      currentX += colWidths[4];
      
      // Unit Cost
      doc.text(formatUnitCost(item.unit_cost), currentX, rowY, { 
        width: colWidths[5], 
        align: 'right',
        height: rowHeight
      });
      currentX += colWidths[5];
      
      // Line Total
      doc.text(parseFloat(item.line_total).toFixed(2), currentX, rowY, { 
        width: colWidths[6], 
        align: 'right',
        height: rowHeight
      });
      
      // Move y to the next row position
      y += rowHeight + 8;
      
      // Draw row line
      doc.moveTo(50, y - 2).lineTo(550, y - 2).strokeColor('#eeeeee').stroke();
      sn++;
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
      `SELECT ph.*, ph.subtotal, ph.total_gst_amount, vm.vendor_name, ph.gst_rate
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

// Get allocation suggestions for a purchase order
router.get('/:id/allocation-suggestions', async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();
  
  try {
    // Get purchase order details
    const poResult = await client.query(
      'SELECT * FROM purchasehistory WHERE purchase_id = $1',
      [id]
    );
    
    if (poResult.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    
    const purchaseOrder = poResult.rows[0];
    
    // Get purchase order line items
    const poLineItemsResult = await client.query(
      'SELECT * FROM purchaselineitems WHERE purchase_id = $1',
      [id]
    );
    
      const poLineItems = poLineItemsResult.rows;

      const normalizedPartNumbers = Array.from(
        new Set(
          poLineItems
            .map((item: any) => (item?.part_number ? String(item.part_number).trim().toUpperCase() : ''))
            .filter((pn: string) => pn.length > 0)
        )
      );

      const partTypeMap = new Map<string, string>();
      if (normalizedPartNumbers.length > 0) {
        const placeholders = normalizedPartNumbers.map((_, idx) => `$${idx + 1}`).join(',');
        const typeResult = await client.query(
          `SELECT part_number, part_type FROM inventory WHERE UPPER(part_number) IN (${placeholders})`,
          normalizedPartNumbers
        );
        for (const row of typeResult.rows) {
          if (row?.part_number) {
            partTypeMap.set(String(row.part_number).toUpperCase(), (row.part_type || '').toLowerCase());
          }
        }
      }

      // Aggregate line items by part number to handle duplicates
    const aggregatedItems = new Map();
    for (const poItem of poLineItems) {
      const partNumber = poItem.part_number.toString().trim().toUpperCase();
      const partType = partTypeMap.get(partNumber);
      if (aggregatedItems.has(partNumber)) {
        // Add quantities for duplicate parts
        const existing = aggregatedItems.get(partNumber);
        existing.quantity += parseFloat(poItem.quantity);
        existing.part_description = poItem.part_description; // Use the last description
      } else {
        aggregatedItems.set(partNumber, {
          part_number: partNumber,
          part_description: poItem.part_description,
          quantity: parseFloat(poItem.quantity)
        });
      }
    }
    
    const suggestions = [];
    
    for (const [partNumber, poItem] of aggregatedItems) {
      const quantityOrdered = poItem.quantity;
      
      console.log(`Processing part: ${partNumber} (original: ${poItem.part_number})`);
      
            // Get all open sales orders that need this part (from sales_order_parts_to_order table), ordered by sales order number (FIFO)
      const ptoResult = await client.query(`
        SELECT
          sopt.part_number,
          sopt.part_description,
          sopt.quantity_needed,
          sopt.unit,
          sopt.unit_price,
          sopt.line_amount,
          soh.sales_order_id,
          soh.sales_order_number,
          soh.sales_date,
          soh.created_at as sales_order_created_at,
          cm.customer_name
        FROM sales_order_parts_to_order sopt
        JOIN salesorderhistory soh ON sopt.sales_order_id = soh.sales_order_id
        JOIN customermaster cm ON soh.customer_id = cm.customer_id
        WHERE UPPER(sopt.part_number) = UPPER($1) AND soh.status = 'Open'
          AND sopt.quantity_needed > 0
          ORDER BY soh.sales_order_number ASC
      `, [partNumber]);

    // Get ALL open sales orders (regardless of whether they need this part)
    const allOpenSOsResult = await client.query(`
      SELECT
        soh.sales_order_id,
        soh.sales_order_number,
        soh.sales_date,
        soh.created_at as sales_order_created_at,
        cm.customer_name
      FROM salesorderhistory soh
      JOIN customermaster cm ON soh.customer_id = cm.customer_id
      WHERE soh.status = 'Open'
      ORDER BY soh.sales_order_number ASC
    `);
      
      const ptoItems = ptoResult.rows;
      const allOpenSOs = allOpenSOsResult.rows;
      const totalNeeded = ptoItems.reduce((sum, item) => sum + parseFloat(item.quantity_needed), 0);
      
      console.log(`Allocation suggestions for part ${partNumber}:`);
      console.log(`- Quantity ordered: ${quantityOrdered}`);
      console.log(`- Parts to order items found: ${ptoItems.length}`);
      console.log(`- Total needed: ${totalNeeded}`);
      ptoItems.forEach((item, index) => {
        console.log(`  ${index + 1}. SO ${item.sales_order_number}: ${item.quantity_needed} needed`);
      });
      
      // Calculate suggested allocation (only for parts that are actually needed)
      const suggestedAllocate = Math.min(quantityOrdered, totalNeeded);
      const suggestedSurplus = quantityOrdered - suggestedAllocate;
      
      // Generate FIFO allocation suggestions - fill each sales order completely before moving to next
      const allocationSuggestions = [];
      let remaining = suggestedAllocate;
      
      // Sort parts to order items by sales order number (FIFO)
      const sortedPtoItems = ptoItems.sort((a, b) => 
        a.sales_order_number.localeCompare(b.sales_order_number)
      );
      
      // Always add ALL sales orders that need this part, regardless of suggested allocation
      console.log(`Processing ${sortedPtoItems.length} sales orders that need part ${partNumber}`);
      for (const ptoItem of sortedPtoItems) {
        const currentNeeded = parseFloat(ptoItem.quantity_needed);
        const alloc = remaining > 0 ? Math.min(currentNeeded, remaining) : 0;
        
        console.log(`Adding sales order ${ptoItem.sales_order_number} with current need ${currentNeeded}, suggested alloc ${alloc}`);
        
        allocationSuggestions.push({
          sales_order_id: ptoItem.sales_order_id,
          sales_order_number: ptoItem.sales_order_number,
          customer_name: ptoItem.customer_name,
          sales_date: ptoItem.sales_date,
          part_number: partNumber,
          current_quantity_needed: currentNeeded,
          suggested_alloc: alloc,
          is_needed: true
        });
        
        if (remaining > 0) {
          remaining -= alloc;
        }
      }
      
      // Add ALL open sales orders to the list (not just the ones that need this part)
      const ptoSalesOrderIds = new Set(ptoItems.map(item => item.sales_order_id));
      console.log(`Sales order IDs that need part ${partNumber}:`, Array.from(ptoSalesOrderIds));
      
      for (const so of allOpenSOs) {
        // Only add sales orders that haven't already been added (those that don't need this part)
        if (!ptoSalesOrderIds.has(so.sales_order_id)) {
          console.log(`Adding sales order ${so.sales_order_number} that doesn't need part ${partNumber}`);
          allocationSuggestions.push({
            sales_order_id: so.sales_order_id,
            sales_order_number: so.sales_order_number,
            customer_name: so.customer_name,
            sales_date: so.sales_date,
            part_number: partNumber,
            current_quantity_needed: 0,
            suggested_alloc: 0,
            is_needed: false
          });
        } else {
          console.log(`Sales order ${so.sales_order_number} already added (needs part ${partNumber})`);
        }
      }
      
      // Sort all allocation suggestions by sales order number for consistent display
      allocationSuggestions.sort((a, b) => a.sales_order_number.localeCompare(b.sales_order_number));
      
      console.log(`Part ${partNumber}: Found ${ptoItems.length} sales orders that need this part, ${allOpenSOs.length} total open sales orders, ${allocationSuggestions.length} allocation suggestions`);
      console.log(`Final suggestion for ${partNumber}: quantity_ordered=${quantityOrdered}, total_needed=${totalNeeded}, suggested_allocate=${suggestedAllocate}`);
      
      suggestions.push({
        part_number: partNumber,
        part_description: poItem.part_description,
        quantity_ordered: quantityOrdered,
        total_needed: totalNeeded,
        suggested_allocate: suggestedAllocate,
        suggested_surplus: suggestedSurplus,
        allocation_suggestions: allocationSuggestions
      });
    }
    
    res.json({
      purchase_order_id: id,
      purchase_order_number: purchaseOrder.purchase_number,
      suggestions: suggestions
    });
    
  } catch (error: any) {
    console.error('Error generating allocation suggestions:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  } finally {
    client.release();
  }
});

// Helper function to update aggregated parts to order
async function updateAggregatedPartsToOrder(poLineItems: any[], client: any) {
  console.log('🔄 Updating aggregated parts to order table');
  
  for (const poItem of poLineItems) {
    const partNumber = poItem.part_number.toString().trim().toUpperCase();
    
    // Check if this part still has any parts to order
    console.log(`🔍 Checking remaining parts to order for part ${partNumber}`);
    const remainingPtoResult = await client.query(
      'SELECT SUM(quantity_needed) as total_needed FROM sales_order_parts_to_order sopt JOIN salesorderhistory soh ON sopt.sales_order_id = soh.sales_order_id WHERE sopt.part_number = $1 AND soh.status = \'Open\'',
      [partNumber]
    );
    
    const totalNeeded = parseFloat(remainingPtoResult.rows[0]?.total_needed || '0');
    console.log(`📊 Current total needed for part ${partNumber}: ${totalNeeded} (from quantity_needed)`);
    
    if (totalNeeded > 0) {
      // Get part details for aggregated table
      const partDetailsResult = await client.query(
        'SELECT part_description, unit, unit_price FROM sales_order_parts_to_order WHERE part_number = $1 LIMIT 1',
        [partNumber]
      );
      
      const partDetails = partDetailsResult.rows[0] || {};
      const partDescription = partDetails.part_description || '';
      const unit = partDetails.unit || 'Each';
      const unitPrice = parseFloat(partDetails.unit_price) || 0;
      const totalLineAmount = totalNeeded * unitPrice;
      
      // Insert or update aggregated table
      await client.query(
        `INSERT INTO aggregated_parts_to_order 
         (part_number, part_description, total_quantity_needed, unit, unit_price, total_line_amount, min_required_quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (part_number) 
         DO UPDATE SET 
           part_description = EXCLUDED.part_description,
           total_quantity_needed = EXCLUDED.total_quantity_needed,
           unit = EXCLUDED.unit,
           unit_price = EXCLUDED.unit_price,
           total_line_amount = EXCLUDED.total_line_amount,
           min_required_quantity = EXCLUDED.min_required_quantity,
           updated_at = CURRENT_TIMESTAMP`,
        [partNumber, partDescription, totalNeeded, unit, unitPrice, totalLineAmount, totalNeeded]
      );
      console.log(`✅ Updated aggregated parts to order for part ${partNumber}: ${totalNeeded}`);
    } else {
      // Remove from aggregated table if no more needed
      await client.query(
        'DELETE FROM aggregated_parts_to_order WHERE part_number = $1',
        [partNumber]
      );
      console.log(`🗑️ Removed part ${partNumber} from aggregated parts to order (no more needed)`);
    }
  }
}

// Finalize allocations and close purchase order
router.post('/:id/close-with-allocations', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { surplusPerPart } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get purchase order details
    const poResult = await client.query(
      'SELECT * FROM purchasehistory WHERE purchase_id = $1 FOR UPDATE',
      [id]
    );
    
    if (poResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    
    const purchaseOrder = poResult.rows[0];
    
    if (purchaseOrder.status === 'Closed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Purchase order is already closed' });
    }
    
    // Get purchase order line items
    const poLineItemsResult = await client.query(
      'SELECT * FROM purchaselineitems WHERE purchase_id = $1',
      [id]
    );
    
    const poLineItems = poLineItemsResult.rows;
    const normalizedPartNumbers = Array.from(
      new Set(
        poLineItems
          .map((item: any) => item?.part_number ? String(item.part_number).trim().toUpperCase() : '')
          .filter((pn: string) => pn.length > 0)
      )
    );

    const partTypeMap = new Map<string, string>();
    if (normalizedPartNumbers.length > 0) {
      const placeholders = normalizedPartNumbers.map((_, idx) => `$${idx + 1}`).join(',');
      const typeResult = await client.query(
        `SELECT part_number, part_type FROM inventory WHERE UPPER(part_number) IN (${placeholders})`,
        normalizedPartNumbers
      );
      for (const row of typeResult.rows) {
        if (row?.part_number) {
          partTypeMap.set(String(row.part_number).toUpperCase(), (row.part_type || '').toLowerCase());
        }
      }
    }

    
    // Get stored allocations for this purchase order
    const allocationsResult = await client.query(
      'SELECT * FROM purchase_order_allocations WHERE purchase_id = $1',
      [id]
    );
    
    const allocations = allocationsResult.rows;
    console.log(`📋 Found ${allocations.length} stored allocations for purchase order ${id}`);
    
    const serviceValidationTolerance = 0.0001;
    for (const poItem of poLineItems) {
      const normalizedPart = poItem.part_number ? String(poItem.part_number).trim().toUpperCase() : '';
      if (!normalizedPart) continue;
      const partType = partTypeMap.get(normalizedPart);
      if (partType === 'service') {
        const orderedQuantity = parseFloat(poItem.quantity) || 0;
        if (orderedQuantity <= 0) continue;
        const partAllocations = allocations.filter((a: any) => (a.part_number || '').toString().toUpperCase() === normalizedPart);
        const totalAllocated = partAllocations.reduce((sum: number, a: any) => sum + (parseFloat(a.allocate_qty) || 0), 0);
        const surplus = surplusPerPart[normalizedPart] || 0;
        if (totalAllocated + serviceValidationTolerance < orderedQuantity || surplus > serviceValidationTolerance) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'SERVICE_ALLOCATION_REQUIRED',
            message: `Service item ${normalizedPart} must be fully allocated to a sales order before closing this purchase order.`,
            details: {
              ordered_quantity: orderedQuantity,
              allocated_quantity: totalAllocated,
              surplus
            }
          });
        }
      }
    }

    // Validate allocations
    for (const poItem of poLineItems) {
      const partNumber = poItem.part_number.toString().trim().toUpperCase();
      const quantityOrdered = parseFloat(poItem.quantity);
      const surplus = surplusPerPart[partNumber] || 0;
      
      // Calculate total allocated for this part
      const partAllocations = allocations.filter((a: any) => a.part_number === partNumber);
      const totalAllocated = partAllocations.reduce((sum: number, a: any) => sum + parseFloat(a.allocate_qty), 0);
      
      // Validate total allocation + surplus doesn't exceed ordered quantity
      if (totalAllocated + surplus > quantityOrdered) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: `Total allocation (${totalAllocated}) + surplus (${surplus}) exceeds ordered quantity (${quantityOrdered}) for part ${partNumber}` 
        });
      }
    }
    
    // Process allocations
    for (const allocation of allocations) {
      const { sales_order_id, part_number, allocate_qty, part_id } = allocation as any;
      const allocateQty = parseFloat(allocate_qty);
      
      if (allocateQty <= 0) continue;
      
      // Update sales order line item - increase quantity_sold and decrease quantity_to_order
      const soLineItemResult = await client.query(
        'SELECT * FROM salesorderlineitems WHERE sales_order_id = $1 AND (part_id = $2 OR part_number = $3)',
        [sales_order_id, part_id || null, part_number]
      );
      
      if (soLineItemResult.rows.length > 0) {
        // Update existing line item - increase quantity_sold and decrease quantity_to_order
        const currentLineItem = soLineItemResult.rows[0];
        const currentQuantitySold = parseFloat(currentLineItem.quantity_sold) || 0;
        const currentQuantityToOrder = parseFloat(currentLineItem.quantity_to_order) || 0;
        
        // Calculate new values
        const newQuantitySold = currentQuantitySold + allocateQty;
        const newQuantityToOrder = Math.max(0, currentQuantityToOrder - allocateQty);
        
        // Use dynamic SQL to handle cases where quantity_to_order column might not exist yet
        const updateQuery = `
          UPDATE salesorderlineitems 
          SET quantity_sold = $1,
              quantity_committed = COALESCE(quantity_committed, 0) + $2,
              updated_at = CURRENT_TIMESTAMP
          ${currentLineItem.hasOwnProperty('quantity_to_order') ? ', quantity_to_order = $3' : ''}
          WHERE sales_order_id = $${currentLineItem.hasOwnProperty('quantity_to_order') ? '4' : '3'} AND (part_id = $${currentLineItem.hasOwnProperty('quantity_to_order') ? '5' : '4'} OR part_number = $${currentLineItem.hasOwnProperty('quantity_to_order') ? '6' : '5'})
        `;

        const updateParams = currentLineItem.hasOwnProperty('quantity_to_order') 
          ? [newQuantitySold, allocateQty, newQuantityToOrder, sales_order_id, part_id || null, part_number]
          : [newQuantitySold, allocateQty, sales_order_id, part_id || null, part_number];

        await client.query(updateQuery, updateParams);
        

        
        // Update sales_order_parts_to_order table - decrease quantity_needed
        if (newQuantityToOrder > 0) {
          // Update existing entry with reduced quantity
          await client.query(
            'UPDATE sales_order_parts_to_order SET quantity_needed = $1 WHERE sales_order_id = $2 AND part_number = $3',
            [newQuantityToOrder, sales_order_id, part_number]
          );
        } else {
          // Remove entry if no more quantity needed
          await client.query(
            'DELETE FROM sales_order_parts_to_order WHERE sales_order_id = $1 AND part_number = $2',
            [sales_order_id, part_number]
          );
        }
      } else {
        // Create new line item from parts to order
        // Get the part details from sales_order_parts_to_order table
        const partsToOrderResult = await client.query(
          'SELECT * FROM sales_order_parts_to_order WHERE sales_order_id = $1 AND part_number = $2',
          [sales_order_id, part_number]
        );
        
        let partDescription = allocation.part_description || '';
        let unit = 'Each';
        let unitPrice = 0;
        let lineAmount = 0;
        
        if (partsToOrderResult.rows.length > 0) {
          const partToOrder = partsToOrderResult.rows[0];
          partDescription = partToOrder.part_description || partDescription;
          unit = partToOrder.unit || unit;
          unitPrice = parseFloat(partToOrder.unit_price) || 0;
          lineAmount = allocateQty * unitPrice;
        }
        
        // Check if quantity_to_order column exists by trying to describe the table
        const tableInfo = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'salesorderlineitems' 
          AND column_name = 'quantity_to_order'
        `);
        
        const hasQuantityToOrder = tableInfo.rows.length > 0;
        
        // resolve part_id for canonical link
        let resolvedPartId: number | null = part_id || null;
        if (!resolvedPartId) {
          const invQ = await client.query('SELECT part_id FROM inventory WHERE part_number = $1', [part_number]);
          resolvedPartId = invQ.rows[0]?.part_id || null;
        }

        const insertQuery = `
          INSERT INTO salesorderlineitems 
          (sales_order_id, part_number, part_description, quantity_sold, quantity_committed, unit, unit_price, line_amount${hasQuantityToOrder ? ', quantity_to_order' : ''}, part_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8${hasQuantityToOrder ? ', 0' : ''}, $9)
        `;

        const insertParams = [sales_order_id, part_number, partDescription, allocateQty, allocateQty, unit, unitPrice, lineAmount, resolvedPartId];

        await client.query(insertQuery, insertParams);
        
        console.log(`✅ Created new line item for sales order ${sales_order_id}, part ${part_number}: quantity_sold=${allocateQty}, unit_price=${unitPrice}, line_amount=${lineAmount}`);
        
        // Update sales_order_parts_to_order table - decrease quantity_needed for the newly created line item
        if (partsToOrderResult.rows.length > 0) {
          const partToOrder = partsToOrderResult.rows[0];
          const currentQuantityNeeded = parseFloat(partToOrder.quantity_needed) || 0;
          const newQuantityNeeded = Math.max(0, currentQuantityNeeded - allocateQty);
          
          if (newQuantityNeeded > 0) {
            // Update existing entry with reduced quantity
            await client.query(
              'UPDATE sales_order_parts_to_order SET quantity_needed = $1 WHERE sales_order_id = $2 AND part_number = $3',
              [newQuantityNeeded, sales_order_id, part_number]
            );
            console.log(`📝 Updated parts to order for sales order ${sales_order_id}, part ${part_number}: quantity_needed reduced from ${currentQuantityNeeded} to ${newQuantityNeeded}`);
          } else {
            // Remove entry if no more quantity needed
            await client.query(
              'DELETE FROM sales_order_parts_to_order WHERE sales_order_id = $1 AND part_number = $2',
              [sales_order_id, part_number]
            );
            console.log(`🗑️ Removed parts to order entry for sales order ${sales_order_id}, part ${part_number} (no more quantity needed)`);
          }
        }
      }
    }
    
    // Process inventory updates - only add surplus to inventory, not allocated parts
    console.log('🔄 Processing inventory updates:');
    
    // Calculate total allocated per part
    const totalAllocatedPerPart = new Map<string, number>();
    for (const allocation of allocations) {
      const { part_number, allocate_qty } = allocation;
      const allocateQty = parseFloat(allocate_qty);
      const partNumber = part_number.toString().trim().toUpperCase();
      
      if (allocateQty > 0) {
        totalAllocatedPerPart.set(partNumber, (totalAllocatedPerPart.get(partNumber) || 0) + allocateQty);
      }
    }
    
    // Process each part from the purchase order
    for (const poItem of poLineItems) {
      const partNumber = poItem.part_number.toString().trim().toUpperCase();
      const partType = partTypeMap.get(partNumber);
      const quantityOrdered = parseFloat(poItem.quantity);
      const totalAllocated = totalAllocatedPerPart.get(partNumber) || 0;
      const surplus = surplusPerPart[partNumber] || 0;
      
      console.log(`📊 Part ${partNumber}: Ordered=${quantityOrdered}, Allocated=${totalAllocated}, Surplus=${surplus}`);

      if (partType === 'service') {
        if (surplus > 0) {
          console.warn(`Service part ${partNumber} reported a surplus of ${surplus}, skipping inventory update.`);
        } else {
          console.log(`Service part ${partNumber} fully allocated; skipping inventory update.`);
        }
        continue;
      }

      // Only add surplus to inventory (allocated parts go directly to sales orders, not to inventory)
      if (surplus > 0) {
        const unitCost = parseFloat(poItem.unit_cost);

        console.log(`📈 Increasing inventory for part ${partNumber} by ${surplus} (surplus from PO)`);
        await client.query(
          `INSERT INTO inventory (part_number, part_description, unit, last_unit_cost, quantity_on_hand)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (part_number)
           DO UPDATE SET
             quantity_on_hand = COALESCE(CAST(inventory.quantity_on_hand AS NUMERIC), 0) + CAST($5 AS NUMERIC),
             last_unit_cost = $4,
             part_description = $2,
             unit = $3`,
          [partNumber, poItem.part_description, poItem.unit, unitCost, surplus]
        );
      } else {
        console.log(`ℹ️ No surplus for part ${partNumber} - no inventory increase needed`);
      }
    }

    // Update aggregated parts to order table
    await updateAggregatedPartsToOrder(poLineItems, client);
    
    // Automatically recalculate sales order totals for all affected sales orders
    // This ensures that summary stats (subtotal, GST, total) are updated to reflect
    // the newly allocated parts, including any LABOUR/OVERHEAD/SUPPLY calculations
    console.log('🔄 Recalculating sales order totals for affected sales orders...');
    const affectedSalesOrderIds = new Set<number>(
      allocations
        .map((a: any) => Number(a.sales_order_id))
        .filter((id): id is number => Number.isFinite(id))
    );
    
    for (const salesOrderId of affectedSalesOrderIds) {
      try {
        console.log(`📊 Recalculating totals for sales order ${salesOrderId}...`);
        await salesOrderService.recalculateAndUpdateSummary(salesOrderId, client);
        console.log(`✅ Sales order ${salesOrderId} totals recalculated successfully`);
      } catch (error) {
        console.warn(`⚠️ Failed to recalculate totals for sales order ${salesOrderId}:`, error);
        // Don't fail the entire operation if one sales order recalculation fails
      }
    }
    
    // Close the purchase order (use existing bill_number from purchase order)
    await client.query(
      'UPDATE purchasehistory SET status = $1, updated_at = NOW() WHERE purchase_id = $2',
      ['Closed', id]
    );
    
    await client.query('COMMIT');
    
    console.log('✅ Purchase order allocation completed successfully');
    console.log(`📊 Summary: ${allocations.length} allocations processed, ${Object.keys(surplusPerPart).length} surplus parts processed`);
    
    res.json({
      message: 'Purchase order closed successfully with allocations',
      purchase_order_id: id,
      allocations_processed: allocations.length,
      surplus_processed: Object.keys(surplusPerPart).length
    });

  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error closing purchase order with allocations:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  } finally {
    client.release();
  }
});

// Save allocations without closing purchase order
router.post('/:id/save-allocations', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { allocations, surplusPerPart } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get purchase order details
    const poResult = await client.query(
      'SELECT * FROM purchasehistory WHERE purchase_id = $1 FOR UPDATE',
      [id]
    );
    
    if (poResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    
    const purchaseOrder = poResult.rows[0];
    
    if (purchaseOrder.status === 'Closed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Purchase order is already closed' });
    }
    
    // Get purchase order line items
    const poLineItemsResult = await client.query(
      'SELECT * FROM purchaselineitems WHERE purchase_id = $1',
      [id]
    );
    
    const poLineItems = poLineItemsResult.rows;
    
    // Validate allocations
    for (const poItem of poLineItems) {
      const partNumber = poItem.part_number.toString().trim().toUpperCase();
      const quantityOrdered = parseFloat(poItem.quantity);
      const surplus = surplusPerPart[partNumber] || 0;
      
      // Calculate total allocated for this part
      const partAllocations = allocations.filter((a: any) => a.part_number === partNumber);
      const totalAllocated = partAllocations.reduce((sum: number, a: any) => sum + parseFloat(a.allocate_qty), 0);
      
      // Validate total allocation + surplus doesn't exceed ordered quantity
      if (totalAllocated + surplus > quantityOrdered) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: `Total allocation (${totalAllocated}) + surplus (${surplus}) exceeds ordered quantity (${quantityOrdered}) for part ${partNumber}` 
        });
      }
    }
    
    // Store allocation data without making any changes to sales orders or inventory
    // These are just commitments/plans until the purchase order is actually received and closed
    console.log('💾 Storing allocation commitments (no changes to sales orders or inventory yet):', allocations);
    
    // Clear any existing allocations for this purchase order
    await client.query('DELETE FROM purchase_order_allocations WHERE purchase_id = $1', [id]);
    
    // Store the new allocations (resolve and include part_id; align with columns: allocation_id, purchase_id, sales_order_id, part_number, part_description, allocate_qty, created_at, updated_at, part_id)
    for (const allocation of allocations) {
      const { sales_order_id, part_number, allocate_qty, part_description } = allocation || {};
      const allocateQty = parseFloat(allocate_qty);

      if (!(part_number && sales_order_id)) continue;

      // Resolve part_id by normalized part_number
      const normalized = String(part_number).trim().toUpperCase();
      const invQ = await client.query(
        `SELECT part_id FROM inventory WHERE REPLACE(REPLACE(UPPER(part_number), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER($1), '-', ''), ' ', '')`,
        [normalized]
      );
      const resolvedPartId = invQ.rows[0]?.part_id || null;

      if (allocateQty > 0) {
        await client.query(
          `INSERT INTO purchase_order_allocations 
           (purchase_id, sales_order_id, part_number, part_description, allocate_qty, created_at, updated_at, part_id) 
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $6)`,
          [id, sales_order_id, part_number, part_description || '', allocateQty, resolvedPartId]
        );
        console.log(`💾 Stored allocation: ${allocateQty} of ${part_number} (part_id=${resolvedPartId}) to sales order ${sales_order_id}`);
      }
    }
    
    // Note: We don't update inventory here because the purchase order hasn't been received yet
    // Allocations are just commitments - inventory will be updated when the PO is closed
    console.log('🔄 Allocations saved (no inventory changes until PO is closed):', allocations);
    
    // Update aggregated parts to order table
    await updateAggregatedPartsToOrder(poLineItems, client);
    
    // Note: We don't close the purchase order here, just save the allocations
    // Note: No sales order recalculation needed here since we're only storing allocation commitments
    // Sales order totals will be recalculated when "Close with Allocations" is used
    
    await client.query('COMMIT');
    
    res.json({ 
      message: 'Allocations saved successfully',
      purchase_order_id: id,
      allocations_processed: allocations.length
    });
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error saving allocations:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  } finally {
    client.release();
  }
});

// Get stored allocations for a purchase order
router.get('/:id/allocations', async (req: Request, res: Response) => {
  const { id } = req.params;
  
  try {
    const allocationsResult = await pool.query(
      'SELECT * FROM purchase_order_allocations WHERE purchase_id = $1 ORDER BY created_at',
      [id]
    );
    
    res.json(allocationsResult.rows);
  } catch (error: any) {
    console.error('Error fetching allocations:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

export default router; 

import express, { Request, Response } from 'express';
import { pool } from '../db';
import PDFDocument from 'pdfkit';
import multer from 'multer';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { canonicalizeName } from '../lib/normalize';

const router = express.Router();

const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const excelUpload = multer({
  dest: uploadsDir,
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ];
    if (allowedMimeTypes.includes(file.mimetype) || /\.(xlsx|xls)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  }
});

const headerMap: Record<string, string> = {
  name: 'customer_name',
  customer: 'customer_name',
  customer_name: 'customer_name',
  contact: 'contact_person',
  contact_person: 'contact_person',
  contactname: 'contact_person',
  contact_name: 'contact_person',
  phone: 'phone_number',
  phone_number: 'phone_number',
  telephone: 'phone_number',
  telephone_number: 'phone_number',
  phone_no: 'phone_number',
  address: 'street_address',
  street: 'street_address',
  street_address: 'street_address',
  city: 'city',
  province: 'province',
  state: 'province',
  region: 'province',
  country: 'country',
  postal: 'postal_code',
  postal_code: 'postal_code',
  zip: 'postal_code',
  zip_code: 'postal_code',
  website: 'website',
  notes: 'general_notes',
  note: 'general_notes',
  general_notes: 'general_notes'
};

const normalizeHeader = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');

const normalizeCell = (value: unknown): string => {
  if (value == null) return '';
  return value.toString().trim();
};

// DB column limits (keep in sync with migrations)
const MAX_PHONE_LENGTH = 50;
const MAX_NOTES_LENGTH = 1000; // general_notes is TEXT in most schemas, but cap to avoid oversized input

// Downloadable Excel template to guide imports
router.get('/import-excel/template', (_req: Request, res: Response) => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['customer_name', 'contact_person', 'email', 'phone_number', 'street_address', 'city', 'province', 'country', 'postal_code', 'website', 'general_notes'],
    ['Acme Corp', 'Jane Smith', 'jane.smith@acme.com', '555-123-4567', '123 Main St', 'Toronto', 'ON', 'Canada', 'M5H 2N2', 'https://acme.com', 'Preferred partner'],
    ['Beta Industries', 'John Doe', 'john.doe@beta.io', '555-987-6543', '456 Market Ave', 'Vancouver', 'BC', 'Canada', 'V5K 0A1', 'https://beta.io', '']
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Customers');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="customer_import_template.xlsx"');
  res.send(buffer);
});

// Bulk import customers from Excel
router.post('/import-excel', excelUpload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No Excel file uploaded' });
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const createdCustomers: any[] = [];
  const updatedCustomers: any[] = [];
  let rawRows: Record<string, unknown>[] = [];

  try {
    const workbook = XLSX.readFile(req.file.path);
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return res.status(400).json({ error: 'Excel file does not contain any sheets', errors: ['No worksheets found'] });
    }
    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet) {
      return res.status(400).json({ error: 'Unable to read the first worksheet in the Excel file' });
    }
    rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

    if (rawRows.length === 0) {
      return res.status(400).json({ error: 'Excel file is empty', errors: ['No data rows found'] });
    }

    const normalizedRows: Array<{
      rowNumber: number;
      customer_name: string;
      canonicalName: string;
      street_address?: string;
      city?: string;
      province?: string;
      country?: string;
      postal_code?: string;
      contact_person?: string;
      phone_number?: string;
      email?: string;
      website?: string;
      general_notes?: string;
    }> = [];

    const seenCanonicalNames = new Set<string>();

    rawRows.forEach((row, index) => {
      const rowNumber = index + 2; // account for header row
      const normalizedRow: Record<string, unknown> = {};

      Object.entries(row).forEach(([key, value]) => {
        const mappedKey = headerMap[normalizeHeader(key)] || normalizeHeader(key);
        if (mappedKey) {
          normalizedRow[mappedKey] = value;
        }
      });

      const nameValue = normalizeCell(normalizedRow.customer_name);
      if (!nameValue) {
        errors.push(`Row ${rowNumber}: customer_name is required; row skipped`);
        return;
      }

      const canonicalName = canonicalizeName(nameValue);
      if (!canonicalName) {
        errors.push(`Row ${rowNumber}: customer_name is not valid after normalization; row skipped`);
        return;
      }

      if (seenCanonicalNames.has(canonicalName)) {
        warnings.push(`Row ${rowNumber}: "${nameValue}" skipped because the same name appears multiple times in the file`);
        return;
      }

      seenCanonicalNames.add(canonicalName);

      normalizedRows.push({
        rowNumber,
        customer_name: nameValue,
        canonicalName,
        street_address: normalizeCell(normalizedRow.street_address),
        city: normalizeCell(normalizedRow.city),
        province: normalizeCell(normalizedRow.province),
        country: normalizeCell(normalizedRow.country),
        postal_code: normalizeCell(normalizedRow.postal_code),
        contact_person: normalizeCell(normalizedRow.contact_person),
        phone_number: (() => {
          const phoneRaw = normalizeCell(normalizedRow.phone_number || normalizedRow.telephone_number);
          if (phoneRaw.length > MAX_PHONE_LENGTH) {
            warnings.push(`Row ${rowNumber}: phone truncated to ${MAX_PHONE_LENGTH} characters`);
            return phoneRaw.slice(0, MAX_PHONE_LENGTH);
          }
          return phoneRaw;
        })(),
        email: normalizeCell(normalizedRow.email),
        website: normalizeCell(normalizedRow.website),
        general_notes: (() => {
          const notesRaw = normalizeCell(normalizedRow.general_notes || normalizedRow.notes || normalizedRow.note);
          if (notesRaw.length > MAX_NOTES_LENGTH) {
            warnings.push(`Row ${rowNumber}: notes truncated to ${MAX_NOTES_LENGTH} characters`);
            return notesRaw.slice(0, MAX_NOTES_LENGTH);
          }
          return notesRaw;
        })(),
      });
    });

    if (normalizedRows.length === 0) {
      return res.status(400).json({
        error: 'No valid rows to import',
        errors,
        warnings,
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const row of normalizedRows) {
        const existing = await client.query(
          'SELECT customer_id, customer_name, telephone_number, general_notes FROM customermaster WHERE canonical_name = $1',
          [row.canonicalName]
        );

        if (existing.rows.length > 0) {
          const phoneProvided = !!row.phone_number;
          const notesProvided = !!row.general_notes;

          if (!phoneProvided && !notesProvided) {
            warnings.push(`Row ${row.rowNumber}: "${row.customer_name}" skipped because "${existing.rows[0].customer_name}" already exists and no new phone/general notes were provided`);
            continue;
          }

          const updateFields: string[] = [];
          const params: any[] = [];
          let idx = 1;

          if (phoneProvided) {
            updateFields.push(`telephone_number = $${idx++}`);
            params.push(row.phone_number);
          }
          if (notesProvided) {
            updateFields.push(`general_notes = $${idx++}`);
            params.push(row.general_notes);
          }

          params.push(existing.rows[0].customer_id);

          const updatedResult = await client.query(
            `UPDATE customermaster SET ${updateFields.join(', ')} WHERE customer_id = $${idx} RETURNING *`,
            params
          );

          const updated = updatedResult.rows[0];
          const { canonical_name: _c, ...customerFields } = updated;
          updatedCustomers.push({
            ...customerFields,
            phone_number: updated.telephone_number,
            id: updated.customer_id
          });
          continue;
        }

        const insertResult = await client.query(
          'INSERT INTO customermaster (customer_name, canonical_name, street_address, city, province, country, postal_code, contact_person, telephone_number, email, website, general_notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *',
          [
            row.customer_name,
            row.canonicalName,
            row.street_address || null,
            row.city || null,
            row.province || null,
            row.country || null,
            row.postal_code || null,
            row.contact_person || null,
            row.phone_number || null,
            row.email || null,
            row.website || null,
            row.general_notes || null
          ]
        );

        const saved = insertResult.rows[0];
        const { canonical_name: _c, ...customerFields } = saved;
        createdCustomers.push({
          ...customerFields,
          phone_number: saved.telephone_number,
          id: saved.customer_id
        });
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('customerRoutes: Error during Excel import transaction:', err);
      return res.status(500).json({ error: 'Failed to import customers', details: (err as Error).message });
    } finally {
      client.release();
    }

    res.json({
      message: 'Customer import completed',
      summary: {
        totalRows: rawRows.length,
        acceptedRows: normalizedRows.length,
        created: createdCustomers.length,
        updated: updatedCustomers.length,
        skipped: normalizedRows.length - createdCustomers.length - updatedCustomers.length,
        errors: errors.length,
        warnings: warnings.length
      },
      warnings,
      errors,
      createdCustomers,
      updatedCustomers
    });
  } catch (err) {
    console.error('customerRoutes: Error processing Excel file:', err);
    res.status(500).json({ error: 'Internal server error while processing Excel file', details: (err as Error).message });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});

// Get all customers
router.get('/', async (req: Request, res: Response) => {
  console.log('customerRoutes: GET / - fetching all customers');
  try {
    const result = await pool.query('SELECT customer_id, customer_name, street_address, city, province, country, postal_code, contact_person, telephone_number, email, website, general_notes, default_payment_terms_in_days FROM customermaster');
    // Add 'id' field to match frontend expectations
    const customersWithId = result.rows.map(customer => ({
      ...customer,
      id: customer.customer_id
    }));
    console.log('customerRoutes: GET / - returning', customersWithId.length, 'customers');
    res.json(customersWithId);
  } catch (err) {
    console.error('customerRoutes: Error fetching customers:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export customers to PDF
router.get('/export/pdf', async (req: Request, res: Response) => {
  console.log('Customer PDF export endpoint hit');
  try {
    const result = await pool.query('SELECT customer_id, customer_name, street_address, city, province, country, postal_code, contact_person, telephone_number, email, website, general_notes FROM customermaster ORDER BY customer_name ASC');
    const customers = result.rows;

    const doc = new PDFDocument({ margin: 50 });
    const filename = `customers_${new Date().toISOString().split('T')[0]}.pdf`;
    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    // Header
    doc.font('Helvetica-Bold').fontSize(20).text('Customer List', { align: 'center' });
    doc.moveDown();
    doc.font('Helvetica').fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(2);

    // Table headers
    const headers = ['Customer Name', 'Contact Person', 'Email', 'Phone', 'Address'];
    const columnWidths = [120, 100, 120, 80, 150];
    let y = doc.y;

    // Draw header row
    doc.font('Helvetica-Bold').fontSize(10);
    let x = 50;
    headers.forEach((header, index) => {
      doc.text(header, x, y, { width: columnWidths[index] });
      x += columnWidths[index];
    });

    y += 20;
    doc.moveTo(50, y).lineTo(520, y).stroke();

    // Draw data rows
    doc.font('Helvetica').fontSize(9);
    customers.forEach((customer, index) => {
      if (y > doc.page.height - 100) {
        doc.addPage();
        y = 50;
      }

      x = 50;
      doc.text(customer.customer_name || '', x, y, { width: columnWidths[0] });
      x += columnWidths[0];
      doc.text(customer.contact_person || '', x, y, { width: columnWidths[1] });
      x += columnWidths[1];
      doc.text(customer.email || '', x, y, { width: columnWidths[2] });
      x += columnWidths[2];
      doc.text(customer.telephone_number || '', x, y, { width: columnWidths[3] });
      x += columnWidths[3];
      
      const address = [
        customer.street_address,
        customer.city,
        customer.province,
        customer.country
      ].filter(Boolean).join(', ');
      doc.text(address, x, y, { width: columnWidths[4] });

      y += 15;
      
      // Draw row separator
      doc.moveTo(50, y).lineTo(520, y).stroke();
      y += 5;
    });

    doc.end();
  } catch (err) {
    const error = err as Error;
    console.error('customerRoutes: Error generating PDF:', error);
    res.status(500).json({ error: 'Internal server error during PDF generation', details: error.message, stack: error.stack });
  }
});

router.get('/:id/vehicle-history', async (req: Request, res: Response) => {
  const customerId = Number(req.params.id);
  if (!Number.isFinite(customerId)) {
    return res.status(400).json({ error: 'Invalid customer id' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `
        SELECT source, source_id, reference_number, activity_date, record_date,
               vin_number, unit_number, vehicle_make, vehicle_model, mileage,
               product_name, product_description
        FROM (
          SELECT
            'invoice' AS source,
            i.invoice_id AS source_id,
            i.invoice_number AS reference_number,
            COALESCE(i.invoice_date, i.updated_at, NOW()) AS activity_date,
            i.invoice_date AS record_date,
            i.vin_number,
            i.unit_number,
            i.vehicle_make,
            i.vehicle_model,
            i.mileage,
            i.product_name,
            i.product_description
          FROM invoices i
          WHERE i.customer_id = $1
          UNION ALL
          SELECT
            'sales_order' AS source,
            soh.sales_order_id AS source_id,
            soh.sales_order_number AS reference_number,
            COALESCE(soh.sales_date, soh.updated_at, soh.created_at, NOW()) AS activity_date,
            soh.sales_date AS record_date,
            soh.vin_number,
            soh.unit_number,
            soh.vehicle_make,
            soh.vehicle_model,
            soh.mileage,
            soh.product_name,
            soh.product_description
          FROM salesorderhistory soh
          WHERE soh.customer_id = $1
        ) combined
        ORDER BY activity_date DESC NULLS LAST, source_id DESC
        LIMIT 500
      `,
      [customerId]
    );

    const records = result.rows.map((row) => ({
      ...row,
      activity_date: row.activity_date ? new Date(row.activity_date).toISOString() : null,
      record_date: row.record_date ? new Date(row.record_date).toISOString() : null,
    }));

    res.json({ records });
  } catch (err) {
    console.error('customerRoutes: failed to fetch vehicle history', err);
    res.status(500).json({ error: 'Failed to load vehicle history for customer' });
  } finally {
    client.release();
  }
});

// Get a specific customer by ID
router.get('/:id', async (req: Request, res: Response) => {
  console.log('customerRoutes: GET /:id - fetching customer', req.params.id);
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM customermaster WHERE customer_id = $1', [id]);
    if (result.rows.length === 0) {
      console.log('customerRoutes: GET /:id - customer not found');
      return res.status(404).json({ error: 'Customer not found' });
    }
    // Add 'id' field to match frontend expectations
    const { canonical_name, ...customerFields } = result.rows[0];
    const customer = {
      ...customerFields,
      id: result.rows[0].customer_id
    };
    console.log('customerRoutes: GET /:id - returning customer', customer);
    res.json(customer);
  } catch (err) {
    console.error('customerRoutes: Error fetching customer:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new customer
router.post('/', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { customer_name, street_address, city, province, country, postal_code, contact_person, phone_number, email, website, general_notes, default_payment_terms_in_days } = req.body;

    console.log('Received new customer data:', req.body);

    // Validate required fields
    const trimmedCustomerName = customer_name ? customer_name.toString().trim() : '';
    if (!trimmedCustomerName) {
      return res.status(400).json({ error: 'Customer name is required' });
    }

    const canonicalName = canonicalizeName(trimmedCustomerName);
    const paymentTerms = Number.isFinite(Number(default_payment_terms_in_days))
      ? Number(default_payment_terms_in_days)
      : 30;

    // Check if customer with same name already exists
    const existingCustomer = await client.query(
      'SELECT customer_id, customer_name FROM customermaster WHERE canonical_name = $1',
      [canonicalName]
    );

    if (existingCustomer.rows.length > 0) {
      return res.status(409).json({
        error: 'Customer already exists',
        message: `A customer with the name "${existingCustomer.rows[0].customer_name}" already exists`,
        existingCustomerId: existingCustomer.rows[0].customer_id
      });
    }

    const result = await client.query(
      'INSERT INTO customermaster (customer_name, canonical_name, street_address, city, province, country, postal_code, contact_person, telephone_number, email, website, general_notes, default_payment_terms_in_days) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *',
      [
        trimmedCustomerName,
        canonicalName,
        street_address ?? null,
        city ?? null,
        province ?? null,
        country ?? null,
        postal_code ?? null,
        contact_person ?? null,
        phone_number ?? null,
        email ?? null,
        website ?? null,
        general_notes ?? null,
        paymentTerms
      ]
    );

    const newCustomer = result.rows[0];
    const { canonical_name: _canonicalName, ...customerFields } = newCustomer;
    const customerWithId = {
      ...customerFields,
      id: newCustomer.customer_id
    };
    
    console.log('Customer created successfully:', customerWithId);
    res.status(201).json(customerWithId);
  } catch (err: any) {
    console.error('Error creating customer:', err);
    
    // Handle specific database errors
    if (err.code === '23505') { // Unique constraint violation
      if (err.constraint?.includes('customer_id')) {
        console.error('Sequence issue detected - customer_id sequence may be out of sync');
        res.status(500).json({ 
          error: 'Database sequence error',
          message: 'Customer ID sequence is out of sync. Please contact system administrator.',
          details: 'This is a database configuration issue that needs to be resolved.'
        });
      } else {
        res.status(409).json({ 
          error: 'Duplicate entry',
          message: 'A customer with this information already exists'
        });
      }
    } else if (err.code === '23502') { // Not null violation
      res.status(400).json({ 
        error: 'Missing required field',
        message: 'Please fill in all required fields'
      });
    } else {
      res.status(500).json({ 
        error: 'Internal server error',
        message: 'Failed to create customer. Please try again.'
      });
    }
  } finally {
    client.release();
  }
});

// Update a customer by ID
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { customer_name, street_address, city, province, country, postal_code, contact_person, phone_number, email, website, general_notes, default_payment_terms_in_days } = req.body;

  const client = await pool.connect();

  // Build the update query dynamically based on provided fields
  const updateFields = [];
  const queryParams = [];
  let paramIndex = 1;

  let trimmedNameForUpdate: string | undefined;
  let canonicalNameForUpdate: string | undefined;

  if (customer_name !== undefined) {
    trimmedNameForUpdate = customer_name ? customer_name.toString().trim() : '';
    if (!trimmedNameForUpdate) {
      return res.status(400).json({ error: 'Customer name is required' });
    }

    canonicalNameForUpdate = canonicalizeName(trimmedNameForUpdate);

    const duplicateCheck = await pool.query(
      'SELECT customer_id FROM customermaster WHERE canonical_name = $1 AND customer_id <> $2',
      [canonicalNameForUpdate, id]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Customer already exists with a similar name' });
    }

    updateFields.push(`customer_name = $${paramIndex++}`);
    queryParams.push(trimmedNameForUpdate);
    updateFields.push(`canonical_name = $${paramIndex++}`);
    queryParams.push(canonicalNameForUpdate);
  }

  if (street_address !== undefined) { updateFields.push(`street_address = $${paramIndex++}`); queryParams.push(street_address); }
  if (city !== undefined) { updateFields.push(`city = $${paramIndex++}`); queryParams.push(city); }
  if (province !== undefined) { updateFields.push(`province = $${paramIndex++}`); queryParams.push(province); }
  if (country !== undefined) { updateFields.push(`country = $${paramIndex++}`); queryParams.push(country); }
  if (postal_code !== undefined) { updateFields.push(`postal_code = $${paramIndex++}`); queryParams.push(postal_code); }
  if (contact_person !== undefined) { updateFields.push(`contact_person = $${paramIndex++}`); queryParams.push(contact_person); }
  if (phone_number !== undefined) { updateFields.push(`telephone_number = $${paramIndex++}`); queryParams.push(phone_number); }
  if (email !== undefined) { updateFields.push(`email = $${paramIndex++}`); queryParams.push(email); }
  if (website !== undefined) { updateFields.push(`website = $${paramIndex++}`); queryParams.push(website); }
  if (general_notes !== undefined) { updateFields.push(`general_notes = $${paramIndex++}`); queryParams.push(general_notes); }
  if (default_payment_terms_in_days !== undefined) {
    const termsVal = Number.isFinite(Number(default_payment_terms_in_days))
      ? Number(default_payment_terms_in_days)
      : 30;
    updateFields.push(`default_payment_terms_in_days = $${paramIndex++}`);
    queryParams.push(termsVal);
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ error: 'No update fields provided' });
  }

  // Add the customerId to the query parameters for the WHERE clause
  queryParams.push(id);

  const query = `UPDATE customermaster SET ${updateFields.join(', ')} WHERE customer_id = $${paramIndex} RETURNING *;`;

  try {
    const result = await client.query(query, queryParams);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const { canonical_name: _canonicalNameUpdate, ...updatedFields } = result.rows[0];
    const updatedCustomer = {
      ...updatedFields,
      id: result.rows[0].customer_id
    };

    res.json(updatedCustomer);

  } catch (err) {
    console.error(`Error updating customer ${id}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete a customer by ID
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    const result = await client.query(
      'DELETE FROM customermaster WHERE customer_id = $1 RETURNING *;',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({ message: 'Customer deleted successfully', deletedCustomer: result.rows[0] });

  } catch (err) {
    console.error(`Error deleting customer ${id}:`, err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// =========================
// Customer contact endpoints
// =========================

// List contacts (people, emails, phones) for a customer
router.get('/:id/contacts', async (req: Request, res: Response) => {
  const customerId = Number(req.params.id);
  if (!Number.isFinite(customerId)) return res.status(400).json({ error: 'Invalid customer id' });
  try {
    const [people, emails, phones] = await Promise.all([
      pool.query('SELECT * FROM customer_contact_people WHERE customer_id = $1 ORDER BY is_preferred DESC, name ASC', [customerId]),
      pool.query('SELECT * FROM customer_emails WHERE customer_id = $1 ORDER BY is_preferred DESC, email ASC', [customerId]),
      pool.query('SELECT * FROM customer_phones WHERE customer_id = $1 ORDER BY is_preferred DESC, label NULLS LAST, phone ASC', [customerId]),
    ]);
    res.json({ people: people.rows, emails: emails.rows, phones: phones.rows });
  } catch (err) {
    console.error('customerRoutes: list contacts error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add contact person
router.post('/:id/contacts/people', async (req: Request, res: Response) => {
  const customerId = Number(req.params.id);
  const { name, is_preferred } = req.body || {};
  if (!Number.isFinite(customerId)) return res.status(400).json({ error: 'Invalid customer id' });
  if (!name || String(name).trim() === '') return res.status(400).json({ error: 'name is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_preferred === true) {
      await client.query('UPDATE customer_contact_people SET is_preferred = FALSE WHERE customer_id = $1', [customerId]);
    }
    const q = await client.query('INSERT INTO customer_contact_people (customer_id, name, is_preferred) VALUES ($1,$2,COALESCE($3,false)) RETURNING *', [customerId, String(name).trim(), !!is_preferred]);
    await client.query('COMMIT');
    res.status(201).json(q.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('customerRoutes: add contact person error', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update contact person
router.put('/:id/contacts/people/:personId', async (req: Request, res: Response) => {
  const customerId = Number(req.params.id);
  const personId = Number(req.params.personId);
  const { name, is_preferred } = req.body || {};
  if (!Number.isFinite(customerId) || !Number.isFinite(personId)) return res.status(400).json({ error: 'Invalid id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_preferred === true) {
      await client.query('UPDATE customer_contact_people SET is_preferred = FALSE WHERE customer_id = $1', [customerId]);
    }
    const q = await client.query('UPDATE customer_contact_people SET name = COALESCE($1, name), is_preferred = COALESCE($2, is_preferred) WHERE id = $3 AND customer_id = $4 RETURNING *', [name ? String(name).trim() : null, is_preferred, personId, customerId]);
    if (q.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    await client.query('COMMIT');
    res.json(q.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('customerRoutes: update contact person error', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete contact person
router.delete('/:id/contacts/people/:personId', async (req: Request, res: Response) => {
  const customerId = Number(req.params.id);
  const personId = Number(req.params.personId);
  if (!Number.isFinite(customerId) || !Number.isFinite(personId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const q = await pool.query('DELETE FROM customer_contact_people WHERE id = $1 AND customer_id = $2', [personId, customerId]);
    res.json({ ok: true, deleted: q.rowCount });
  } catch (err) {
    console.error('customerRoutes: delete contact person error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add email
router.post('/:id/contacts/emails', async (req: Request, res: Response) => {
  const customerId = Number(req.params.id);
  const { email, is_preferred } = req.body || {};
  if (!Number.isFinite(customerId)) return res.status(400).json({ error: 'Invalid customer id' });
  if (!email || String(email).trim() === '') return res.status(400).json({ error: 'email is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_preferred === true) {
      await client.query('UPDATE customer_emails SET is_preferred = FALSE WHERE customer_id = $1', [customerId]);
    }
    const q = await client.query('INSERT INTO customer_emails (customer_id, email, is_preferred) VALUES ($1,$2,COALESCE($3,false)) ON CONFLICT (customer_id, email) DO UPDATE SET is_preferred = EXCLUDED.is_preferred RETURNING *', [customerId, String(email).trim(), !!is_preferred]);
    await client.query('COMMIT');
    res.status(201).json(q.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('customerRoutes: add email error', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update email
router.put('/:id/contacts/emails/:emailId', async (req: Request, res: Response) => {
  const customerId = Number(req.params.id);
  const emailId = Number(req.params.emailId);
  const { email, is_preferred } = req.body || {};
  if (!Number.isFinite(customerId) || !Number.isFinite(emailId)) return res.status(400).json({ error: 'Invalid id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_preferred === true) {
      await client.query('UPDATE customer_emails SET is_preferred = FALSE WHERE customer_id = $1', [customerId]);
    }
    const q = await client.query('UPDATE customer_emails SET email = COALESCE($1, email), is_preferred = COALESCE($2, is_preferred) WHERE id = $3 AND customer_id = $4 RETURNING *', [email ? String(email).trim() : null, is_preferred, emailId, customerId]);
    if (q.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    await client.query('COMMIT');
    res.json(q.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('customerRoutes: update email error', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete email
router.delete('/:id/contacts/emails/:emailId', async (req: Request, res: Response) => {
  const customerId = Number(req.params.id);
  const emailId = Number(req.params.emailId);
  if (!Number.isFinite(customerId) || !Number.isFinite(emailId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const q = await pool.query('DELETE FROM customer_emails WHERE id = $1 AND customer_id = $2', [emailId, customerId]);
    res.json({ ok: true, deleted: q.rowCount });
  } catch (err) {
    console.error('customerRoutes: delete email error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add phone
router.post('/:id/contacts/phones', async (req: Request, res: Response) => {
  const customerId = Number(req.params.id);
  const { phone, label, is_preferred } = req.body || {};
  if (!Number.isFinite(customerId)) return res.status(400).json({ error: 'Invalid customer id' });
  if (!phone || String(phone).trim() === '') return res.status(400).json({ error: 'phone is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_preferred === true) {
      await client.query('UPDATE customer_phones SET is_preferred = FALSE WHERE customer_id = $1', [customerId]);
    }
    const q = await client.query('INSERT INTO customer_phones (customer_id, phone, label, is_preferred) VALUES ($1,$2,$3,COALESCE($4,false)) ON CONFLICT (customer_id, phone) DO UPDATE SET label = EXCLUDED.label, is_preferred = EXCLUDED.is_preferred RETURNING *', [customerId, String(phone).trim(), label || null, !!is_preferred]);
    await client.query('COMMIT');
    res.status(201).json(q.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('customerRoutes: add phone error', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update phone
router.put('/:id/contacts/phones/:phoneId', async (req: Request, res: Response) => {
  const customerId = Number(req.params.id);
  const phoneId = Number(req.params.phoneId);
  const { phone, label, is_preferred } = req.body || {};
  if (!Number.isFinite(customerId) || !Number.isFinite(phoneId)) return res.status(400).json({ error: 'Invalid id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_preferred === true) {
      await client.query('UPDATE customer_phones SET is_preferred = FALSE WHERE customer_id = $1', [customerId]);
    }
    const q = await client.query('UPDATE customer_phones SET phone = COALESCE($1, phone), label = COALESCE($2, label), is_preferred = COALESCE($3, is_preferred) WHERE id = $4 AND customer_id = $5 RETURNING *', [phone ? String(phone).trim() : null, label || null, is_preferred, phoneId, customerId]);
    if (q.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    await client.query('COMMIT');
    res.json(q.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('customerRoutes: update phone error', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete phone
router.delete('/:id/contacts/phones/:phoneId', async (req: Request, res: Response) => {
  const customerId = Number(req.params.id);
  const phoneId = Number(req.params.phoneId);
  if (!Number.isFinite(customerId) || !Number.isFinite(phoneId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const q = await pool.query('DELETE FROM customer_phones WHERE id = $1 AND customer_id = $2', [phoneId, customerId]);
    res.json({ ok: true, deleted: q.rowCount });
  } catch (err) {
    console.error('customerRoutes: delete phone error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 

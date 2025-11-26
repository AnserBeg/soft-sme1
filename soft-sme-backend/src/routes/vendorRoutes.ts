import express, { Request, Response } from 'express';
import { pool } from '../db';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import XLSX from 'xlsx';
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

const vendorHeaderMap: Record<string, string> = {
  name: 'vendor_name',
  vendor: 'vendor_name',
  vendor_name: 'vendor_name',
  contact: 'contact_person',
  contact_person: 'contact_person',
  contactname: 'contact_person',
  contact_name: 'contact_person',
  phone: 'telephone_number',
  phone_number: 'telephone_number',
  telephone: 'telephone_number',
  telephone_number: 'telephone_number',
  phone_no: 'telephone_number',
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
  email: 'email',
};

const normalizeHeader = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
const normalizeCell = (value: unknown): string => (value == null ? '' : value.toString().trim());

// Downloadable Excel template to guide imports
router.get('/import-excel/template', (_req: Request, res: Response) => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['vendor_name', 'contact_person', 'email', 'telephone_number', 'street_address', 'city', 'province', 'country', 'postal_code', 'website'],
    ['ACME Supplies', 'Jane Smith', 'jane@acmesupplies.com', '555-111-2222', '123 Industrial Rd', 'Toronto', 'ON', 'Canada', 'M5H 2N2', 'https://acmesupplies.com'],
    ['Beta Tools', 'John Doe', 'john@betatools.io', '555-987-6543', '456 Market Ave', 'Vancouver', 'BC', 'Canada', 'V5K 0A1', 'https://betatools.io']
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Vendors');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="vendor_import_template.xlsx"');
  res.send(buffer);
});

// Bulk import vendors from Excel
router.post('/import-excel', excelUpload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No Excel file uploaded' });
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const createdVendors: any[] = [];
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
      vendor_name: string;
      canonicalName: string;
      street_address?: string;
      city?: string;
      province?: string;
      country?: string;
      postal_code?: string;
      contact_person?: string;
      telephone_number?: string;
      email?: string;
      website?: string;
    }> = [];

    const seenCanonicalNames = new Set<string>();

    rawRows.forEach((row, index) => {
      const rowNumber = index + 2; // account for header row
      const normalizedRow: Record<string, unknown> = {};

      Object.entries(row).forEach(([key, value]) => {
        const mappedKey = vendorHeaderMap[normalizeHeader(key)] || normalizeHeader(key);
        if (mappedKey) {
          normalizedRow[mappedKey] = value;
        }
      });

      const nameValue = normalizeCell(normalizedRow.vendor_name);
      if (!nameValue) {
        errors.push(`Row ${rowNumber}: vendor_name is required; row skipped`);
        return;
      }

      const canonicalName = canonicalizeName(nameValue);
      if (!canonicalName) {
        errors.push(`Row ${rowNumber}: vendor_name is not valid after normalization; row skipped`);
        return;
      }

      if (seenCanonicalNames.has(canonicalName)) {
        warnings.push(`Row ${rowNumber}: "${nameValue}" skipped because the same name appears multiple times in the file`);
        return;
      }

      seenCanonicalNames.add(canonicalName);

      normalizedRows.push({
        rowNumber,
        vendor_name: nameValue,
        canonicalName,
        street_address: normalizeCell(normalizedRow.street_address),
        city: normalizeCell(normalizedRow.city),
        province: normalizeCell(normalizedRow.province),
        country: normalizeCell(normalizedRow.country),
        postal_code: normalizeCell(normalizedRow.postal_code),
        contact_person: normalizeCell(normalizedRow.contact_person),
        telephone_number: normalizeCell(normalizedRow.telephone_number || normalizedRow.phone_number),
        email: normalizeCell(normalizedRow.email),
        website: normalizeCell(normalizedRow.website),
      });
    });

    if (normalizedRows.length === 0) {
      return res.json({
        message: 'No valid vendor rows to import',
        summary: {
          totalRows: rawRows.length,
          acceptedRows: 0,
          created: 0,
          skipped: rawRows.length,
          errors: errors.length,
          warnings: warnings.length
        },
        warnings,
        errors,
        createdVendors
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const row of normalizedRows) {
        const existing = await client.query(
          'SELECT vendor_id, vendor_name FROM vendormaster WHERE canonical_name = $1',
          [row.canonicalName]
        );

        if (existing.rows.length > 0) {
          warnings.push(`Row ${row.rowNumber}: "${row.vendor_name}" skipped because "${existing.rows[0].vendor_name}" already exists`);
          continue;
        }

        const insertResult = await client.query(
          'INSERT INTO vendormaster (vendor_name, canonical_name, street_address, city, province, country, postal_code, contact_person, telephone_number, email, website) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
          [
            row.vendor_name,
            row.canonicalName,
            row.street_address || null,
            row.city || null,
            row.province || null,
            row.country || null,
            row.postal_code || null,
            row.contact_person || null,
            row.telephone_number || null,
            row.email || null,
            row.website || null
          ]
        );

        const saved = insertResult.rows[0];
        const { canonical_name: _c, ...vendorFields } = saved;
        createdVendors.push({
          ...vendorFields,
          id: saved.vendor_id
        });
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('vendorRoutes: Error during Excel import transaction:', err);
      return res.status(500).json({ error: 'Failed to import vendors', details: (err as Error).message });
    } finally {
      client.release();
    }

    res.json({
      message: 'Vendor import completed',
      summary: {
        totalRows: rawRows.length,
        acceptedRows: normalizedRows.length,
        created: createdVendors.length,
        skipped: normalizedRows.length - createdVendors.length,
        errors: errors.length,
        warnings: warnings.length
      },
      warnings,
      errors,
      createdVendors
    });
  } catch (err) {
    console.error('vendorRoutes: Error processing Excel file:', err);
    res.status(500).json({ error: 'Internal server error while processing Excel file', details: (err as Error).message });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});

// Get all vendors
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM vendormaster ORDER BY vendor_name ASC');
    const vendors = result.rows.map(({ canonical_name, ...vendor }) => vendor);
    res.json(vendors);
  } catch (err) {
    console.error('vendorRoutes: Error fetching vendors:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export vendors to PDF (in-memory buffer method)
router.get('/export/pdf', async (req: Request, res: Response) => {
  console.log('Vendor PDF export endpoint hit at', new Date().toISOString());
  try {
    const result = await pool.query('SELECT * FROM vendormaster ORDER BY vendor_name ASC');
    const vendors = result.rows;

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-disposition', `attachment; filename="vendors_${new Date().toISOString().split('T')[0]}.pdf"`);
      res.setHeader('Content-type', 'application/pdf');
      res.end(pdfBuffer);
      console.log('PDF buffer sent for vendor export');
    });

    // Header
    doc.font('Helvetica-Bold').fontSize(20).text('Vendor List', { align: 'center' });
    doc.moveDown();
    doc.font('Helvetica').fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(2);

    // Table headers
    const headers = ['Vendor Name', 'Contact Person', 'Email', 'Phone', 'Address'];
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
    vendors.forEach((vendor, index) => {
      if (y > doc.page.height - 100) {
        doc.addPage();
        y = 50;
      }

      x = 50;
      doc.text(vendor.vendor_name || '', x, y, { width: columnWidths[0] });
      x += columnWidths[0];
      doc.text(vendor.contact_person || '', x, y, { width: columnWidths[1] });
      x += columnWidths[1];
      doc.text(vendor.email || '', x, y, { width: columnWidths[2] });
      x += columnWidths[2];
      doc.text(vendor.telephone_number || '', x, y, { width: columnWidths[3] });
      x += columnWidths[3];
      
      const address = [
        vendor.street_address,
        vendor.city,
        vendor.province,
        vendor.country
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
    console.error('vendorRoutes: Error generating PDF:', error);
    res.status(500).json({ error: 'Internal server error during PDF generation', details: error.message, stack: error.stack });
  }
});

// Minimal PDF test endpoint for debugging
router.get('/export/pdf-test', (req, res) => {
  console.log('Vendor minimal PDF test endpoint hit at', new Date().toISOString());
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument();
  res.setHeader('Content-disposition', 'attachment; filename="test.pdf"');
  res.setHeader('Content-type', 'application/pdf');
  doc.pipe(res);
  doc.text('Test PDF');
  doc.end();
  console.log('Minimal PDF stream ended for vendor export');
});

// Get a specific vendor by ID
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM vendormaster WHERE vendor_id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vendor not found' });
    }
    const { canonical_name, ...vendor } = result.rows[0];
    res.json(vendor);
  } catch (err) {
    console.error('vendorRoutes: Error fetching vendor:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new vendor
router.post('/', async (req: Request, res: Response) => {
  const {
    vendor_name,
    street_address,
    city,
    province,
    country,
    postal_code,
    contact_person,
    telephone_number,
    email,
    website
  } = req.body;

  const trimmedVendorName = vendor_name ? vendor_name.toString().trim() : '';
  if (!trimmedVendorName) {
    return res.status(400).json({ error: 'Vendor name is required' });
  }

  const canonicalName = canonicalizeName(trimmedVendorName);

  try {
    const duplicateCheck = await pool.query(
      'SELECT vendor_id, vendor_name FROM vendormaster WHERE canonical_name = $1',
      [canonicalName]
    );

    if (duplicateCheck.rows.length > 0) {
      const existing = duplicateCheck.rows[0];
      return res.status(409).json({
        error: 'Vendor already exists',
        details: `Vendor "${existing.vendor_name}" already exists (normalized match for "${trimmedVendorName}").`
      });
    }

    const result = await pool.query(
      'INSERT INTO vendormaster (vendor_name, canonical_name, street_address, city, province, country, postal_code, contact_person, telephone_number, email, website) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
      [
        trimmedVendorName,
        canonicalName,
        street_address ?? null,
        city ?? null,
        province ?? null,
        country ?? null,
        postal_code ?? null,
        contact_person ?? null,
        telephone_number ?? null,
        email ?? null,
        website ?? null
      ]
    );

    const { canonical_name, ...vendor } = result.rows[0];
    res.status(201).json({ message: 'Vendor added successfully!', vendor });
  } catch (err) {
    console.error('vendorRoutes: Error creating vendor:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a vendor
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    vendor_name,
    street_address,
    city,
    province,
    country,
    postal_code,
    contact_person,
    telephone_number,
    email,
    website
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingResult = await client.query('SELECT * FROM vendormaster WHERE vendor_id = $1', [id]);
    if (existingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Vendor not found' });
    }

    const existingVendor = existingResult.rows[0];
    const trimmedVendorName = vendor_name !== undefined
      ? vendor_name.toString().trim()
      : existingVendor.vendor_name;

    if (!trimmedVendorName) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Vendor name is required' });
    }

    const canonicalName = canonicalizeName(trimmedVendorName);

    const duplicateCheck = await client.query(
      'SELECT vendor_id FROM vendormaster WHERE canonical_name = $1 AND vendor_id <> $2',
      [canonicalName, id]
    );

    if (duplicateCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Vendor already exists',
        details: `Another vendor already exists with a similar name to "${trimmedVendorName}"`
      });
    }

    const resolvedStreetAddress = street_address !== undefined ? street_address : existingVendor.street_address;
    const resolvedCity = city !== undefined ? city : existingVendor.city;
    const resolvedProvince = province !== undefined ? province : existingVendor.province;
    const resolvedCountry = country !== undefined ? country : existingVendor.country;
    const resolvedPostalCode = postal_code !== undefined ? postal_code : existingVendor.postal_code;
    const resolvedContactPerson = contact_person !== undefined ? contact_person : existingVendor.contact_person;
    const resolvedTelephone = telephone_number !== undefined ? telephone_number : existingVendor.telephone_number;
    const resolvedEmail = email !== undefined ? email : existingVendor.email;
    const resolvedWebsite = website !== undefined ? website : existingVendor.website;

    const result = await client.query(
      'UPDATE vendormaster SET vendor_name = $1, canonical_name = $2, street_address = $3, city = $4, province = $5, country = $6, postal_code = $7, contact_person = $8, telephone_number = $9, email = $10, website = $11, updated_at = CURRENT_TIMESTAMP WHERE vendor_id = $12 RETURNING *',
      [
        trimmedVendorName,
        canonicalName,
        resolvedStreetAddress ?? null,
        resolvedCity ?? null,
        resolvedProvince ?? null,
        resolvedCountry ?? null,
        resolvedPostalCode ?? null,
        resolvedContactPerson ?? null,
        resolvedTelephone ?? null,
        resolvedEmail ?? null,
        resolvedWebsite ?? null,
        id
      ]
    );

    await client.query('COMMIT');

    const { canonical_name, ...vendor } = result.rows[0];
    res.json({ message: 'Vendor updated successfully!', vendor });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('vendorRoutes: Error updating vendor:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete a vendor
router.delete('/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM vendormaster WHERE vendor_id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Vendor not found' });
        }
        res.json({ message: 'Vendor deleted successfully!' });
    } catch (err) {
        console.error('vendorRoutes: Error deleting vendor:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// =========================
// Vendor contact endpoints
// =========================

// List contacts (people, emails, phones) for a vendor
router.get('/:id/contacts', async (req: Request, res: Response) => {
  const vendorId = Number(req.params.id);
  if (!Number.isFinite(vendorId)) return res.status(400).json({ error: 'Invalid vendor id' });
  try {
    const [people, emails, phones] = await Promise.all([
      pool.query('SELECT * FROM vendor_contact_people WHERE vendor_id = $1 ORDER BY is_preferred DESC, name ASC', [vendorId]),
      pool.query('SELECT * FROM vendor_emails WHERE vendor_id = $1 ORDER BY is_preferred DESC, email ASC', [vendorId]),
      pool.query('SELECT * FROM vendor_phones WHERE vendor_id = $1 ORDER BY is_preferred DESC, label NULLS LAST, phone ASC', [vendorId]),
    ]);
    res.json({ people: people.rows, emails: emails.rows, phones: phones.rows });
  } catch (err) {
    console.error('vendorRoutes: list contacts error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add contact person
router.post('/:id/contacts/people', async (req: Request, res: Response) => {
  const vendorId = Number(req.params.id);
  const { name, is_preferred } = req.body || {};
  if (!Number.isFinite(vendorId)) return res.status(400).json({ error: 'Invalid vendor id' });
  if (!name || String(name).trim() === '') return res.status(400).json({ error: 'name is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_preferred === true) {
      await client.query('UPDATE vendor_contact_people SET is_preferred = FALSE WHERE vendor_id = $1', [vendorId]);
    }
    const q = await client.query('INSERT INTO vendor_contact_people (vendor_id, name, is_preferred) VALUES ($1,$2,COALESCE($3,false)) RETURNING *', [vendorId, String(name).trim(), !!is_preferred]);
    await client.query('COMMIT');
    res.status(201).json(q.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('vendorRoutes: add contact person error', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update contact person
router.put('/:id/contacts/people/:personId', async (req: Request, res: Response) => {
  const vendorId = Number(req.params.id);
  const personId = Number(req.params.personId);
  const { name, is_preferred } = req.body || {};
  if (!Number.isFinite(vendorId) || !Number.isFinite(personId)) return res.status(400).json({ error: 'Invalid id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_preferred === true) {
      await client.query('UPDATE vendor_contact_people SET is_preferred = FALSE WHERE vendor_id = $1', [vendorId]);
    }
    const q = await client.query('UPDATE vendor_contact_people SET name = COALESCE($1, name), is_preferred = COALESCE($2, is_preferred) WHERE id = $3 AND vendor_id = $4 RETURNING *', [name ? String(name).trim() : null, is_preferred, personId, vendorId]);
    if (q.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    await client.query('COMMIT');
    res.json(q.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('vendorRoutes: update contact person error', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete contact person
router.delete('/:id/contacts/people/:personId', async (req: Request, res: Response) => {
  const vendorId = Number(req.params.id);
  const personId = Number(req.params.personId);
  if (!Number.isFinite(vendorId) || !Number.isFinite(personId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const q = await pool.query('DELETE FROM vendor_contact_people WHERE id = $1 AND vendor_id = $2', [personId, vendorId]);
    res.json({ ok: true, deleted: q.rowCount });
  } catch (err) {
    console.error('vendorRoutes: delete contact person error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add email
router.post('/:id/contacts/emails', async (req: Request, res: Response) => {
  const vendorId = Number(req.params.id);
  const { email, is_preferred } = req.body || {};
  if (!Number.isFinite(vendorId)) return res.status(400).json({ error: 'Invalid vendor id' });
  if (!email || String(email).trim() === '') return res.status(400).json({ error: 'email is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_preferred === true) {
      await client.query('UPDATE vendor_emails SET is_preferred = FALSE WHERE vendor_id = $1', [vendorId]);
    }
    const q = await client.query('INSERT INTO vendor_emails (vendor_id, email, is_preferred) VALUES ($1,$2,COALESCE($3,false)) ON CONFLICT (vendor_id, email) DO UPDATE SET is_preferred = EXCLUDED.is_preferred RETURNING *', [vendorId, String(email).trim(), !!is_preferred]);
    await client.query('COMMIT');
    res.status(201).json(q.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('vendorRoutes: add email error', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update email
router.put('/:id/contacts/emails/:emailId', async (req: Request, res: Response) => {
  const vendorId = Number(req.params.id);
  const emailId = Number(req.params.emailId);
  const { email, is_preferred } = req.body || {};
  if (!Number.isFinite(vendorId) || !Number.isFinite(emailId)) return res.status(400).json({ error: 'Invalid id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_preferred === true) {
      await client.query('UPDATE vendor_emails SET is_preferred = FALSE WHERE vendor_id = $1', [vendorId]);
    }
    const q = await client.query('UPDATE vendor_emails SET email = COALESCE($1, email), is_preferred = COALESCE($2, is_preferred) WHERE id = $3 AND vendor_id = $4 RETURNING *', [email ? String(email).trim() : null, is_preferred, emailId, vendorId]);
    if (q.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    await client.query('COMMIT');
    res.json(q.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('vendorRoutes: update email error', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete email
router.delete('/:id/contacts/emails/:emailId', async (req: Request, res: Response) => {
  const vendorId = Number(req.params.id);
  const emailId = Number(req.params.emailId);
  if (!Number.isFinite(vendorId) || !Number.isFinite(emailId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const q = await pool.query('DELETE FROM vendor_emails WHERE id = $1 AND vendor_id = $2', [emailId, vendorId]);
    res.json({ ok: true, deleted: q.rowCount });
  } catch (err) {
    console.error('vendorRoutes: delete email error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add phone
router.post('/:id/contacts/phones', async (req: Request, res: Response) => {
  const vendorId = Number(req.params.id);
  const { phone, label, is_preferred } = req.body || {};
  if (!Number.isFinite(vendorId)) return res.status(400).json({ error: 'Invalid vendor id' });
  if (!phone || String(phone).trim() === '') return res.status(400).json({ error: 'phone is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_preferred === true) {
      await client.query('UPDATE vendor_phones SET is_preferred = FALSE WHERE vendor_id = $1', [vendorId]);
    }
    const q = await client.query('INSERT INTO vendor_phones (vendor_id, phone, label, is_preferred) VALUES ($1,$2,$3,COALESCE($4,false)) ON CONFLICT (vendor_id, phone) DO UPDATE SET label = EXCLUDED.label, is_preferred = EXCLUDED.is_preferred RETURNING *', [vendorId, String(phone).trim(), label || null, !!is_preferred]);
    await client.query('COMMIT');
    res.status(201).json(q.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('vendorRoutes: add phone error', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update phone
router.put('/:id/contacts/phones/:phoneId', async (req: Request, res: Response) => {
  const vendorId = Number(req.params.id);
  const phoneId = Number(req.params.phoneId);
  const { phone, label, is_preferred } = req.body || {};
  if (!Number.isFinite(vendorId) || !Number.isFinite(phoneId)) return res.status(400).json({ error: 'Invalid id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (is_preferred === true) {
      await client.query('UPDATE vendor_phones SET is_preferred = FALSE WHERE vendor_id = $1', [vendorId]);
    }
    const q = await client.query('UPDATE vendor_phones SET phone = COALESCE($1, phone), label = COALESCE($2, label), is_preferred = COALESCE($3, is_preferred) WHERE id = $4 AND vendor_id = $5 RETURNING *', [phone ? String(phone).trim() : null, label || null, is_preferred, phoneId, vendorId]);
    if (q.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    await client.query('COMMIT');
    res.json(q.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('vendorRoutes: update phone error', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete phone
router.delete('/:id/contacts/phones/:phoneId', async (req: Request, res: Response) => {
  const vendorId = Number(req.params.id);
  const phoneId = Number(req.params.phoneId);
  if (!Number.isFinite(vendorId) || !Number.isFinite(phoneId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const q = await pool.query('DELETE FROM vendor_phones WHERE id = $1 AND vendor_id = $2', [phoneId, vendorId]);
    res.json({ ok: true, deleted: q.rowCount });
  } catch (err) {
    console.error('vendorRoutes: delete phone error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 

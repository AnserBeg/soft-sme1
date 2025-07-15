import express, { Request, Response } from 'express';
import { pool } from '../db';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// Get all vendors
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM vendormaster ORDER BY vendor_name ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('vendorRoutes: Error fetching vendors:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export vendors to PDF
router.get('/export/pdf', async (req: Request, res: Response) => {
  console.log('Vendor PDF export endpoint hit');
  try {
    const result = await pool.query('SELECT * FROM vendormaster ORDER BY vendor_name ASC');
    const vendors = result.rows;

    const doc = new PDFDocument({ margin: 50 });
    const filename = `vendors_${new Date().toISOString().split('T')[0]}.pdf`;
    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

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
    console.error('vendorRoutes: Error generating PDF:', err);
    res.status(500).json({ error: 'Internal server error during PDF generation', details: err.message, stack: err.stack });
  }
});

// Get a specific vendor by ID
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM vendormaster WHERE vendor_id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vendor not found' });
    }
    res.json(result.rows[0]);
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
    try {
        const result = await pool.query(
            'INSERT INTO vendormaster (vendor_name, street_address, city, province, country, postal_code, contact_person, telephone_number, email, website) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
            [vendor_name, street_address, city, province, country, postal_code, contact_person, telephone_number, email, website]
        );
        res.status(201).json({ message: 'Vendor added successfully!', vendor: result.rows[0] });
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
    try {
        const result = await pool.query(
            'UPDATE vendormaster SET vendor_name = $1, street_address = $2, city = $3, province = $4, country = $5, postal_code = $6, contact_person = $7, telephone_number = $8, email = $9, website = $10, updated_at = CURRENT_TIMESTAMP WHERE vendor_id = $11 RETURNING *',
            [vendor_name, street_address, city, province, country, postal_code, contact_person, telephone_number, email, website, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Vendor not found' });
        }
        res.json({ message: 'Vendor updated successfully!', vendor: result.rows[0] });
    } catch (err) {
        console.error('vendorRoutes: Error updating vendor:', err);
        res.status(500).json({ error: 'Internal server error' });
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

export default router; 
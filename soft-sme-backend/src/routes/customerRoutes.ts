import express, { Request, Response } from 'express';
import { pool } from '../db';
import PDFDocument from 'pdfkit';

const router = express.Router();

// Get all customers
router.get('/', async (req: Request, res: Response) => {
  console.log('customerRoutes: GET / - fetching all customers');
  try {
    const result = await pool.query('SELECT customer_id, customer_name, street_address, city, province, country, postal_code, contact_person, telephone_number, email, website FROM customermaster');
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
    const result = await pool.query('SELECT customer_id, customer_name, street_address, city, province, country, postal_code, contact_person, telephone_number, email, website FROM customermaster ORDER BY customer_name ASC');
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
    const customer = {
      ...result.rows[0],
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
    const { customer_name, street_address, city, province, country, postal_code, contact_person, phone_number, email, website } = req.body;

    console.log('Received new customer data:', req.body);

    const result = await client.query(
      'INSERT INTO customermaster (customer_name, street_address, city, province, country, postal_code, contact_person, telephone_number, email, website) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
      [customer_name, street_address, city, province, country, postal_code, contact_person, phone_number, email, website]
    );

    const newCustomer = result.rows[0];
    // Add 'id' field to match frontend expectations
    const customerWithId = {
      ...newCustomer,
      id: newCustomer.customer_id
    };
    res.status(201).json(customerWithId);
  } catch (err) {
    console.error('Error creating customer:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update a customer by ID
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { customer_name, street_address, city, province, country, postal_code, contact_person, phone_number, email, website } = req.body;

  const client = await pool.connect();

  // Build the update query dynamically based on provided fields
  const updateFields = [];
  const queryParams = [];
  let paramIndex = 1;

  if (customer_name !== undefined) { updateFields.push(`customer_name = $${paramIndex++}`); queryParams.push(customer_name); }
  if (street_address !== undefined) { updateFields.push(`street_address = $${paramIndex++}`); queryParams.push(street_address); }
  if (city !== undefined) { updateFields.push(`city = $${paramIndex++}`); queryParams.push(city); }
  if (province !== undefined) { updateFields.push(`province = $${paramIndex++}`); queryParams.push(province); }
  if (country !== undefined) { updateFields.push(`country = $${paramIndex++}`); queryParams.push(country); }
  if (postal_code !== undefined) { updateFields.push(`postal_code = $${paramIndex++}`); queryParams.push(postal_code); }
  if (contact_person !== undefined) { updateFields.push(`contact_person = $${paramIndex++}`); queryParams.push(contact_person); }
  if (phone_number !== undefined) { updateFields.push(`telephone_number = $${paramIndex++}`); queryParams.push(phone_number); }
  if (email !== undefined) { updateFields.push(`email = $${paramIndex++}`); queryParams.push(email); }
  if (website !== undefined) { updateFields.push(`website = $${paramIndex++}`); queryParams.push(website); }

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

    // Add 'id' field to match frontend expectations
    const updatedCustomer = {
      ...result.rows[0],
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
import express, { Request, Response } from 'express';
import { pool } from '../db';

const router = express.Router();

// Get all customers
router.get('/', async (req: Request, res: Response) => {
  console.log('customerRoutes: GET / - fetching all customers');
  try {
    const result = await pool.query('SELECT customer_id, customer_name, street_address, city, province, country, contact_person, telephone_number, email, website FROM customermaster');
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
    const { customer_name, street_address, city, province, country, contact_person, phone_number, email, website } = req.body;

    console.log('Received new customer data:', req.body);

    const result = await client.query(
      'INSERT INTO customermaster (customer_name, street_address, city, province, country, contact_person, telephone_number, email, website) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [customer_name, street_address, city, province, country, contact_person, phone_number, email, website]
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
  const { customer_name, street_address, city, province, country, contact_person, phone_number, email, website } = req.body;

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

export default router; 
import express, { Request, Response } from 'express';
import { pool } from '../db';

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
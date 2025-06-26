import express, { Request, Response } from 'express';
import { pool } from '../db';

const router = express.Router();

// Get all products
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT product_id, product_name, product_description, created_at, updated_at FROM products');
    // Add 'id' field for frontend compatibility
    const productsWithId = result.rows.map(product => ({
      ...product,
      id: product.product_id
    }));
    res.json(productsWithId);
  } catch (err) {
    console.error('productRoutes: Error fetching products:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a specific product by ID
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM products WHERE product_id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    const product = {
      ...result.rows[0],
      id: result.rows[0].product_id
    };
    res.json(product);
  } catch (err) {
    console.error('productRoutes: Error fetching product:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new product
router.post('/', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { product_name, product_description } = req.body;
    const result = await client.query(
      'INSERT INTO products (product_name, product_description) VALUES ($1, $2) RETURNING product_id, product_name, product_description, created_at, updated_at',
      [product_name, product_description]
    );
    const newProduct = result.rows[0];
    res.status(201).json({ message: 'Product created successfully', product: newProduct });
  } catch (err) {
    console.error('productRoutes: Error creating product:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Update a product by ID
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { product_name, product_description } = req.body;
  const client = await pool.connect();
  try {
    const result = await client.query(
      'UPDATE products SET product_name = $1, product_description = $2, updated_at = CURRENT_TIMESTAMP WHERE product_id = $3 RETURNING *',
      [product_name, product_description, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ message: 'Product updated successfully', updatedProduct: result.rows[0] });
  } catch (err) {
    console.error('productRoutes: Error updating product:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Delete a product by ID
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    const result = await client.query(
      'DELETE FROM products WHERE product_id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ message: 'Product deleted successfully', deletedProduct: result.rows[0] });
  } catch (err) {
    console.error('productRoutes: Error deleting product:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router; 
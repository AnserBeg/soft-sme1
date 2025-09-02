import express, { Request, Response } from 'express';
import { pool } from '../db';
import PDFDocument from 'pdfkit';

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

// Export products to PDF
router.get('/export/pdf', async (req: Request, res: Response) => {
  console.log('Product PDF export endpoint hit');
  try {
    const result = await pool.query('SELECT product_id, product_name, product_description, created_at, updated_at FROM products ORDER BY product_name ASC');
    const products = result.rows;

    const doc = new PDFDocument({ margin: 50 });
    const filename = `products_${new Date().toISOString().split('T')[0]}.pdf`;
    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    // Header
    doc.font('Helvetica-Bold').fontSize(20).text('Product List', { align: 'center' });
    doc.moveDown();
    doc.font('Helvetica').fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(2);

    // Table headers
    const headers = ['Product ID', 'Product Name', 'Description', 'Created Date'];
    const columnWidths = [100, 200, 250, 100];
    let y = doc.y;

    // Draw header row
    doc.font('Helvetica-Bold').fontSize(10);
    let x = 50;
    headers.forEach((header, index) => {
      doc.text(header, x, y, { width: columnWidths[index] });
      x += columnWidths[index];
    });

    y += 20;
    doc.moveTo(50, y).lineTo(700, y).stroke();

    // Draw data rows
    doc.font('Helvetica').fontSize(9);
    products.forEach((product, index) => {
      if (y > doc.page.height - 100) {
        doc.addPage();
        y = 50;
      }

      x = 50;
      doc.text(product.product_id || '', x, y, { width: columnWidths[0] });
      x += columnWidths[0];
      doc.text(product.product_name || '', x, y, { width: columnWidths[1] });
      x += columnWidths[1];
      doc.text(product.product_description || '', x, y, { width: columnWidths[2] });
      x += columnWidths[2];
      
      const createdDate = product.created_at ? new Date(product.created_at).toLocaleDateString() : '';
      doc.text(createdDate, x, y, { width: columnWidths[3] });

      y += 15;
      
      // Draw row separator
      doc.moveTo(50, y).lineTo(700, y).stroke();
      y += 5;
    });

    doc.end();
  } catch (err) {
    const error = err as Error;
    console.error('productRoutes: Error generating PDF:', error);
    res.status(500).json({ error: 'Internal server error during PDF generation', details: error.message, stack: error.stack });
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

    // Validate required fields
    if (!product_name || product_name.trim() === '') {
      return res.status(400).json({ error: 'Product name is required' });
    }

    // Check if product with same name already exists
    const existingProduct = await client.query(
      'SELECT product_id FROM products WHERE LOWER(product_name) = LOWER($1)',
      [product_name.trim()]
    );

    if (existingProduct.rows.length > 0) {
      return res.status(409).json({ 
        error: 'Product already exists',
        message: `A product with the name "${product_name}" already exists`,
        existingProductId: existingProduct.rows[0].product_id
      });
    }

    const result = await client.query(
      'INSERT INTO products (product_name, product_description) VALUES ($1, $2) RETURNING product_id, product_name, product_description, created_at, updated_at',
      [product_name.trim(), product_description]
    );
    
    const newProduct = result.rows[0];
    console.log('Product created successfully:', newProduct);
    res.status(201).json({ message: 'Product created successfully', product: newProduct });
  } catch (err: any) {
    console.error('productRoutes: Error creating product:', err);
    
    // Handle specific database errors
    if (err.code === '23505') { // Unique constraint violation
      if (err.constraint?.includes('product_name')) {
        res.status(409).json({ 
          error: 'Product name already exists',
          message: `A product with the name "${req.body.product_name}" already exists`,
          details: 'Please choose a different product name or use the existing product.'
        });
      } else {
        res.status(409).json({ 
          error: 'Duplicate entry',
          message: 'A product with this information already exists'
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
        message: 'Failed to create product. Please try again.'
      });
    }
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
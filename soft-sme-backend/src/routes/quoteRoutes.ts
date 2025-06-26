import express, { Request, Response } from 'express';
import { pool } from '../db';
import { getNextSequenceNumberForYear } from '../utils/sequence';

const router = express.Router();

// Get all quotes
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT 
        q.*,
        c.customer_name,
        CAST(q.estimated_cost AS FLOAT) as estimated_cost,
        q.quote_number
      FROM quotes q
      JOIN customermaster c ON q.customer_id = c.customer_id
      ORDER BY q.quote_date DESC;
    `);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('quoteRoutes: Error fetching quotes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a specific quote by ID
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT 
        q.*,
        c.customer_name,
        CAST(q.estimated_cost AS FLOAT) as estimated_cost,
        q.quote_number
      FROM quotes q
      JOIN customermaster c ON q.customer_id = c.customer_id
      WHERE q.quote_id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('quoteRoutes: Error fetching quote:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new quote
router.post('/', async (req: Request, res: Response) => {
  const {
    customer_id,
    quote_date,
    valid_until,
    product_name,
    product_description,
    estimated_cost,
    status
  } = req.body;

  if (!customer_id || !quote_date || !valid_until || !product_name || !estimated_cost) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // First verify that the customer exists
    const customerCheck = await client.query('SELECT customer_id FROM customermaster WHERE customer_id = $1', [customer_id]);
    if (customerCheck.rows.length === 0) {
      return res.status(400).json({ error: `Customer with ID ${customer_id} not found` });
    }

    const currentYear = new Date().getFullYear();
    const { sequenceNumber, nnnnn } = await getNextSequenceNumberForYear(currentYear);
    const formattedQuoteNumber = `QO-${currentYear}-${nnnnn.toString().padStart(5, '0')}`;

    const result = await client.query(
      `INSERT INTO quotes (
        quote_number, customer_id, quote_date, valid_until, product_name, product_description,
        estimated_cost, status, sequence_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;`,
      [formattedQuoteNumber, customer_id, quote_date, valid_until, product_name, product_description, estimated_cost, status || 'Draft', sequenceNumber]
    );
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('quoteRoutes: Error creating quote:', error);
    res.status(500).json({ error: 'Internal server error', details: (error as any).message });
  } finally {
    client.release();
  }
});

// Update a quote
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    customer_id,
    quote_date,
    valid_until,
    product_name,
    product_description,
    estimated_cost,
    status
  } = req.body;

  if (!customer_id || !quote_date || !valid_until || !product_name || !estimated_cost) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if quote exists
    const quoteCheck = await client.query('SELECT quote_id FROM quotes WHERE quote_id = $1', [id]);
    if (quoteCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Verify that the customer exists
    const customerCheck = await client.query('SELECT customer_id FROM customermaster WHERE customer_id = $1', [customer_id]);
    if (customerCheck.rows.length === 0) {
      return res.status(400).json({ error: `Customer with ID ${customer_id} not found` });
    }

    const result = await client.query(
      `UPDATE quotes SET 
        customer_id = $1, 
        quote_date = $2, 
        valid_until = $3, 
        product_name = $4, 
        product_description = $5,
        estimated_cost = $6, 
        status = $7,
        updated_at = NOW()
      WHERE quote_id = $8 RETURNING *;`,
      [customer_id, quote_date, valid_until, product_name, product_description, estimated_cost, status, id]
    );
    
    await client.query('COMMIT');
    res.status(200).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('quoteRoutes: Error updating quote:', error);
    res.status(500).json({ error: 'Internal server error', details: (error as any).message });
  } finally {
    client.release();
  }
});

// Delete a quote
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM quotes WHERE quote_id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    res.status(200).json({ message: 'Quote deleted successfully' });
  } catch (error) {
    console.error('quoteRoutes: Error deleting quote:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Convert quote to sales order
router.post('/:id/convert-to-sales-order', async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Get the quote details
    const quoteResult = await client.query(`
      SELECT q.*, c.customer_name 
      FROM quotes q 
      JOIN customermaster c ON q.customer_id = c.customer_id 
      WHERE q.quote_id = $1
    `, [id]);

    if (quoteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const quote = quoteResult.rows[0];

    // Use the quote's sequence_number and format as SO-YYYY-NNNNN
    const sequenceNumber = quote.sequence_number;
    const soYear = sequenceNumber.substring(0, 4);
    const soSeq = sequenceNumber.substring(4);
    const formattedSONumber = `SO-${soYear}-${soSeq}`;

    // Create sales order in salesorderhistory
    const salesOrderResult = await client.query(
      `INSERT INTO salesorderhistory (
        sales_order_number, customer_id, sales_date, product_name, product_description,
        estimated_cost, status, quote_id, subtotal, total_gst_amount, total_amount, sequence_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [formattedSONumber, quote.customer_id, new Date().toISOString().split('T')[0], 
       quote.product_name, quote.product_description, quote.estimated_cost, 'Open', quote.quote_id,
       quote.estimated_cost, quote.estimated_cost * 0.05, quote.estimated_cost * 1.05, sequenceNumber]
    );

    const salesOrderId = salesOrderResult.rows[0].sales_order_id;

    // Create a line item based on the quote's product information
    await client.query(
      `INSERT INTO salesorderlineitems (
        sales_order_id, part_number, part_description, quantity_sold, unit, unit_price, line_amount
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        salesOrderId,
        'QUOTE-' + quote.quote_number, // Use quote number as part number
        quote.product_description || quote.product_name,
        1, // Default quantity
        'Each', // Default unit
        quote.estimated_cost, // Use estimated cost as unit price
        quote.estimated_cost // Line amount equals unit price for quantity 1
      ]
    );

    // After successful insert, delete the quote from quotes table
    await client.query('DELETE FROM quotes WHERE quote_id = $1', [id]);

    await client.query('COMMIT');
    
    res.status(200).json({ 
      message: 'Quote converted to sales order successfully',
      salesOrder: salesOrderResult.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('quoteRoutes: Error converting quote to sales order:', error);
    res.status(500).json({ error: 'Internal server error', details: (error as any).message });
  } finally {
    client.release();
  }
});

// Download quote PDF
router.get('/:id/pdf', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT 
        q.*,
        c.customer_name,
        c.street_address,
        c.city,
        c.province,
        c.country,
        c.contact_person,
        c.email,
        c.telephone_number,
        c.created_at as customer_created_at,
        c.updated_at as customer_updated_at
      FROM quotes q
      JOIN customermaster c ON q.customer_id = c.customer_id
      WHERE q.quote_id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const quote = result.rows[0];
    
    // For now, return a simple JSON response
    // In a real implementation, you would generate a PDF here
    res.status(200).json({
      message: 'PDF generation not implemented yet',
      quote: quote
    });
  } catch (error) {
    console.error('quoteRoutes: Error generating PDF:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 
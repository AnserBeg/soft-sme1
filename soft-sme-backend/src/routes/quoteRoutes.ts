import express, { Request, Response } from 'express';
import { pool } from '../db';
import { getNextSalesOrderSequenceNumberForYear } from '../utils/sequence';
import { QuoteService } from '../services/QuoteService';
import PDFDocument from 'pdfkit';
import { getLogoImageSource } from '../utils/pdfLogoHelper';
import { renderQuoteDescriptionToPdf } from '../utils/quoteDescription';
import { sanitizePlainText } from '../utils/htmlSanitizer';

const formatCurrency = (value: number | string | null | undefined): string => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return '$0.00';
  }

  const isNegative = amount < 0;
  const absoluteValue = Math.abs(amount);
  const [wholePart, decimalPart] = absoluteValue.toFixed(2).split('.');
  const withSeparators = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  return `${isNegative ? '-$' : '$'}${withSeparators}.${decimalPart}`;
};

const router = express.Router();
const quoteService = new QuoteService(pool);

// Get all quotes'
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
  try {
    const created = await quoteService.createQuote(req.body);
    res.status(201).json(created);
  } catch (error) {
    console.error('quoteRoutes: Error creating quote:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message.includes('required') || message.includes('not found') || message.includes('must be')) {
      res.status(400).json({ error: message });
      return;
    }
    res.status(500).json({ error: 'Internal server error', details: message });
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
    status,
    terms,
    customer_po_number,
    vin_number,
    vehicle_make,
    vehicle_model
  } = req.body;

  const sanitizedProductName = sanitizePlainText(product_name).trim();
  if (!customer_id || !quote_date || !valid_until || !sanitizedProductName || !estimated_cost) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if quote exists
    const quoteCheck = await client.query('SELECT quote_id, status FROM quotes WHERE quote_id = $1', [id]);
    if (quoteCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Quote not found' });
    }

    const existingQuote = quoteCheck.rows[0];

    const sanitizedStatus = sanitizePlainText(status).trim();
    const statusToUse = sanitizedStatus || existingQuote.status || 'Open';
    const sanitizedProductDescription = sanitizePlainText(product_description).trim() || null;
    const sanitizedTerms = sanitizePlainText(terms).trim() || null;
    const sanitizedCustomerPoNumber = sanitizePlainText(customer_po_number).trim() || null;
    const sanitizedVinNumber = sanitizePlainText(vin_number).trim() || null;
    const sanitizedVehicleMake = sanitizePlainText(vehicle_make).trim() || null;
    const sanitizedVehicleModel = sanitizePlainText(vehicle_model).trim() || null;

    // Verify that the customer exists
    const customerCheck = await client.query('SELECT customer_id FROM customermaster WHERE customer_id = $1', [customer_id]);
    if (customerCheck.rows.length === 0) {
      await client.query('ROLLBACK');
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
        terms = $8,
        customer_po_number = $9,
        vin_number = $10,
        vehicle_make = $11,
        vehicle_model = $12,
        updated_at = NOW()
      WHERE quote_id = $13 RETURNING *;`,
      [
        customer_id,
        quote_date,
        valid_until,
        sanitizedProductName,
        sanitizedProductDescription,
        estimated_cost,
        statusToUse,
        sanitizedTerms,
        sanitizedCustomerPoNumber,
        sanitizedVinNumber,
        sanitizedVehicleMake,
        sanitizedVehicleModel,
        id
      ]
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
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Quote not found' });
    }

    const quote = quoteResult.rows[0];

    const currentStatus = (quote.status ?? '').toString().trim().toLowerCase();
    if (currentStatus === 'approved') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Quote has already been converted to a sales order.' });
    }

    if (currentStatus === 'rejected') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Rejected quotes cannot be converted to sales orders.' });
    }

    const conversionDate = new Date();
    const conversionYear = conversionDate.getFullYear();
    const { sequenceNumber: soSequenceNumber, nnnnn: soSeq } = await getNextSalesOrderSequenceNumberForYear(conversionYear);
    const formattedSONumber = `SO-${conversionYear}-${soSeq.toString().padStart(5, '0')}`;

    // Create sales order in salesorderhistory
    const salesOrderResult = await client.query(
      `INSERT INTO salesorderhistory (
        sales_order_number, customer_id, sales_date, product_name, product_description,
        estimated_cost, status, quote_id, subtotal, total_gst_amount, total_amount, sequence_number, terms, customer_po_number, vin_number, vehicle_make, vehicle_model, invoice_status, source_quote_number
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
      ) RETURNING *`,
      [
        formattedSONumber,
        quote.customer_id,
        conversionDate.toISOString().split('T')[0],
        quote.product_name,
        quote.product_description,
        quote.estimated_cost,
        'Open',
        quote.quote_id,
        0,
        0,
        0,
        soSequenceNumber,
        quote.terms || null,
        quote.customer_po_number || null,
        quote.vin_number || null,
        quote.vehicle_make || null,
        quote.vehicle_model || null,
        null,
        quote.quote_number || null
      ]
    );

    const salesOrderId = salesOrderResult.rows[0].sales_order_id;

    const updatedQuoteResult = await client.query(
      `UPDATE quotes
        SET status = $1,
            updated_at = NOW()
       WHERE quote_id = $2
       RETURNING *`,
      ['Approved', id]
    );

    const updatedQuote = updatedQuoteResult.rows[0];

    await client.query('COMMIT');
    
    res.status(200).json({ 
      message: 'Quote converted to sales order successfully',
      salesOrder: salesOrderResult.rows[0],
      quote: updatedQuote
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('quoteRoutes: Error converting quote to sales order:', error);
    res.status(500).json({ error: 'Internal server error', details: (error as any).message });
  } finally {
    client.release();
  }
});

router.post('/:id/reject', async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const quoteResult = await client.query('SELECT * FROM quotes WHERE quote_id = $1', [id]);
    if (quoteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Quote not found' });
    }

    const quote = quoteResult.rows[0];
    const currentStatus = (quote.status ?? '').toString().trim().toLowerCase();

    if (currentStatus === 'approved') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Approved quotes cannot be rejected.' });
    }

    if (currentStatus === 'rejected') {
      await client.query('ROLLBACK');
      return res.status(200).json({ message: 'Quote is already rejected.', quote });
    }

    const updateResult = await client.query(
      `UPDATE quotes
        SET status = $1,
            updated_at = NOW()
       WHERE quote_id = $2
       RETURNING *`,
      ['Rejected', id]
    );

    await client.query('COMMIT');

    res.status(200).json({ message: 'Quote marked as rejected.', quote: updateResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('quoteRoutes: Error rejecting quote:', error);
    res.status(500).json({ error: 'Internal server error', details: (error as any).message });
  } finally {
    client.release();
  }
});

// Export quotes to PDF
router.get('/export/pdf', async (req: Request, res: Response) => {
  console.log('Quote history PDF export endpoint hit');
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
    const quotes = result.rows;

    const doc = new PDFDocument({ margin: 50 });
    const filename = `quotes_${new Date().toISOString().split('T')[0]}.pdf`;
    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    // Header
    doc.font('Helvetica-Bold').fontSize(20).text('Quote History', { align: 'center' });
    doc.moveDown();
    doc.font('Helvetica').fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(2);

    // Table headers
    const headers = ['Quote #', 'Customer', 'Product', 'Estimated Cost', 'Quote Date'];
    const columnWidths = [100, 150, 150, 100, 100];
    let y = doc.y;

    // Draw header row
    doc.font('Helvetica-Bold').fontSize(10);
    let x = 50;
    headers.forEach((header, index) => {
      doc.text(header, x, y, { width: columnWidths[index] });
      x += columnWidths[index];
    });

    y += 20;
    doc.moveTo(50, y).lineTo(600, y).stroke();

    // Draw data rows
    doc.font('Helvetica').fontSize(9);
    quotes.forEach((quote, index) => {
      if (y > doc.page.height - 100) {
        doc.addPage();
        y = 50;
      }

      x = 50;
      doc.text(quote.quote_number || '', x, y, { width: columnWidths[0] });
      x += columnWidths[0];
      doc.text(quote.customer_name || '', x, y, { width: columnWidths[1] });
      x += columnWidths[1];
      doc.text(quote.product_name || '', x, y, { width: columnWidths[2] });
      x += columnWidths[2];
      doc.text(formatCurrency(quote.estimated_cost), x, y, { width: columnWidths[3] });
      x += columnWidths[3];
      
      const quoteDate = quote.quote_date ? new Date(quote.quote_date).toLocaleDateString() : '';
      doc.text(quoteDate, x, y, { width: columnWidths[4] });

      y += 15;
      
      // Draw row separator
      doc.moveTo(50, y).lineTo(600, y).stroke();
      y += 5;
    });

    doc.end();
  } catch (err) {
    const error = err as Error;
    console.error('quoteRoutes: Error generating PDF (history):', error);
    res.status(500).json({ error: 'Internal server error during PDF generation', details: error.message, stack: error.stack });
  }
});

// Download quote PDF
router.get('/:id/pdf', async (req: Request, res: Response) => {
  console.log('Quote PDF export endpoint hit');
  const { id } = req.params;
  try {
    // Fetch business profile
    const businessProfileResult = await pool.query('SELECT * FROM business_profile ORDER BY id DESC LIMIT 1');
    const businessProfile = businessProfileResult.rows[0];

    const quoteResult = await pool.query(`
      SELECT 
        q.*,
        c.customer_name,
        c.street_address as customer_street_address,
        c.city as customer_city,
        c.province as customer_province,
        c.country as customer_country,
        c.contact_person,
        c.email as customer_email,
        c.telephone_number as customer_phone,
        c.postal_code as customer_postal_code
      FROM quotes q
      JOIN customermaster c ON q.customer_id = c.customer_id
      WHERE q.quote_id = $1
    `, [id]);

    if (quoteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const quote = quoteResult.rows[0];

    const doc = new PDFDocument({ margin: 50 });
    let filename = `Quote_${quote.quote_number}.pdf`;
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
    const logoSource = await getLogoImageSource(businessProfile?.logo_url);
    if (logoSource) {
      try {
        doc.image(logoSource, logoX, headerY, { fit: [logoWidth, logoHeight] });
      } catch (error) {
        console.error('Error adding logo to PDF:', error);
      }
    }
    // Company name (right of logo, vertically centered with logo)
    const fontSize = 16;
    // Company name slightly above vertical center of logo
    const companyTitleY = headerY + (logoHeight / 2) - (fontSize / 2) - 6;
    if (businessProfile) {
      doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#000000').text(
        (businessProfile.business_name || '').toUpperCase(),
        companyTitleX,
        companyTitleY,
        { align: 'left', width: pageWidth - companyTitleX - 50 }
      );
    }
    // Move Y below header (tight 4px gap)
    const logoBottom = headerY + logoHeight;
    const nameBottom = companyTitleY + fontSize;
    let y = Math.max(logoBottom, nameBottom) + 4;
    // Horizontal line
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 18;

    // --- Company & Customer Info Block ---
    // Headings
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Company Information', 50, y);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Customer', 320, y);
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
    // Customer info (right column)
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(quote.customer_name || '', 320, y);
    doc.text(quote.customer_street_address || '', 320, y + 14);
    doc.text(
      [quote.customer_city, quote.customer_province, quote.customer_country, quote.customer_postal_code].filter(Boolean).join(', '),
      320, y + 28
    );
    doc.text(quote.customer_email || '', 320, y + 42);
    doc.text(quote.customer_phone || '', 320, y + 56);
    y += 72;
    // Horizontal line
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 18;

    // --- Quote Details ---
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000').text('QUOTE', 50, y);
    y += 22;
    // First line: Quote # and Customer PO #
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Quote #:', 50, y);
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(quote.quote_number, 170, y);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Customer PO #:', 320, y);
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(quote.customer_po_number || 'N/A', 450, y);
    y += 16;
    // Second line: Quote Date and Valid Until
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Quote Date:', 50, y);
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(
      quote.quote_date ? new Date(quote.quote_date).toLocaleDateString() : '',
      170, y
    );
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Valid Until:', 320, y);
    doc.font('Helvetica').fontSize(11).fillColor('#000000').text(
      quote.valid_until ? new Date(quote.valid_until).toLocaleDateString() : '',
      450, y
    );
    y += 16;
    // Third line: VIN # (conditional rendering)
      if (quote.vin_number && quote.vin_number.trim() !== '') {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('VIN #:', 50, y);
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(quote.vin_number, 170, y);
        y += 16;
      }
      if (quote.vehicle_make && quote.vehicle_make.trim() !== '') {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Make:', 50, y);
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(quote.vehicle_make, 170, y);
        y += 16;
      }
      if (quote.vehicle_model && quote.vehicle_model.trim() !== '') {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Model:', 50, y);
        doc.font('Helvetica').fontSize(11).fillColor('#000000').text(quote.vehicle_model, 170, y);
        y += 16;
      }
      y += 8;
    // Horizontal line
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 14;

    // --- Product Information ---
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Product Information', 50, y);
    y += 16;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Product Name:', 50, y);
    doc.font('Helvetica').fontSize(11).fillColor('#000000');
    const productNameResult = doc.text(quote.product_name || 'N/A', 170, y, { width: 350 });
    y = Math.max(productNameResult.y, y) + 4;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text('Description:', 50, y);
    y = renderQuoteDescriptionToPdf(doc, quote.product_description || '', 170, y, 350) + 8;
    doc.font('Helvetica').fontSize(11).fillColor('#000000');
    // Horizontal line
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#444444').lineWidth(1).stroke();
    y += 14;

    // --- Pricing Section ---
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Estimated Price', 50, y);
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor('#000000')
      .text(formatCurrency(quote.estimated_cost), 480, y, { align: 'right', width: 70 });

    // --- Terms and Conditions ---
    y += 40;
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Terms and Conditions', 50, y);
    y += 16;
    doc.font('Helvetica').fontSize(10).fillColor('#000000');
    if (quote.terms && quote.terms.trim() !== '') {
      doc.text(quote.terms, 50, y, { width: 500 });
    } else {
      doc.text('No terms and conditions specified.', 50, y);
    }

    doc.end();
  } catch (err) {
    const error = err as Error;
    console.error('quoteRoutes: Error generating PDF (single):', error);
    res.status(500).json({ error: 'Internal server error during PDF generation', details: error.message, stack: error.stack });
  }
});

export default router; 

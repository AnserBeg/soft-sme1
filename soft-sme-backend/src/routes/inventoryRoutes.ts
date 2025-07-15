import express, { Request, Response } from 'express';
import { pool } from '../db';
import multer from 'multer';
import csv from 'csv-parser';
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  }
});

// Get all inventory items with optional part_type filter
router.get('/', async (req: Request, res: Response) => {
  console.log('inventoryRoutes: Received GET request for inventory items');
  try {
    const { partType } = req.query;
    let query = 'SELECT * FROM inventory';
    let params: any[] = [];

    // Add part_type filter if provided
    if (partType && (partType === 'stock' || partType === 'supply')) {
      query += ' WHERE part_type = $1';
      params.push(partType);
    }

    query += ' ORDER BY part_number ASC';
    
    const result = await pool.query(query, params);
    console.log(`inventoryRoutes: Successfully fetched ${result.rows.length} inventory items`);
    res.json(result.rows);
  } catch (err) {
    console.error('inventoryRoutes: Error fetching inventory:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a new inventory item
router.post('/', async (req: Request, res: Response) => {
  console.log('inventoryRoutes: Received POST request to add new item');
  const { part_number, part_description, unit, last_unit_cost, quantity_on_hand, reorder_point, part_type } = req.body;
  console.log('Request body:', req.body);

  // Only require part_number, part_description, unit, and part_type
  if (
    part_number === undefined ||
    part_description === undefined ||
    unit === undefined ||
    part_type === undefined
  ) {
    console.log('inventoryRoutes: Missing required fields');
    return res.status(400).json({ error: 'Part number, description, unit, and type are required' });
  }

  // Validate part_type
  if (!['stock', 'supply'].includes(part_type)) {
    console.log('inventoryRoutes: Invalid or missing part_type');
    return res.status(400).json({ error: 'Part type must be either "stock" or "supply"' });
  }

  // Convert part_number to uppercase for consistency
  const normalizedPartNumber = part_number.toString().trim().toUpperCase();

  try {
    // Check if part number already exists
    const existingResult = await pool.query(
      'SELECT part_number FROM inventory WHERE part_number = $1',
      [normalizedPartNumber]
    );
    
    if (existingResult.rows.length > 0) {
      console.log('inventoryRoutes: Duplicate part number detected:', normalizedPartNumber);
      return res.status(409).json({ 
        error: 'Part number already exists',
        details: `A part with number "${normalizedPartNumber}" already exists in the inventory.`
      });
    }

    const result = await pool.query(
      'INSERT INTO inventory (part_number, part_description, unit, last_unit_cost, quantity_on_hand, reorder_point, part_type) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [normalizedPartNumber, part_description, unit, last_unit_cost, quantity_on_hand, reorder_point, part_type]
    );
    const newItem = result.rows[0];
    console.log('inventoryRoutes: Successfully added new item:', newItem);
    res.status(201).json({ message: 'Inventory item added successfully', item: newItem });
  } catch (err) {
    console.error('inventoryRoutes: Error adding new item:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete an inventory item by part_number
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const decodedPartNumber = decodeURIComponent(id);
  console.log('inventoryRoutes: Received DELETE request for part_number:', decodedPartNumber);
  
  try {
    const result = await pool.query(
      'DELETE FROM inventory WHERE part_number = $1 RETURNING *',
      [decodedPartNumber]
    );
    
    if (result.rows.length === 0) {
      console.log('inventoryRoutes: Part not found for deletion:', decodedPartNumber);
      return res.status(404).json({ error: 'Inventory item not found' });
    }
    
    console.log('inventoryRoutes: Successfully deleted inventory item:', result.rows[0]);
    res.json({ message: 'Inventory item deleted successfully', deletedItem: result.rows[0] });
  } catch (err) {
    console.error('inventoryRoutes: Error deleting inventory item:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add this after the DELETE route
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const decodedPartNumber = decodeURIComponent(id);
  const { quantity_on_hand, reorder_point, last_unit_cost, part_description } = req.body;
  try {
    // Check if the item exists
    const existing = await pool.query('SELECT * FROM inventory WHERE part_number = $1', [decodedPartNumber]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    // Build update fields dynamically
    const fields = [];
    const values = [];
    let idx = 1;

    if (quantity_on_hand !== undefined) {
      fields.push(`quantity_on_hand = $${idx++}`);
      values.push(quantity_on_hand);
    }
    if (reorder_point !== undefined) {
      fields.push(`reorder_point = $${idx++}`);
      values.push(reorder_point);
    }
    if (last_unit_cost !== undefined) {
      fields.push(`last_unit_cost = $${idx++}`);
      values.push(last_unit_cost);
    }
    if (part_description !== undefined) {
      fields.push(`part_description = $${idx++}`);
      values.push(part_description);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(decodedPartNumber);

    const updateQuery = `UPDATE inventory SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE part_number = $${idx} RETURNING *`;
    const result = await pool.query(updateQuery, values);

    res.json({ message: 'Inventory item updated successfully', updatedItem: result.rows[0] });
  } catch (err) {
    console.error('inventoryRoutes: Error updating inventory item:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// CSV Upload endpoint
router.post('/upload-csv', upload.single('csvFile'), async (req: Request, res: Response) => {
  console.log('inventoryRoutes: Received CSV upload request');
  
  if (!req.file) {
    return res.status(400).json({ error: 'No CSV file uploaded' });
  }

  const results: any[] = [];
  const processedItems: { [key: string]: any } = {};
  const errors: string[] = [];
  const warnings: string[] = [];
  let rowNumber = 0; // Track actual row number from CSV file

  try {
    // Read and parse CSV file
    await new Promise((resolve, reject) => {
      if (!req.file) {
        reject(new Error('No file uploaded'));
        return;
      }
      
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => {
          rowNumber++; // Increment row number for each row processed
          
          // Skip empty rows (rows where all fields are empty or whitespace)
          const hasData = Object.values(data).some(value => 
            value && value.toString().trim().length > 0
          );
          
          if (!hasData) {
            return; // Skip this row
          }
          
          // Validate required fields
          if (!data.part_number || !data.part_description) {
            errors.push(`Row ${rowNumber}: Missing required fields (part_number and part_description are mandatory)`);
            return;
          }

          // Clean and validate data
          const partNumber = data.part_number.toString().trim().toUpperCase();
          const partDescription = data.part_description.toString().trim();
          const unit = data.unit ? data.unit.toString().trim() : 'Each';
          const quantity = parseFloat(data.quantity) || 0;
          const lastUnitCost = parseFloat(data.last_unit_cost) || 0;
          const reorderPoint = parseFloat(data.reorder_point) || 0;
          const partType = data.part_type ? data.part_type.toString().trim().toLowerCase() : 'stock';

          // Validate part type
          if (partType && !['stock', 'supply'].includes(partType)) {
            errors.push(`Row ${rowNumber}: Invalid part_type "${partType}". Must be "stock" or "supply"`);
            return;
          }

          // Validate numeric fields
          if (quantity < 0) {
            errors.push(`Row ${rowNumber}: Quantity cannot be negative`);
            return;
          }

          if (lastUnitCost < 0) {
            errors.push(`Row ${rowNumber}: Last unit cost cannot be negative`);
            return;
          }

          if (reorderPoint < 0) {
            errors.push(`Row ${rowNumber}: Reorder point cannot be negative`);
            return;
          }

          // Check for duplicates within the CSV
          if (processedItems[partNumber]) {
            const existing = processedItems[partNumber];
            
            // Check if units are different
            if (existing.unit !== unit) {
              errors.push(`Row ${rowNumber}: Duplicate part_number "${partNumber}" with different units: "${existing.unit}" vs "${unit}"`);
              return;
            }

            // Merge quantities and take higher unit cost
            existing.quantity += quantity;
            existing.lastUnitCost = Math.max(existing.lastUnitCost, lastUnitCost);
            existing.reorderPoint = Math.max(existing.reorderPoint, reorderPoint);
            
            warnings.push(`Row ${rowNumber}: Merged duplicate part_number "${partNumber}" - quantities combined, higher unit cost retained`);
            return;
          }

          // Store processed item
          processedItems[partNumber] = {
            partNumber,
            partDescription,
            unit,
            quantity,
            lastUnitCost,
            reorderPoint,
            partType,
            rowNumber: rowNumber // Store the actual row number
          };

          results.push({
            partNumber,
            partDescription,
            unit,
            quantity,
            lastUnitCost,
            reorderPoint,
            partType
          });
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // If there are validation errors, return them without processing
    if (errors.length > 0) {
      // Clean up uploaded file
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ 
        error: 'Validation errors found', 
        errors,
        warnings 
      });
    }

    // Process items in database
    let processedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const item of Object.values(processedItems)) {
      try {
        // Check if item exists in database
        const existingResult = await pool.query(
          'SELECT * FROM inventory WHERE part_number = $1',
          [item.partNumber]
        );

        if (existingResult.rows.length > 0) {
          const existing = existingResult.rows[0];
          
          // Check if units are different
          if (existing.unit !== item.unit) {
            errors.push(`Part "${item.partNumber}": Unit mismatch - database has "${existing.unit}", CSV has "${item.unit}"`);
            continue;
          }

          // Update existing item
          const newQuantity = parseFloat(existing.quantity_on_hand || 0) + item.quantity;
          const newUnitCost = item.lastUnitCost > 0 ? item.lastUnitCost : parseFloat(existing.last_unit_cost || 0);
          const newReorderPoint = Math.max(parseFloat(existing.reorder_point || 0), item.reorderPoint);

          await pool.query(
            `UPDATE inventory 
             SET quantity_on_hand = $1, 
                 last_unit_cost = $2, 
                 reorder_point = $3,
                 part_description = $4,
                 updated_at = CURRENT_TIMESTAMP
             WHERE part_number = $5`,
            [newQuantity, newUnitCost, newReorderPoint, item.partDescription, item.partNumber]
          );

          updatedCount++;
          warnings.push(`Updated existing part "${item.partNumber}" - quantities combined, higher unit cost retained`);
        } else {
          // Insert new item
          await pool.query(
            `INSERT INTO inventory 
             (part_number, part_description, unit, last_unit_cost, quantity_on_hand, reorder_point, part_type) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [item.partNumber, item.partDescription, item.unit, item.lastUnitCost, item.quantity, item.reorderPoint, item.partType]
          );

          processedCount++;
        }
      } catch (dbError) {
        console.error(`Error processing item ${item.partNumber}:`, dbError);
        errors.push(`Error processing part "${item.partNumber}": ${dbError instanceof Error ? dbError.message : 'Unknown error'}`);
      }
    }

    // Clean up uploaded file
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    // Return results
    res.json({
      message: 'CSV upload completed',
      summary: {
        totalProcessed: Object.keys(processedItems).length,
        newItems: processedCount,
        updatedItems: updatedCount,
        errors: errors.length,
        warnings: warnings.length
      },
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined
    });

  } catch (error) {
    console.error('inventoryRoutes: Error processing CSV upload:', error);
    
    // Clean up uploaded file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: 'Error processing CSV file',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Export inventory to PDF
router.get('/export/pdf', async (req: Request, res: Response) => {
  console.log('Inventory PDF export endpoint hit');
  try {
    const { partType } = req.query;
    let query = 'SELECT * FROM inventory';
    let params: any[] = [];

    // Add part_type filter if provided
    if (partType && (partType === 'stock' || partType === 'supply')) {
      query += ' WHERE part_type = $1';
      params.push(partType);
    }

    query += ' ORDER BY part_number ASC';
    
    const result = await pool.query(query, params);
    const inventory = result.rows;

    const doc = new PDFDocument({ margin: 50 });
    const typeLabel = partType === 'stock' ? 'Stock' : partType === 'supply' ? 'Supply' : 'Inventory';
    const filename = `${typeLabel.toLowerCase()}_${new Date().toISOString().split('T')[0]}.pdf`;
    res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    // Header
    doc.font('Helvetica-Bold').fontSize(20).text(`${typeLabel} List`, { align: 'center' });
    doc.moveDown();
    doc.font('Helvetica').fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(2);

    // Table headers
    const headers = ['Part #', 'Description', 'Qty on Hand', 'Unit', 'Unit Cost', 'Reorder Point', 'Value'];
    const columnWidths = [80, 150, 80, 60, 80, 80, 80];
    let y = doc.y;

    // Draw header row
    doc.font('Helvetica-Bold').fontSize(9);
    let x = 50;
    headers.forEach((header, index) => {
      doc.text(header, x, y, { width: columnWidths[index] });
      x += columnWidths[index];
    });

    y += 20;
    doc.moveTo(50, y).lineTo(570, y).stroke();

    // Draw data rows
    doc.font('Helvetica').fontSize(8);
    inventory.forEach((item, index) => {
      if (y > doc.page.height - 100) {
        doc.addPage();
        y = 50;
      }

      x = 50;
      doc.text(item.part_number || '', x, y, { width: columnWidths[0] });
      x += columnWidths[0];
      doc.text(item.part_description || '', x, y, { width: columnWidths[1] });
      x += columnWidths[1];
      doc.text((item.quantity_on_hand || 0).toString(), x, y, { width: columnWidths[2] });
      x += columnWidths[2];
      doc.text(item.unit || '', x, y, { width: columnWidths[3] });
      x += columnWidths[3];
      doc.text(`$${(item.last_unit_cost || 0).toFixed(2)}`, x, y, { width: columnWidths[4] });
      x += columnWidths[4];
      doc.text((item.reorder_point || 0).toString(), x, y, { width: columnWidths[5] });
      x += columnWidths[5];
      
      const value = (item.quantity_on_hand || 0) * (item.last_unit_cost || 0);
      doc.text(`$${value.toFixed(2)}`, x, y, { width: columnWidths[6] });

      y += 15;
      
      // Draw row separator
      doc.moveTo(50, y).lineTo(570, y).stroke();
      y += 5;
    });

    doc.end();
  } catch (err) {
    console.error('inventoryRoutes: Error generating PDF:', err);
    res.status(500).json({ error: 'Internal server error during PDF generation', details: err.message, stack: err.stack });
  }
});

// Get CSV template endpoint
router.get('/csv-template', (req: Request, res: Response) => {
  const csvTemplate = `part_number,part_description,unit,quantity,last_unit_cost,reorder_point,part_type
ABC123,Sample Part Description,Each,10,25.50,5,stock
XYZ789,Another Part,cm,5,15.75,2,supply
LIQ001,Liquid Product,L,20,12.00,5,stock`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="inventory_template.csv"');
  res.send(csvTemplate);
});

export default router; 
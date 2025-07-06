import express, { Request, Response } from 'express';
import { pool } from '../db';
import multer from 'multer';
import csv from 'csv-parser';
import fs from 'fs';
import path from 'path';

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
  console.log('inventoryRoutes: Received DELETE request for part_number:', id);
  
  try {
    const result = await pool.query(
      'DELETE FROM inventory WHERE part_number = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      console.log('inventoryRoutes: Part not found for deletion:', id);
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
  const { quantity_on_hand, reorder_point, last_unit_cost, part_description } = req.body;
  try {
    // Check if the item exists
    const existing = await pool.query('SELECT * FROM inventory WHERE part_number = $1', [id]);
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

    values.push(id);

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
  const errors: string[] = [];
  const warnings: string[] = [];
  const processedItems: { [key: string]: any } = {};

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
          // Validate required fields
          if (!data.part_number || !data.part_description) {
            errors.push(`Row ${results.length + 1}: Missing required fields (part_number and part_description are mandatory)`);
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
            errors.push(`Row ${results.length + 1}: Invalid part_type "${partType}". Must be "stock" or "supply"`);
            return;
          }

          // Validate numeric fields
          if (quantity < 0) {
            errors.push(`Row ${results.length + 1}: Quantity cannot be negative`);
            return;
          }

          if (lastUnitCost < 0) {
            errors.push(`Row ${results.length + 1}: Last unit cost cannot be negative`);
            return;
          }

          if (reorderPoint < 0) {
            errors.push(`Row ${results.length + 1}: Reorder point cannot be negative`);
            return;
          }

          // Check for duplicates within the CSV
          if (processedItems[partNumber]) {
            const existing = processedItems[partNumber];
            
            // Check if units are different
            if (existing.unit !== unit) {
              errors.push(`Row ${results.length + 1}: Duplicate part_number "${partNumber}" with different units: "${existing.unit}" vs "${unit}"`);
              return;
            }

            // Merge quantities and take higher unit cost
            existing.quantity += quantity;
            existing.lastUnitCost = Math.max(existing.lastUnitCost, lastUnitCost);
            existing.reorderPoint = Math.max(existing.reorderPoint, reorderPoint);
            
            warnings.push(`Row ${results.length + 1}: Merged duplicate part_number "${partNumber}" - quantities combined, higher unit cost retained`);
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
            rowNumber: results.length + 1
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
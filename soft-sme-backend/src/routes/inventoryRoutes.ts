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
    let query = 'SELECT part_id, part_number, part_description, unit, last_unit_cost, quantity_on_hand, reorder_point, part_type, category, created_at, updated_at FROM inventory';
    let params: any[] = [];

    // Add part_type filter if provided
    if (partType && (partType === 'stock' || partType === 'supply')) {
      query += ' WHERE part_type = $1';
      params.push(partType);
    }

    query += ' ORDER BY part_number ASC';
    
    const result = await pool.query(query, params);
    console.log(`inventoryRoutes: Successfully fetched ${result.rows.length} inventory items`);
    
    // Debug: Log a few sample items to check data types
    if (result.rows.length > 0) {
      console.log('Sample inventory item:', {
        part_number: result.rows[0].part_number,
        last_unit_cost: result.rows[0].last_unit_cost,
        last_unit_cost_type: typeof result.rows[0].last_unit_cost,
        quantity_on_hand: result.rows[0].quantity_on_hand,
        quantity_on_hand_type: typeof result.rows[0].quantity_on_hand
      });
    }
    
    res.json(result.rows);
  } catch (err) {
    console.error('inventoryRoutes: Error fetching inventory:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get CSV template endpoint (must come before /:partNumber route)
router.get('/csv-template', (req: Request, res: Response) => {
  const csvTemplate = `part_number,part_description,unit,quantity,last_unit_cost,reorder_point,part_type,category,vendor_name
ABC123,Sample Part Description,Each,10,25.50,5,stock,Fasteners,ABC Supply Co
E-11,Hyphen allowed visually,pcs,5,15.75,2,stock,Electrical,XYZ Electronics
(1/2)HOSE,Use parentheses for fractions,ft,20,12.00,5,stock,Plumbing,Plumbing Plus`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="inventory_template.csv"');
  res.send(csvTemplate);
});

// Get a single inventory item by part number
router.get('/:partNumber', async (req: Request, res: Response) => {
  const { partNumber } = req.params;
  const decodedPartNumber = decodeURIComponent(partNumber);
  console.log('inventoryRoutes: Received GET request for part:', decodedPartNumber);
  
  try {
    const result = await pool.query(
      'SELECT * FROM inventory WHERE part_number = $1',
      [decodedPartNumber]
    );
    
    if (result.rows.length === 0) {
      console.log('inventoryRoutes: Part not found:', decodedPartNumber);
      return res.status(404).json({ error: 'Inventory item not found' });
    }
    
    console.log('inventoryRoutes: Successfully fetched inventory item:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('inventoryRoutes: Error fetching inventory item:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function normalizePartNumberForDuplicateCheck(partNumber: string): string {
  return partNumber.replace(/[\s-]/g, '').toUpperCase();
}

function isSlashInsideParentheses(input: string): boolean {
  if (!input.includes('/')) return true;
  const slashIndices: number[] = [];
  for (let i = 0; i < input.length; i++) if (input[i] === '/') slashIndices.push(i);
  if (slashIndices.length === 0) return true;
  const prevOpen: number[] = new Array(input.length).fill(-1);
  let lastOpen = -1;
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '(') lastOpen = i;
    prevOpen[i] = lastOpen;
  }
  const nextClose: number[] = new Array(input.length).fill(-1);
  let next = -1;
  for (let i = input.length - 1; i >= 0; i--) {
    if (input[i] === ')') next = i;
    nextClose[i] = next;
  }
  return slashIndices.every(idx => prevOpen[idx] !== -1 && nextClose[idx] !== -1 && prevOpen[idx] < idx && idx < nextClose[idx]);
}

function cleanPartNumberRaw(input: string): { cleaned: string, hadIllegal: boolean } {
  // Remove spaces, keep only A-Z, 0-9, '-', '/', '(', ')'
  const upper = input.toUpperCase();
  const noSpaces = upper.replace(/\s+/g, '');
  const cleaned = noSpaces.replace(/[^A-Z0-9\-\/()]/g, '');
  const hadIllegal = cleaned.length !== noSpaces.length;
  console.log(`cleanPartNumberRaw: "${input}" -> "${cleaned}" (hadIllegal: ${hadIllegal})`);
  return { cleaned, hadIllegal };
}

// Enhanced cleaning function that handles fraction formatting
function cleanPartNumberAdvanced(input: string): { cleaned: string, hadIllegal: boolean } {
  console.log(`cleanPartNumberAdvanced: Starting with "${input}"`);
  
  // Step 1: Basic cleaning (uppercase, remove spaces, filter characters)
  const upper = input.toUpperCase();
  const noSpaces = upper.replace(/\s+/g, '');
  const basicCleaned = noSpaces.replace(/[^A-Z0-9\-\/()]/g, '');
  const hadIllegal = basicCleaned.length !== noSpaces.length;
  
  console.log(`cleanPartNumberAdvanced: Basic cleaning "${input}" -> "${basicCleaned}"`);
  
  // Step 2: Fix double parentheses first (before fraction formatting)
  let result = basicCleaned;
  
  // Fix double parentheses by removing the outer set
  if (result.includes('((') || result.includes('))')) {
    console.log(`Found double parentheses in: "${result}"`);
    
    // Replace (( with ( and )) with )
    result = result.replace(/\(\(/g, '(');
    result = result.replace(/\)\)/g, ')');
    
    // Also handle cases like ((1/4)) -> (1/4)
    result = result.replace(/\(\(([^)]+)\)\)/g, '($1)');
    
    console.log(`Fixed double parentheses: "${basicCleaned}" -> "${result}"`);
  }
  
  // Step 3: Handle fraction formatting (only if not already formatted)
  
  // First, handle complex fractions like 1-1/4 -> 1(1/4) (but only if not already formatted)
  const complexFractionPattern = /(\d+)-(\d+)\/(\d+)/g;
  result = result.replace(complexFractionPattern, (match, p1, p2, p3) => {
    // Check if this specific fraction is already properly formatted
    const expectedFormatted = `${p1}(${p2}/${p3})`;
    // Look for the formatted version in the original string
    if (input.includes(expectedFormatted)) {
      console.log(`Complex fraction already formatted: "${match}" -> keeping as is`);
      return match; // Already formatted, don't change
    }
    console.log(`Formatting complex fraction: "${match}" -> "${expectedFormatted}"`);
    return expectedFormatted;
  });
  
  console.log(`cleanPartNumberAdvanced: After complex fraction formatting -> "${result}"`);
  
  // Then handle simple fractions like 1/4 -> (1/4) (but only if not already formatted)
  // Use a negative lookbehind to avoid matching fractions already in parentheses
  const fractionPattern = /(?<!\()(\d+)\/(\d+)(?!\))/g;
  result = result.replace(fractionPattern, (match, p1, p2) => {
    console.log(`Formatting simple fraction: "${match}" -> "(${p1}/${p2})"`);
    return `(${p1}/${p2})`;
  });
  
  console.log(`cleanPartNumberAdvanced: After fraction formatting -> "${result}"`);
  
  // Step 4: Remove all hyphens (and other punctuation except ()/)
  // Remove all hyphens
  result = result.replace(/-/g, '');
  
  console.log(`cleanPartNumberAdvanced: Final result "${input}" -> "${result}" (hadIllegal: ${hadIllegal})`);
  
  return { cleaned: result, hadIllegal };
}

function isAllowedCharactersOnly(input: string): boolean {
  return /^[A-Z0-9()\/-]+$/.test(input);
}

// Add a new inventory item
router.post('/', async (req: Request, res: Response) => {
  console.log('inventoryRoutes: Received POST request to add new item');
  const { part_number, part_description, unit, last_unit_cost, quantity_on_hand, reorder_point, part_type, category } = req.body;
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

  // Validate: no spaces in part_number
  if (/\s/.test(part_number)) {
    return res.status(400).json({ error: 'Part number cannot contain spaces' });
  }

  // Validate: any '/' must be inside parentheses
  if (!isSlashInsideParentheses(String(part_number))) {
    return res.status(400).json({ error: "Fractions must be enclosed in parentheses, e.g., '(1/2)'" });
  }

  // Validate: only allowed characters A-Z, 0-9, '-', '/', '(', ')'
  const upperPn = String(part_number).toUpperCase();
  if (!isAllowedCharactersOnly(upperPn.replace(/\s+/g, ''))) {
    return res.status(400).json({ error: 'Only letters/numbers and - / ( ) are allowed in part number' });
  }

  // Trim all string fields and convert part_number to uppercase
  const trimmedPartNumber = part_number.toString().trim().toUpperCase();
  const trimmedPartDescription = part_description.toString().trim();
  const trimmedUnit = unit.toString().trim();
  const trimmedPartType = part_type.toString().trim();
  const trimmedCategory = category ? category.toString().trim() : 'Uncategorized';

  try {
    // Duplicate check with normalization: ignore dashes and spaces
    const normalized = normalizePartNumberForDuplicateCheck(trimmedPartNumber);
    const existingResult = await pool.query(
      `SELECT part_number FROM inventory WHERE REPLACE(REPLACE(UPPER(part_number), '-', ''), ' ', '') = $1`,
      [normalized]
    );
    if (existingResult.rows.length > 0) {
      const existingPn = existingResult.rows[0].part_number;
      console.log('inventoryRoutes: Duplicate part number detected (normalized match):', trimmedPartNumber, 'matches', existingPn);
      return res.status(409).json({ 
        error: 'Part number already exists',
        details: `A part with number "${existingPn}" already exists (normalized match for "${trimmedPartNumber}").`
      });
    }

    const result = await pool.query(
      'INSERT INTO inventory (part_number, part_description, unit, last_unit_cost, quantity_on_hand, reorder_point, part_type, category) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [trimmedPartNumber, trimmedPartDescription, trimmedUnit, last_unit_cost, quantity_on_hand, reorder_point, trimmedPartType, trimmedCategory]
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
  const { quantity_on_hand, reorder_point, last_unit_cost, part_description, unit, part_type, category, part_number } = req.body;

  console.log('🔍 PUT /api/inventory/:id called');
  console.log('📋 URL param id:', id);
  console.log('📋 decodedPartNumber:', decodedPartNumber);
  console.log('📋 Request body:', req.body);
  console.log('📋 part_number from body:', part_number);

  // Trim string fields if provided
  const trimmedPartDescription = part_description ? part_description.toString().trim() : undefined;
  const trimmedUnit = unit ? unit.toString().trim() : undefined;
  const trimmedPartType = part_type ? part_type.toString().trim() : undefined;
  const trimmedCategory = category ? category.toString().trim() : undefined;
  const trimmedPartNumber = part_number ? part_number.toString().trim().toUpperCase() : undefined;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if the item exists
    const existing = await client.query('SELECT * FROM inventory WHERE part_number = $1', [decodedPartNumber]);
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    const existingItem = existing.rows[0];
    const partId = existingItem.part_id;

    // Handle part number change if provided
    console.log(`🔍 Checking part number change: trimmedPartNumber="${trimmedPartNumber}", decodedPartNumber="${decodedPartNumber}"`);
    if (trimmedPartNumber && trimmedPartNumber !== decodedPartNumber) {
      console.log(`✅ Part number change detected: ${decodedPartNumber} -> ${trimmedPartNumber}`);

      // Check if new part number already exists
      const duplicateCheck = await client.query('SELECT part_number FROM inventory WHERE part_number = $1 AND part_id != $2', [trimmedPartNumber, partId]);
      if (duplicateCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Part number already exists' });
      }

      // Update part number in inventory
      await client.query('UPDATE inventory SET part_number = $1 WHERE part_id = $2', [trimmedPartNumber, partId]);

      // Update part_number in related tables (only those that have part_number column)
      await client.query('UPDATE inventory_vendors SET part_number = $1 WHERE part_id = $2', [trimmedPartNumber, partId]);
      
      // Update part_number in line item tables (they now use part_id as FK, but still have part_number for display)
      await client.query('UPDATE salesorderlineitems SET part_number = $1 WHERE part_id = $2', [trimmedPartNumber, partId]);
      await client.query('UPDATE purchaselineitems SET part_number = $1 WHERE part_id = $2', [trimmedPartNumber, partId]);
      await client.query('UPDATE purchase_order_allocations SET part_number = $1 WHERE part_id = $2', [trimmedPartNumber, partId]);
      
      // Note: inventory_audit_log uses part_id, so no need to update part_number there

      console.log(`✅ Successfully updated part number from ${decodedPartNumber} to ${trimmedPartNumber}`);
    } else {
      console.log(`❌ No part number change detected or trimmedPartNumber is undefined`);
    }

    // Build update fields dynamically (excluding part_number as it's handled above)
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
    if (trimmedPartDescription !== undefined) {
      fields.push(`part_description = $${idx++}`);
      values.push(trimmedPartDescription);
    }
    if (trimmedUnit !== undefined) {
      fields.push(`unit = $${idx++}`);
      values.push(trimmedUnit);
    }
    if (trimmedPartType !== undefined) {
      fields.push(`part_type = $${idx++}`);
      values.push(trimmedPartType);
    }
    if (trimmedCategory !== undefined) {
      fields.push(`category = $${idx++}`);
      values.push(trimmedCategory);
    }

    if (fields.length > 0) {
      values.push(partId);
      const updateQuery = `UPDATE inventory SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE part_id = $${idx} RETURNING *`;
      const result = await client.query(updateQuery, values);
      await client.query('COMMIT');
      res.json({ message: 'Inventory item updated successfully', updatedItem: result.rows[0] });
    } else {
      // Just get the updated item if no other fields changed
      const result = await client.query('SELECT * FROM inventory WHERE part_id = $1', [partId]);
      await client.query('COMMIT');
      res.json({ message: 'Inventory item updated successfully', updatedItem: result.rows[0] });
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('inventoryRoutes: Error updating inventory item:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// CSV Upload endpoint
router.post('/upload-csv', upload.single('csvFile'), async (req: Request, res: Response) => {
  console.log('inventoryRoutes: Received CSV upload request');
  
  if (!req.file) {
    return res.status(400).json({ error: 'No CSV file uploaded' });
  }

  const results: any[] = [];
  // Keyed by normalized part number (uppercase, no spaces or dashes)
  const processedItems: { [normalizedKey: string]: any } = {};
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

                                           // Clean and validate data - apply same cleaning rules as cleanup function
            const originalPartNumber = data.part_number.toString();
            const { cleaned: cleanedPartNumber, hadIllegal } = cleanPartNumberAdvanced(originalPartNumber);
            const slashOk = isSlashInsideParentheses(cleanedPartNumber);
            const allowedOnly = isAllowedCharactersOnly(cleanedPartNumber);
           
           // Check for slash violations (cannot auto-fix)
           if (!slashOk) {
             errors.push(`Row ${rowNumber}: Fractions must be enclosed in parentheses, e.g., (1/2) (received: "${originalPartNumber}")`);
             return;
           }
           
           // Check for illegal characters (cannot auto-fix)
           if (!allowedOnly) {
             errors.push(`Row ${rowNumber}: Only letters/numbers and - / ( ) are allowed in part number (received: "${originalPartNumber}")`);
             return;
           }
           
           // Use cleaned part number for processing
           const partNumber = cleanedPartNumber;
           const normalizedKey = normalizePartNumberForDuplicateCheck(partNumber);
          const partDescription = data.part_description.toString().trim();
          const unit = data.unit ? data.unit.toString().trim() : 'Each';
          const quantity = parseFloat(data.quantity) || 0;
          
          // Debug last_unit_cost parsing for recent uploads
          console.log(`Row ${rowNumber}: last_unit_cost raw value: "${data.last_unit_cost}"`);
          const lastUnitCostParsed = parseFloat(data.last_unit_cost);
          console.log(`Row ${rowNumber}: last_unit_cost parsed: ${lastUnitCostParsed}`);
          const lastUnitCost = lastUnitCostParsed || 0;
          console.log(`Row ${rowNumber}: last_unit_cost final: ${lastUnitCost}`);
          
          const reorderPoint = parseFloat(data.reorder_point) || 0;
          const partType = data.part_type ? data.part_type.toString().trim().toLowerCase() : 'stock';
          const category = data.category ? data.category.toString().trim() : 'Uncategorized';
          const vendorName = data.vendor_name ? data.vendor_name.toString().trim() : null;

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

                     // Check for duplicates within the CSV (normalized)
           if (processedItems[normalizedKey]) {
             const existing = processedItems[normalizedKey];
             
             // Check if units are different
             if (existing.unit !== unit) {
               errors.push(`Row ${rowNumber}: Duplicate part_number "${partNumber}" (normalized match) with different units: "${existing.unit}" vs "${unit}"`);
               return;
             }

             // Merge quantities and take higher unit cost
             existing.quantity += quantity;
             existing.lastUnitCost = Math.max(existing.lastUnitCost, lastUnitCost);
             existing.reorderPoint = Math.max(existing.reorderPoint, reorderPoint);
             
             warnings.push(`Row ${rowNumber}: Merged duplicate part_number "${partNumber}" (normalized match) - quantities combined, higher unit cost retained`);
             return;
           }
           
           // Add warning if part number was cleaned
           if (originalPartNumber !== partNumber) {
             warnings.push(`Row ${rowNumber}: Part number "${originalPartNumber}" was cleaned to "${partNumber}"`);
           }

          // Store processed item
          processedItems[normalizedKey] = {
            visualPartNumber: partNumber, // keep for insert if new
            normalizedKey,
            partDescription,
            unit,
            quantity,
            lastUnitCost,
            reorderPoint,
            partType,
            category,
            vendorName,
            rowNumber: rowNumber // Store the actual row number
          };

          results.push({
            partNumber: partNumber,
            partDescription,
            unit,
            quantity,
            lastUnitCost,
            reorderPoint,
            partType,
            category,
            vendorName
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
          `SELECT * FROM inventory WHERE REPLACE(REPLACE(UPPER(part_number), '-', ''), ' ', '') = $1`,
          [item.normalizedKey]
        );

                 if (existingResult.rows.length > 0) {
           const existing = existingResult.rows[0];
           
           // Check if units are different
           if (existing.unit !== item.unit) {
             errors.push(`Part "${item.visualPartNumber}": Unit mismatch - database has "${existing.unit}", CSV has "${item.unit}"`);
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
                  category = $5,
                  updated_at = CURRENT_TIMESTAMP
              WHERE part_number = $6`,
             [newQuantity, newUnitCost, newReorderPoint, item.partDescription, item.category, existing.part_number]
           );

           updatedCount++;
           warnings.push(`Updated existing part "${existing.part_number}" (normalized match for "${item.visualPartNumber}") - quantities combined, higher unit cost retained`);
         } else {
           // Insert new item using cleaned part number
           await pool.query(
             `INSERT INTO inventory 
              (part_number, part_description, unit, last_unit_cost, quantity_on_hand, reorder_point, part_type, category) 
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
             [item.visualPartNumber, item.partDescription, item.unit, item.lastUnitCost, item.quantity, item.reorderPoint, item.partType, item.category]
           );

           processedCount++;
         }
      } catch (dbError) {
        console.error(`Error processing item ${item.partNumber}:`, dbError);
        errors.push(`Error processing part "${item.visualPartNumber}": ${dbError instanceof Error ? dbError.message : 'Unknown error'}`);
      }
    }

    // Process vendor mappings for items with vendor names
    console.log('Processing vendor mappings...');
    let vendorMappingCount = 0;
    for (const item of Object.values(processedItems)) {
      if (item.vendorName) {
        try {
          // Find or create vendor
          let vendorResult = await pool.query(
            'SELECT vendor_id FROM vendormaster WHERE vendor_name = $1',
            [item.vendorName]
          );

          let vendorId: number;
          if (vendorResult.rows.length === 0) {
            // Create new vendor
            const newVendorResult = await pool.query(
              'INSERT INTO vendormaster (vendor_name) VALUES ($1) RETURNING vendor_id',
              [item.vendorName]
            );
            vendorId = newVendorResult.rows[0].vendor_id;
            console.log(`Created new vendor: ${item.vendorName} (ID: ${vendorId})`);
          } else {
            vendorId = vendorResult.rows[0].vendor_id;
          }

          // Get the canonical part number and part_id from inventory
          const partResult = await pool.query(
            `SELECT part_number, part_id FROM inventory WHERE REPLACE(REPLACE(UPPER(part_number), '-', ''), ' ', '') = $1`,
            [item.normalizedKey]
          );

          if (partResult.rows.length > 0) {
            const canonicalPartNumber = partResult.rows[0].part_number;
            const canonicalPartId = partResult.rows[0].part_id;
            
            // Check if vendor mapping already exists
            const existingMappingResult = await pool.query(
              'SELECT id FROM inventory_vendors WHERE part_id = $1 AND vendor_id = $2',
              [canonicalPartId, vendorId]
            );

            if (existingMappingResult.rows.length === 0) {
              // Create new vendor mapping with part_id
              await pool.query(
                `INSERT INTO inventory_vendors (part_number, part_id, vendor_id, vendor_part_number, vendor_part_description, usage_count, last_used_at)
                 VALUES ($1, $2, $3, $4, $5, 1, NOW())`,
                [
                  canonicalPartNumber,
                  canonicalPartId,
                  vendorId,
                  item.visualPartNumber, // Use the part number from CSV as vendor part number
                  item.partDescription || null
                ]
              );
              vendorMappingCount++;
              console.log(`Created vendor mapping for part ${canonicalPartNumber} (ID: ${canonicalPartId}) to vendor ${item.vendorName}`);
            } else {
              // Update existing mapping
              await pool.query(
                `UPDATE inventory_vendors 
                 SET usage_count = usage_count + 1, 
                     last_used_at = NOW(),
                     vendor_part_description = COALESCE($1, vendor_part_description)
                 WHERE part_id = $2 AND vendor_id = $3`,
                [item.partDescription || null, canonicalPartId, vendorId]
              );
              vendorMappingCount++;
              console.log(`Updated vendor mapping for part ${canonicalPartNumber} (ID: ${canonicalPartId}) to vendor ${item.vendorName}`);
            }
          }
        } catch (vendorError) {
          console.error(`Error processing vendor mapping for part ${item.visualPartNumber}:`, vendorError);
          warnings.push(`Failed to create vendor mapping for part "${item.visualPartNumber}" with vendor "${item.vendorName}": ${vendorError instanceof Error ? vendorError.message : 'Unknown error'}`);
        }
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
        vendorMappings: vendorMappingCount,
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
    const error = err as Error;
    console.error('inventoryRoutes: Error generating PDF:', error);
    res.status(500).json({ error: 'Internal server error during PDF generation', details: error.message, stack: error.stack });
  }
});



// Cleanup inventory spaces endpoint
router.post('/cleanup-spaces', async (req: Request, res: Response) => {
  console.log('inventoryRoutes: Received POST request to cleanup inventory spaces');
  
  const client = await pool.connect();
  
  try {
    console.log('Starting inventory space cleanup...');
    
    // Get all inventory items
    const result = await client.query('SELECT * FROM inventory');
    const items = result.rows;
    
    console.log(`Found ${items.length} inventory items to process`);
    
    let updatedCount = 0;
    let errorCount = 0;
    
    for (const item of items) {
                           try {
          // Apply full cleaning rules to part number
          const originalPartNumber = String(item.part_number || '');
          const { cleaned: cleanedPartNumber, hadIllegal } = cleanPartNumberAdvanced(originalPartNumber);
          const slashOk = isSlashInsideParentheses(cleanedPartNumber);
         
                   console.log(`cleanup-spaces processing: "${originalPartNumber}" -> cleaned: "${cleanedPartNumber}", slashOk: ${slashOk}, hadIllegal: ${hadIllegal}`);
         
                   // Check if any fields need trimming or cleaning
          const needsUpdate = 
            item.part_description !== item.part_description.trim() ||
            item.unit !== item.unit.trim() ||
            item.part_type !== item.part_type.trim() ||
            (item.category && item.category !== item.category.trim()) ||
            originalPartNumber !== cleanedPartNumber ||
            hadIllegal ||
            /\s/.test(originalPartNumber);
         
                   if (needsUpdate) {
            // Skip part numbers with slash violations (require manual fixing)
            const finalPartNumber = slashOk ? cleanedPartNumber : originalPartNumber;
            
            console.log(`Updating item: "${item.part_number}" -> "${finalPartNumber}" (needsUpdate: ${needsUpdate})`);
           
           // Update with cleaned values
           await client.query(`
             UPDATE inventory 
             SET 
               part_number = $1,
               part_description = $2,
               unit = $3,
               part_type = $4,
               category = $5,
               updated_at = CURRENT_TIMESTAMP
             WHERE part_number = $6
           `, [
             finalPartNumber,
             item.part_description.trim(),
             item.unit.trim(),
             item.part_type.trim(),
             item.category ? item.category.trim() : 'Uncategorized',
             item.part_number // Use original for WHERE clause
           ]);
           
           updatedCount++;
           if (originalPartNumber !== finalPartNumber) {
             console.log(`Cleaned part number: "${originalPartNumber}" -> "${finalPartNumber}"`);
           } else {
             console.log(`Trimmed fields for: "${item.part_number}"`);
           }
         } else {
           console.log(`No update needed for: "${item.part_number}"`);
         }
      } catch (error) {
        errorCount++;
        console.error(`Error updating item ${item.part_number}:`, error);
      }
    }
    
    console.log(`Cleanup completed: ${updatedCount} items updated, ${errorCount} errors`);
    
    res.json({
      success: true,
      message: 'Inventory cleanup completed successfully',
      summary: {
        totalProcessed: items.length,
        itemsUpdated: updatedCount,
        errors: errorCount
      }
    });
    
  } catch (error) {
    console.error('Error during inventory cleanup:', error);
    res.status(500).json({ 
      error: 'Internal server error during cleanup',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

// Enforce rules and detect duplicates (preview/apply)
router.post('/cleanup-enforce', async (req: Request, res: Response) => {
  const { partType, apply = false, merges = [] } = req.body || {};
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Load items
    const baseQuery = partType && (partType === 'stock' || partType === 'supply')
      ? 'SELECT * FROM inventory WHERE part_type = $1'
      : 'SELECT * FROM inventory';
    const params = partType && (partType === 'stock' || partType === 'supply') ? [partType] : [];
    const itemsResult = await client.query(baseQuery, params);
    const items = itemsResult.rows;

    type Fix = { part_number: string; cleaned_part_number: string; actions: string[]; slash_violation: boolean };
    const fixes: Fix[] = [];
    const slashViolations: string[] = [];

    // Build duplicates map by normalized key
    const dupMap: Record<string, { normalized: string; candidates: any[] }> = {};

                   for (const item of items) {
        const original = String(item.part_number || '');
        const { cleaned, hadIllegal } = cleanPartNumberAdvanced(original);
        const slashOk = isSlashInsideParentheses(cleaned);
        const allowedOnly = isAllowedCharactersOnly(cleaned);
        const actions: string[] = [];
        if (original !== original.trim()) actions.push('trimmed');
        if (hadIllegal) actions.push('removed_illegal_chars');
        if (/\s/.test(original)) actions.push('removed_spaces');
        if (original !== cleaned) actions.push('uppercased_and_filtered');
        if (original !== cleaned) actions.push('fraction_formatting');

        console.log(`cleanup-enforce processing: "${original}" -> cleaned: "${cleaned}", slashOk: ${slashOk}, allowedOnly: ${allowedOnly}`);

        if (!slashOk) {
          // Cannot auto-fix; require manual formatting
          slashViolations.push(original);
        }

        if (original !== cleaned || hadIllegal || !allowedOnly || !slashOk) {
          fixes.push({ part_number: original, cleaned_part_number: cleaned, actions, slash_violation: !slashOk });
          console.log(`Added fix: "${original}" -> "${cleaned}" (actions: ${actions.join(', ')})`);
        }

        const normKey = normalizePartNumberForDuplicateCheck(cleaned);
        if (!dupMap[normKey]) dupMap[normKey] = { normalized: normKey, candidates: [] };
        dupMap[normKey].candidates.push(item);
      }

    const duplicateGroups = Object.values(dupMap)
      .filter(group => group.candidates.length > 1)
      .map(group => {
        // Prefer a candidate that contains '-' in part_number as keep, else first
        const withDash = group.candidates.find((c: any) => String(c.part_number).includes('-')) || group.candidates[0];
        const units = new Set(group.candidates.map((c: any) => c.unit));
        const unitMismatch = units.size > 1;
        return {
          normalizedKey: group.normalized,
          candidates: group.candidates.map((c: any) => ({ part_number: c.part_number, unit: c.unit })),
          proposedKeep: withDash.part_number,
          unitMismatch,
        };
      });

    if (!apply) {
      await client.query('ROLLBACK');
      return res.json({
        success: true,
        preview: {
          totalItems: items.length,
          fixes,
          duplicateGroups,
        }
      });
    }

    // Apply: 1) standardize allowed characters and remove spaces (excluding slash violations)
    let fixesApplied = 0;
    let fixesSkipped = 0;
    for (const fx of fixes) {
      // Skip slash violations as they require manual fixing
      if (fx.slash_violation) { 
        fixesSkipped++; 
        continue; 
      }
      
      // Skip if no change needed
      if (fx.part_number === fx.cleaned_part_number) continue;
      
      // Check if target already exists (this will be handled by merging later)
      const existingTarget = await client.query('SELECT part_number FROM inventory WHERE part_number = $1', [fx.cleaned_part_number]);
      if (existingTarget.rows.length > 0) { 
        fixesSkipped++; 
        continue; 
      }
      
      // Apply the fix by updating the part number
      await client.query(
        'UPDATE inventory SET part_number = $1, updated_at = CURRENT_TIMESTAMP WHERE part_number = $2',
        [fx.cleaned_part_number, fx.part_number]
      );
      fixesApplied++;
      console.log(`Applied fix: "${fx.part_number}" -> "${fx.cleaned_part_number}" (actions: ${fx.actions.join(', ')})`);
    }

    // Apply: 2) perform merges if provided
    let mergedGroups = 0;
    let mergedItems = 0;
    for (const merge of merges as Array<{ keepPartNumber: string; mergePartNumbers: string[] }>) {
      const keepPn = String(merge.keepPartNumber).toUpperCase();
      const keepRes = await client.query('SELECT * FROM inventory WHERE part_number = $1', [keepPn]);
      if (keepRes.rows.length === 0) continue;
      let keep = keepRes.rows[0];
      for (const mp of merge.mergePartNumbers || []) {
        const mPn = String(mp).toUpperCase();
        if (mPn === keepPn) continue;
        const mRes = await client.query('SELECT * FROM inventory WHERE part_number = $1', [mPn]);
        if (mRes.rows.length === 0) continue;
        const dup = mRes.rows[0];
        // If unit mismatch, skip this merge
        if (dup.unit !== keep.unit) continue;
        // Sum quantities (treat 'NA' as 0), max costs and reorder points
        const keepQty = parseFloat(keep.quantity_on_hand || 0) || 0;
        const dupQty = parseFloat(dup.quantity_on_hand || 0) || 0;
        const newQty = keepQty + dupQty;
        const newCost = Math.max(parseFloat(keep.last_unit_cost || 0) || 0, parseFloat(dup.last_unit_cost || 0) || 0);
        const newReorder = Math.max(parseFloat(keep.reorder_point || 0) || 0, parseFloat(dup.reorder_point || 0) || 0);
        await client.query(
          `UPDATE inventory SET quantity_on_hand = $1, last_unit_cost = $2, reorder_point = $3, updated_at = CURRENT_TIMESTAMP WHERE part_number = $4`,
          [newQty, newCost, newReorder, keep.part_number]
        );
        await client.query('DELETE FROM inventory WHERE part_number = $1', [dup.part_number]);
        mergedItems++;
      }
      mergedGroups++;
    }

    await client.query('COMMIT');
    return res.json({
      success: true,
      applied: {
        fixesApplied,
        fixesSkipped,
        mergedGroups,
        mergedItems,
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('inventoryRoutes: Error during cleanup-enforce:', error);
    res.status(500).json({ error: 'Internal server error during cleanup-enforce' });
  } finally {
    client.release();
  }
});

// Auto-cleanup endpoint that applies all possible fixes automatically
router.post('/cleanup-auto', async (req: Request, res: Response) => {
  const { partType } = req.body || {};
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Load items
    const baseQuery = partType && (partType === 'stock' || partType === 'supply')
      ? 'SELECT * FROM inventory WHERE part_type = $1'
      : 'SELECT * FROM inventory';
    const params = partType && (partType === 'stock' || partType === 'supply') ? [partType] : [];
    const itemsResult = await client.query(baseQuery, params);
    const items = itemsResult.rows;

    console.log(`Starting auto-cleanup for ${items.length} items...`);

    // Step 1: Apply all possible fixes (excluding slash violations)
    let fixesApplied = 0;
    let fixesSkipped = 0;
    const slashViolations: string[] = [];

         for (const item of items) {
       const original = String(item.part_number || '');
       const { cleaned, hadIllegal } = cleanPartNumberAdvanced(original);
       const slashOk = isSlashInsideParentheses(cleaned);
       
       console.log(`Processing item: "${original}" -> cleaned: "${cleaned}", slashOk: ${slashOk}, hadIllegal: ${hadIllegal}`);
       
       if (!slashOk) {
         slashViolations.push(original);
         console.log(`Skipping slash violation: "${original}"`);
         continue;
       }

       // Check if any cleaning is needed (including case changes, spaces, illegal chars, fraction formatting)
       const needsCleaning = original !== cleaned || hadIllegal || /\s/.test(original);
       
       console.log(`Needs cleaning: ${needsCleaning} (original !== cleaned: ${original !== cleaned}, hadIllegal: ${hadIllegal}, hasSpaces: ${/\s/.test(original)})`);
       
       if (needsCleaning) {
         // Check if target already exists
         const existingTarget = await client.query('SELECT part_number FROM inventory WHERE part_number = $1', [cleaned]);
         if (existingTarget.rows.length > 0) {
           fixesSkipped++;
           console.log(`Skipping fix for "${original}" -> "${cleaned}" because target already exists`);
           continue;
         }

         // Apply the fix
         await client.query(
           'UPDATE inventory SET part_number = $1, updated_at = CURRENT_TIMESTAMP WHERE part_number = $2',
           [cleaned, original]
         );
         fixesApplied++;
         console.log(`Auto-fixed: "${original}" -> "${cleaned}"`);
       } else {
         console.log(`No fix needed for: "${original}"`);
       }
     }

    // Step 2: Handle duplicates automatically
    const dupMap: Record<string, any[]> = {};
    
    // Re-query items after fixes to get updated data
    const updatedItemsResult = await client.query(baseQuery, params);
    const updatedItems = updatedItemsResult.rows;

    for (const item of updatedItems) {
      const normKey = normalizePartNumberForDuplicateCheck(item.part_number);
      if (!dupMap[normKey]) dupMap[normKey] = [];
      dupMap[normKey].push(item);
    }

    let mergedGroups = 0;
    let mergedItems = 0;

    for (const [normKey, candidates] of Object.entries(dupMap)) {
      if (candidates.length > 1) {
        // Prefer candidate with dash, else first
        const keep = candidates.find(c => String(c.part_number).includes('-')) || candidates[0];
        const others = candidates.filter(c => c.part_number !== keep.part_number);
        
        // Check for unit mismatches
        const units = new Set(candidates.map(c => c.unit));
        if (units.size > 1) {
          console.log(`Skipping merge for ${normKey} due to unit mismatch: ${Array.from(units).join(', ')}`);
          continue;
        }

        // Merge quantities and take max costs/reorder points
        let totalQty = parseFloat(keep.quantity_on_hand || 0) || 0;
        let maxCost = parseFloat(keep.last_unit_cost || 0) || 0;
        let maxReorder = parseFloat(keep.reorder_point || 0) || 0;

        for (const other of others) {
          totalQty += parseFloat(other.quantity_on_hand || 0) || 0;
          maxCost = Math.max(maxCost, parseFloat(other.last_unit_cost || 0) || 0);
          maxReorder = Math.max(maxReorder, parseFloat(other.reorder_point || 0) || 0);
        }

        // Update keep item
        await client.query(
          `UPDATE inventory SET quantity_on_hand = $1, last_unit_cost = $2, reorder_point = $3, updated_at = CURRENT_TIMESTAMP WHERE part_number = $4`,
          [totalQty, maxCost, maxReorder, keep.part_number]
        );

        // Delete other items
        for (const other of others) {
          await client.query('DELETE FROM inventory WHERE part_number = $1', [other.part_number]);
          mergedItems++;
        }

        mergedGroups++;
        console.log(`Auto-merged ${candidates.length} items into "${keep.part_number}"`);
      }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Auto-cleanup completed successfully',
      summary: {
        totalProcessed: items.length,
        fixesApplied,
        fixesSkipped,
        mergedGroups,
        mergedItems,
        slashViolations: slashViolations.length
      },
      slashViolations: slashViolations.length > 0 ? slashViolations : undefined
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error during auto-cleanup:', error);
    res.status(500).json({ 
      error: 'Internal server error during auto-cleanup',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

// Fix double parentheses endpoint
router.post('/fix-double-parentheses', async (req: Request, res: Response) => {
  const { partType } = req.body || {};
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Load items
    const baseQuery = partType && (partType === 'stock' || partType === 'supply')
      ? 'SELECT * FROM inventory WHERE part_type = $1'
      : 'SELECT * FROM inventory';
    const params = partType && (partType === 'stock' || partType === 'supply') ? [partType] : [];
    const itemsResult = await client.query(baseQuery, params);
    const items = itemsResult.rows;

    console.log(`Starting double parentheses fix for ${items.length} items...`);

    let fixedCount = 0;
    let skippedCount = 0;
    const fixedItems: string[] = [];

    for (const item of items) {
      const original = String(item.part_number || '');
      
      // Check if the part number contains double parentheses patterns
      if (original.includes('((') || original.includes('))')) {
        console.log(`Found double parentheses in: "${original}"`);
        
        // Fix double parentheses by removing the outer set
        let fixed = original;
        
        // Replace (( with ( and )) with )
        fixed = fixed.replace(/\(\(/g, '(');
        fixed = fixed.replace(/\)\)/g, ')');
        
        // Also handle cases like ((1/4)) -> (1/4)
        fixed = fixed.replace(/\(\(([^)]+)\)\)/g, '($1)');
        
        console.log(`Fixed: "${original}" -> "${fixed}"`);
        
        // Check if target already exists
        const existingTarget = await client.query('SELECT part_number FROM inventory WHERE part_number = $1', [fixed]);
        if (existingTarget.rows.length > 0) {
          skippedCount++;
          console.log(`Skipping fix for "${original}" -> "${fixed}" because target already exists`);
          continue;
        }

        // Apply the fix
        await client.query(
          'UPDATE inventory SET part_number = $1, updated_at = CURRENT_TIMESTAMP WHERE part_number = $2',
          [fixed, original]
        );
        fixedCount++;
        fixedItems.push(`${original} -> ${fixed}`);
        console.log(`Fixed double parentheses: "${original}" -> "${fixed}"`);
      } else {
        console.log(`No double parentheses found in: "${original}"`);
      }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Double parentheses fix completed successfully',
      summary: {
        totalProcessed: items.length,
        fixedCount,
        skippedCount
      },
      fixedItems: fixedItems.length > 0 ? fixedItems : undefined
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error during double parentheses fix:', error);
    res.status(500).json({ 
      error: 'Internal server error during double parentheses fix',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

export default router; 
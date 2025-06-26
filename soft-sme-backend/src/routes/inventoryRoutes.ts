import express, { Request, Response } from 'express';
import { pool } from '../db';

const router = express.Router();

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

  try {
    const result = await pool.query(
      'INSERT INTO inventory (part_number, part_description, unit, last_unit_cost, quantity_on_hand, reorder_point, part_type) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [part_number, part_description, unit, last_unit_cost, quantity_on_hand, reorder_point, part_type]
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

export default router; 
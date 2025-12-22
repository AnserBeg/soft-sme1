import express, { Request, Response } from 'express';
import { pool } from '../db';
import { ACCESS_ROLES, requireAccessRoles } from '../middleware/roleAccessMiddleware';

const router = express.Router();
const adminOnly = requireAccessRoles([ACCESS_ROLES.ADMIN]);

// Get all categories
router.get('/', async (req: Request, res: Response) => {
  console.log('categoryRoutes: Received GET request for categories');
  try {
    const result = await pool.query(
      'SELECT category_id, category_name, description, created_at, updated_at FROM part_categories ORDER BY category_name ASC'
    );
    console.log(`categoryRoutes: Successfully fetched ${result.rows.length} categories`);
    res.json(result.rows);
  } catch (err) {
    console.error('categoryRoutes: Error fetching categories:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a single category by ID
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  console.log('categoryRoutes: Received GET request for category ID:', id);
  
  try {
    const result = await pool.query(
      'SELECT category_id, category_name, description, created_at, updated_at FROM part_categories WHERE category_id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      console.log('categoryRoutes: Category not found:', id);
      return res.status(404).json({ error: 'Category not found' });
    }
    
    console.log('categoryRoutes: Successfully fetched category:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('categoryRoutes: Error fetching category:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new category
router.post('/', adminOnly, async (req: Request, res: Response) => {
  console.log('categoryRoutes: Received POST request to create category');
  const { category_name, description } = req.body;

  if (!category_name || typeof category_name !== 'string' || category_name.trim() === '') {
    return res.status(400).json({ error: 'Category name is required and must be a non-empty string' });
  }

  const trimmedCategoryName = category_name.trim();
  const trimmedDescription = description ? description.trim() : null;

  try {
    // Check for duplicate category name
    const existingResult = await pool.query(
      'SELECT category_name FROM part_categories WHERE LOWER(category_name) = LOWER($1)',
      [trimmedCategoryName]
    );
    
    if (existingResult.rows.length > 0) {
      console.log('categoryRoutes: Duplicate category name detected:', trimmedCategoryName);
      return res.status(409).json({ 
        error: 'Category name already exists',
        details: `A category with name "${trimmedCategoryName}" already exists.`
      });
    }

    const result = await pool.query(
      'INSERT INTO part_categories (category_name, description) VALUES ($1, $2) RETURNING category_id, category_name, description, created_at, updated_at',
      [trimmedCategoryName, trimmedDescription]
    );
    
    const newCategory = result.rows[0];
    console.log('categoryRoutes: Successfully created new category:', newCategory);
    res.status(201).json({ message: 'Category created successfully', category: newCategory });
  } catch (err) {
    console.error('categoryRoutes: Error creating category:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a category
router.put('/:id', adminOnly, async (req: Request, res: Response) => {
  const { id } = req.params;
  console.log('categoryRoutes: Received PUT request to update category ID:', id);
  const { category_name, description } = req.body;

  if (!category_name || typeof category_name !== 'string' || category_name.trim() === '') {
    return res.status(400).json({ error: 'Category name is required and must be a non-empty string' });
  }

  const trimmedCategoryName = category_name.trim();
  const trimmedDescription = description ? description.trim() : null;

  try {
    // Check if category exists
    const existingResult = await pool.query(
      'SELECT category_id FROM part_categories WHERE category_id = $1',
      [id]
    );
    
    if (existingResult.rows.length === 0) {
      console.log('categoryRoutes: Category not found for update:', id);
      return res.status(404).json({ error: 'Category not found' });
    }

    // Check for duplicate category name (excluding current category)
    const duplicateResult = await pool.query(
      'SELECT category_name FROM part_categories WHERE LOWER(category_name) = LOWER($1) AND category_id != $2',
      [trimmedCategoryName, id]
    );
    
    if (duplicateResult.rows.length > 0) {
      console.log('categoryRoutes: Duplicate category name detected during update:', trimmedCategoryName);
      return res.status(409).json({ 
        error: 'Category name already exists',
        details: `A category with name "${trimmedCategoryName}" already exists.`
      });
    }

    const result = await pool.query(
      'UPDATE part_categories SET category_name = $1, description = $2, updated_at = CURRENT_TIMESTAMP WHERE category_id = $3 RETURNING category_id, category_name, description, created_at, updated_at',
      [trimmedCategoryName, trimmedDescription, id]
    );
    
    const updatedCategory = result.rows[0];
    console.log('categoryRoutes: Successfully updated category:', updatedCategory);
    res.json({ message: 'Category updated successfully', category: updatedCategory });
  } catch (err) {
    console.error('categoryRoutes: Error updating category:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a category
router.delete('/:id', adminOnly, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reassign = false } = req.query; // New query parameter
  console.log('categoryRoutes: Received DELETE request for category ID:', id, 'reassign:', reassign);

  try {
    // Check if category exists
    const existingResult = await pool.query(
      'SELECT category_name FROM part_categories WHERE category_id = $1',
      [id]
    );
    
    if (existingResult.rows.length === 0) {
      console.log('categoryRoutes: Category not found for deletion:', id);
      return res.status(404).json({ error: 'Category not found' });
    }

    const categoryName = existingResult.rows[0].category_name;

    // Check if it's the default "Uncategorized" category
    if (categoryName.toLowerCase() === 'uncategorized') {
      console.log('categoryRoutes: Cannot delete default Uncategorized category');
      return res.status(400).json({ 
        error: 'Cannot delete default category',
        details: 'The "Uncategorized" category cannot be deleted as it is the default category.'
      });
    }

    // Check if category is in use by any inventory items
    const usageResult = await pool.query(
      'SELECT COUNT(*) as count FROM inventory WHERE category = $1',
      [categoryName]
    );
    
    const itemCount = parseInt(usageResult.rows[0].count);
    if (itemCount > 0) {
      if (reassign === 'true') {
        // Reassign all items to "Uncategorized" and then delete the category
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          
          // Update all inventory items to use "Uncategorized"
          await client.query(
            'UPDATE inventory SET category = $1 WHERE category = $2',
            ['Uncategorized', categoryName]
          );
          
          // Delete the category
          await client.query('DELETE FROM part_categories WHERE category_id = $1', [id]);
          
          await client.query('COMMIT');
          
          console.log('categoryRoutes: Successfully deleted category and reassigned', itemCount, 'items to Uncategorized:', categoryName);
          res.json({ 
            message: 'Category deleted successfully', 
            details: `${itemCount} inventory items were reassigned to "Uncategorized"`
          });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      } else {
        console.log('categoryRoutes: Cannot delete category in use:', categoryName);
        return res.status(400).json({ 
          error: 'Cannot delete category',
          details: `Category "${categoryName}" is currently used by ${itemCount} inventory items.`,
          suggestion: 'Use ?reassign=true to reassign these items to "Uncategorized" and delete the category.',
          itemCount
        });
      }
    } else {
      // No items using this category, safe to delete
      await pool.query('DELETE FROM part_categories WHERE category_id = $1', [id]);
      
      console.log('categoryRoutes: Successfully deleted category:', categoryName);
      res.json({ message: 'Category deleted successfully' });
    }
  } catch (err) {
    console.error('categoryRoutes: Error deleting category:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk purge categories
// DELETE /api/categories/purge?force=true|false
// - force=false (default): deletes all categories not in use by any inventory item and not "Uncategorized"
// - force=true: reassigns all inventory items to "Uncategorized" and deletes all categories except "Uncategorized"
router.delete('/purge', adminOnly, async (req: Request, res: Response) => {
  const force = String(req.query.force || 'false').toLowerCase() === 'true';
  console.log(`categoryRoutes: Received PURGE request. force=${force}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (force) {
      // Reassign every inventory item's category to 'Uncategorized'
      const reassigned = await client.query(
        `UPDATE inventory
         SET category = 'Uncategorized'
         WHERE category IS NOT NULL AND LOWER(category) <> 'uncategorized'`
      );
      console.log(`categoryRoutes: Reassigned ${reassigned.rowCount} inventory rows to 'Uncategorized'`);

      // Delete all categories except 'Uncategorized'
      const deleted = await client.query(
        `DELETE FROM part_categories WHERE LOWER(category_name) <> 'uncategorized'`
      );
      console.log(`categoryRoutes: Purged ${deleted.rowCount} categories (forced)`);

      await client.query('COMMIT');
      return res.json({
        message: 'All categories purged (except Uncategorized). All inventory reassigned to Uncategorized.',
        reassignedInventory: reassigned.rowCount,
        deletedCategories: deleted.rowCount,
        force,
      });
    }

    // Non-force: delete only categories not in use
    const toDelete = await client.query(
      `SELECT c.category_id, c.category_name
       FROM part_categories c
       WHERE LOWER(c.category_name) <> 'uncategorized'
         AND NOT EXISTS (
           SELECT 1 FROM inventory i WHERE i.category = c.category_name
         )`
    );

    let deletedCount = 0;
    if (toDelete.rows.length > 0) {
      const names = toDelete.rows.map(r => r.category_name);
      const placeholders = names.map((_, idx) => `$${idx + 1}`).join(',');
      const delRes = await client.query(
        `DELETE FROM part_categories WHERE category_name IN (${placeholders})`,
        names
      );
      deletedCount = delRes.rowCount || 0;
    }

    await client.query('COMMIT');
    console.log(`categoryRoutes: Purged ${deletedCount} unused categories`);
    return res.json({
      message: 'Unused categories purged (kept those in use and Uncategorized).',
      deletedCategories: deletedCount,
      force,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('categoryRoutes: Error purging categories:', err);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router;

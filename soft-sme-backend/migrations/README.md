# Database Migration Instructions

## Stock vs Supply Classification Implementation

This migration adds a `part_type` column to the `inventory` table to classify items as either 'stock' or 'supply'.

### Migration Files

1. **`add_part_type_to_inventory.sql`** - Simple migration to add the part_type column to existing inventory table
2. **`create_inventory_table_with_part_type.sql`** - Comprehensive migration that creates the inventory table if it doesn't exist

### Running the Migration

#### Option 1: Using pgAdmin (Recommended)

1. Open pgAdmin and connect to your database
2. Open the Query Tool
3. Copy and paste the contents of `create_inventory_table_with_part_type.sql`
4. Execute the query

#### Option 2: Using psql command line

```bash
psql -U your_username -d your_database_name -f create_inventory_table_with_part_type.sql
```

### What the Migration Does

1. **Creates inventory table** (if it doesn't exist) with the following structure:
   - `part_number` (VARCHAR(255), PRIMARY KEY)
   - `part_description` (TEXT, NOT NULL)
   - `unit` (VARCHAR(50))
   - `last_unit_cost` (DECIMAL(10,2), DEFAULT 0)
   - `quantity_on_hand` (INTEGER, DEFAULT 0)
   - `reorder_point` (INTEGER, DEFAULT 0)
   - `part_type` (VARCHAR(10), NOT NULL, DEFAULT 'stock')
   - `created_at` (TIMESTAMP WITH TIME ZONE)
   - `updated_at` (TIMESTAMP WITH TIME ZONE)

2. **Adds part_type column** to existing inventory table (if table exists but column doesn't)

3. **Adds constraints**:
   - Check constraint ensuring `part_type` can only be 'stock' or 'supply'
   - Default value of 'stock' for existing rows

4. **Creates indexes** for better query performance

5. **Sets up triggers** for automatic timestamp updates

### Verification

After running the migration, you can verify it worked by running:

```sql
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'inventory' 
ORDER BY ordinal_position;
```

You should see the `part_type` column with:
- `data_type`: 'character varying'
- `is_nullable`: 'NO'
- `column_default`: 'stock'

### Backward Compatibility

- All existing inventory items will be automatically classified as 'stock'
- The migration is safe to run multiple times (uses `IF NOT EXISTS` and `IF EXISTS` checks)
- No data will be lost during the migration

### Frontend Changes

The frontend has been updated to:
- Show only stock items on the Inventory page
- Show only supply items on the new Supply page
- Include part_type field in add/edit forms
- Default to appropriate part_type based on the page context 
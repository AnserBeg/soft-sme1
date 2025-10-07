# Category Field Implementation Summary

## Overview
This implementation adds a category field to parts throughout the NeuraTask system, allowing users to organize parts into logical categories and manage those categories independently.

## Database Changes

### 1. Migration File
- **File**: `soft-sme-backend/migrations/add_category_to_inventory.sql`
- **Changes**:
  - Adds `category` column (VARCHAR(100), NOT NULL, DEFAULT 'Uncategorized') to inventory table
  - Creates `part_categories` table for managing categories
  - Adds index on category column for better performance
  - Inserts 10 default categories (Uncategorized, Fasteners, Electrical, Plumbing, Tools, Safety, Raw Materials, Consumables, Lubricants, Adhesives)
  - Sets up triggers for automatic timestamp updates

### 2. Migration Script
- **File**: `soft-sme-backend/run-category-migration.js`
- **Purpose**: Executes the migration and verifies the changes

## Backend Changes

### 1. New Category Routes
- **File**: `soft-sme-backend/src/routes/categoryRoutes.ts`
- **Endpoints**:
  - `GET /api/categories` - Get all categories
  - `GET /api/categories/:id` - Get single category
  - `POST /api/categories` - Create new category
  - `PUT /api/categories/:id` - Update category
  - `DELETE /api/categories/:id` - Delete category (with validation)

### 2. Updated Inventory Routes
- **File**: `soft-sme-backend/src/routes/inventoryRoutes.ts`
- **Changes**:
  - Added `category` field to all SELECT queries
  - Updated POST endpoint to handle category field
  - Updated PUT endpoint to handle category updates
  - Updated CSV upload to process category field
  - Updated CSV template to include category column
  - Updated cleanup endpoint to handle category trimming

### 3. App Configuration
- **File**: `soft-sme-backend/src/app.ts`
- **Changes**: Added category routes registration

## Frontend Changes

### 1. Category Service
- **File**: `soft-sme-frontend/src/services/categoryService.ts`
- **Purpose**: Provides API functions for managing categories

### 2. Updated UnifiedPartDialog
- **File**: `soft-sme-frontend/src/components/UnifiedPartDialog.tsx`
- **Changes**:
  - Added `category` field to `PartFormValues` interface
  - Added category dropdown with dynamic loading from API
  - Added category validation
  - Updated form initialization and save logic

### 3. Updated InventoryPage
- **File**: `soft-sme-frontend/src/pages/InventoryPage.tsx`
- **Changes**:
  - Added category column to DataGrid
  - Updated `processRowUpdate` to handle category changes
  - Updated edit dialog to include category field
  - Updated `handleSaveEdit` to include category

### 4. Updated SupplyPage
- **File**: `soft-sme-frontend/src/pages/SupplyPage.tsx`
- **Changes**:
  - Added category column to DataGrid
  - Updated `processRowUpdate` to handle category changes
  - Updated edit dialog to include category field
  - Updated `handleSaveEdit` to include category
  - Updated `handleAddNewPart` to include default category

### 5. Updated Purchase Order Page
- **File**: `soft-sme-frontend/src/pages/OpenPurchaseOrderDetailPage.tsx`
- **Changes**: Updated UnifiedPartDialog initialization to include default category

### 6. Updated Sales Order Page
- **File**: `soft-sme-frontend/src/pages/OpenSalesOrderDetailPage.tsx`
- **Changes**: Updated UnifiedPartDialog initialization to include default category for both line items and parts-to-order

## Default Categories
The system comes with 10 pre-defined categories:
1. **Uncategorized** - Default category for parts without specific classification
2. **Fasteners** - Screws, bolts, nuts, washers, and other fastening hardware
3. **Electrical** - Wires, connectors, switches, and electrical components
4. **Plumbing** - Pipes, fittings, valves, and plumbing components
5. **Tools** - Hand tools, power tools, and tool accessories
6. **Safety** - Safety equipment, PPE, and safety-related items
7. **Raw Materials** - Basic materials like steel, aluminum, wood, etc.
8. **Consumables** - Items that are used up during work like welding rods, cutting discs
9. **Lubricants** - Oils, greases, and other lubricating materials
10. **Adhesives** - Glues, tapes, sealants, and bonding materials

## Features

### 1. Category Management
- Create, read, update, and delete categories
- Validation to prevent duplicate category names
- Protection against deleting categories in use
- Protection against deleting the default "Uncategorized" category

### 2. Part Categorization
- All parts now have a category field
- Default category is "Uncategorized" for existing parts
- Category can be changed when editing parts
- Category is included in CSV imports/exports

### 3. UI Integration
- Category dropdown in part creation/editing dialogs
- Category column in inventory and supply tables
- Category field in inline editing
- Category filtering and display throughout the system

## Migration Instructions

### 1. Run Database Migration
```bash
cd soft-sme-backend
node run-category-migration.js
```

### 2. Restart Backend
```bash
npm start
```

### 3. Restart Frontend
```bash
cd ../soft-sme-frontend
npm start
```

## API Endpoints

### Categories
- `GET /api/categories` - Get all categories
- `GET /api/categories/:id` - Get single category
- `POST /api/categories` - Create new category
- `PUT /api/categories/:id` - Update category
- `DELETE /api/categories/:id` - Delete category

### Updated Inventory Endpoints
- All existing inventory endpoints now include category field
- CSV template updated to include category column
- CSV upload now processes category field

## Validation Rules
- Category name is required and must be unique
- Category name cannot be empty
- Cannot delete categories that are in use by inventory items
- Cannot delete the default "Uncategorized" category
- Category names are case-insensitive for duplicate checking

## Future Enhancements
- Category-based filtering in inventory views
- Category-based reporting
- Category-based pricing or margin rules
- Category-based reorder point management
- Category-based supplier assignments

# Soft-SME Database Schema Guide

## Overview
This document provides a comprehensive guide to the Soft-SME database schema, including all tables, columns, relationships, and usage patterns. This information is used by the AI assistant to generate accurate SQL queries and understand data relationships.

## Core Tables

### INVENTORY Table
**Purpose:** Stores current inventory information for all parts and products.

**Key Columns:**
- `part_number` (PK) - Unique identifier for each part
- `part_description` - Detailed description of the part
- `unit` - Unit of measurement (Each, Box, etc.)
- `last_unit_cost` - Most recent cost per unit
- `quantity_on_hand` - Current stock level
- `reorder_point` - Minimum stock level before reordering
- `part_type` - Classification (stock, supply, etc.)

**Common Queries:**
- Get quantity on hand: `SELECT quantity_on_hand FROM inventory WHERE part_number = '123'`
- Get last unit cost: `SELECT last_unit_cost FROM inventory WHERE part_number = '123'`
- Find low stock items: `SELECT * FROM inventory WHERE quantity_on_hand <= reorder_point`

### PURCHASEHISTORY Table
**Purpose:** Tracks purchase orders and their metadata.

**Key Columns:**
- `purchase_id` (PK) - Unique purchase order identifier
- `purchase_number` - Human-readable purchase order number
- `vendor_id` (FK) - Reference to vendor
- `purchase_date` - Date of purchase
- `total_amount` - Total cost of purchase
- `status` - Order status (Open, Closed, etc.)

**Relationships:**
- Links to VENDORMASTER via `vendor_id`
- Links to PURCHASELINEITEMS via `purchase_id`

### PURCHASELINEITEMS Table
**Purpose:** Individual line items within purchase orders.

**Key Columns:**
- `line_item_id` (PK) - Unique line item identifier
- `purchase_id` (FK) - Reference to purchase order
- `part_number` - Part being purchased
- `part_description` - Description of the part
- `quantity` - Quantity ordered
- `unit_cost` - Cost per unit
- `line_total` - Total cost for this line item

**Common Queries:**
- Get last purchase cost: `SELECT pli.unit_cost FROM purchaselineitems pli JOIN purchasehistory ph ON pli.purchase_id = ph.purchase_id WHERE pli.part_number = '123' ORDER BY ph.purchase_date DESC LIMIT 1`
- Get purchase history: `SELECT ph.purchase_date, pli.unit_cost, pli.quantity FROM purchaselineitems pli JOIN purchasehistory ph ON pli.purchase_id = ph.purchase_id WHERE pli.part_number = '123' ORDER BY ph.purchase_date DESC`

### SALESORDERHISTORY Table
**Purpose:** Tracks sales orders and their metadata.

**Key Columns:**
- `sales_order_id` (PK) - Unique sales order identifier
- `sales_order_number` - Human-readable sales order number
- `customer_id` (FK) - Reference to customer
- `sales_date` - Date of sale
- `total_amount` - Total sale amount
- `status` - Order status (Open, Closed, etc.)
- `estimated_cost` - Estimated cost of goods sold

**Relationships:**
- Links to CUSTOMERMASTER via `customer_id`
- Links to SALESORDERLINEITEMS via `sales_order_id`

### SALESORDERLINEITEMS Table
**Purpose:** Individual line items within sales orders.

**Key Columns:**
- `sales_order_line_item_id` (PK) - Unique line item identifier
- `sales_order_id` (FK) - Reference to sales order
- `part_number` - Part being sold
- `quantity_sold` - Quantity sold
- `unit_price` - Price per unit
- `line_amount` - Total amount for this line item

**Common Queries:**
- Get sales history: `SELECT soh.sales_date, soli.unit_price, soli.quantity_sold FROM salesorderlineitems soli JOIN salesorderhistory soh ON soli.sales_order_id = soh.sales_order_id WHERE soli.part_number = '123' ORDER BY soh.sales_date DESC`

### CUSTOMERMASTER Table
**Purpose:** Stores customer information.

**Key Columns:**
- `customer_id` (PK) - Unique customer identifier
- `customer_name` - Customer company name
- `contact_person` - Primary contact person
- `telephone_number` - Contact phone number
- `email` - Contact email address
- `street_address`, `city`, `province`, `country` - Address information

### VENDORMASTER Table
**Purpose:** Stores vendor/supplier information.

**Key Columns:**
- `vendor_id` (PK) - Unique vendor identifier
- `vendor_name` - Vendor company name
- `contact_person` - Primary contact person
- `telephone_number` - Contact phone number
- `email` - Contact email address
- `street_address`, `city`, `province`, `country` - Address information

### TIME_ENTRIES Table
**Purpose:** Tracks time spent on sales orders.

**Key Columns:**
- `id` (PK) - Unique time entry identifier
- `profile_id` (FK) - Reference to employee profile
- `sales_order_id` (FK) - Reference to sales order
- `clock_in` - Start time
- `clock_out` - End time
- `duration` - Time spent in hours
- `unit_price` - Hourly rate

### GLOBAL_SETTINGS Table
**Purpose:** Stores global system configuration values.

**Key Columns:**
- `key` (PK) - Setting name/identifier
- `value` - Setting value

**Important Note:** This table uses `key` and `value` columns, NOT `setting_name` and `setting_value`.

**Common Queries:**
- Get labour rate: `SELECT value FROM global_settings WHERE key = 'labour_rate'`
- Get overhead rate: `SELECT value FROM global_settings WHERE key = 'overhead_rate'`
- Get all settings: `SELECT key, value FROM global_settings`

### QUOTES Table
**Purpose:** Stores quote information.

**Key Columns:**
- `quote_id` (PK) - Unique quote identifier
- `quote_number` - Human-readable quote number
- `customer_id` (FK) - Reference to customer
- `quote_date` - Date of quote
- `total_amount` - Total quote amount
- `status` - Quote status
- `terms` - Quote terms and conditions

### BUSINESS_PROFILE Table
**Purpose:** Stores business profile information.

**Key Columns:**
- `id` (PK) - Unique identifier
- `business_name` - Company name
- `address` - Business address
- `phone` - Contact phone
- `email` - Contact email
- `website` - Company website

## Query Patterns

### Cost Queries
- **Last unit cost from inventory:** `SELECT last_unit_cost FROM inventory WHERE part_number = '123'`
- **Last purchase cost:** `SELECT pli.unit_cost FROM purchaselineitems pli JOIN purchasehistory ph ON pli.purchase_id = ph.purchase_id WHERE pli.part_number = '123' ORDER BY ph.purchase_date DESC LIMIT 1`
- **Average purchase cost:** `SELECT AVG(pli.unit_cost) FROM purchaselineitems pli WHERE pli.part_number = '123'`

### Quantity Queries
- **Current stock:** `SELECT quantity_on_hand FROM inventory WHERE part_number = '123'`
- **Low stock items:** `SELECT * FROM inventory WHERE quantity_on_hand <= reorder_point`
- **Parts with no stock:** `SELECT * FROM inventory WHERE quantity_on_hand = 0 OR quantity_on_hand IS NULL`

### History Queries
- **Purchase history:** `SELECT ph.purchase_date, pli.unit_cost, pli.quantity FROM purchaselineitems pli JOIN purchasehistory ph ON pli.purchase_id = ph.purchase_id WHERE pli.part_number = '123' ORDER BY ph.purchase_date DESC`
- **Sales history:** `SELECT soh.sales_date, soli.unit_price, soli.quantity_sold FROM salesorderlineitems soli JOIN salesorderhistory soh ON soli.sales_order_id = soh.sales_order_id WHERE soli.part_number = '123' ORDER BY soh.sales_date DESC`

### Customer/Vendor Queries
- **Customer details:** `SELECT * FROM customermaster WHERE customer_id = 123`
- **Vendor details:** `SELECT * FROM vendormaster WHERE vendor_id = 123`
- **Recent orders by customer:** `SELECT * FROM salesorderhistory WHERE customer_id = 123 ORDER BY sales_date DESC`

### Settings Queries
- **Get labour rate:** `SELECT value FROM global_settings WHERE key = 'labour_rate'`
- **Get overhead rate:** `SELECT value FROM global_settings WHERE key = 'overhead_rate'`
- **Get all settings:** `SELECT key, value FROM global_settings`

## Best Practices

### SQL Query Guidelines
1. **Always use SELECT statements** - No data modification allowed
2. **Use proper JOINs** - Connect related tables appropriately
3. **Order by date DESC** - For "last" or "recent" queries
4. **Use LIMIT 1** - For single result queries
5. **Include relevant columns** - Don't use SELECT * unless needed
6. **Use proper WHERE clauses** - Filter data appropriately

### Common Patterns
- **"Last" queries:** Use ORDER BY date DESC LIMIT 1
- **"Recent" queries:** Use ORDER BY date DESC LIMIT 10
- **"Current" queries:** Check status = 'Open' or similar
- **"History" queries:** Order by date DESC without LIMIT

### Error Handling
- Check for NULL values in date fields
- Handle empty result sets gracefully
- Use appropriate data types (numeric for costs, varchar for part numbers)
- Consider time zones for date/time fields

## Data Relationships

### Primary Relationships
- PURCHASEHISTORY → VENDORMASTER (via vendor_id)
- PURCHASELINEITEMS → PURCHASEHISTORY (via purchase_id)
- SALESORDERHISTORY → CUSTOMERMASTER (via customer_id)
- SALESORDERLINEITEMS → SALESORDERHISTORY (via sales_order_id)
- TIME_ENTRIES → SALESORDERHISTORY (via sales_order_id)

### Data Flow
1. **Purchases:** VENDORMASTER → PURCHASEHISTORY → PURCHASELINEITEMS → INVENTORY (updates quantity_on_hand and last_unit_cost)
2. **Sales:** CUSTOMERMASTER → SALESORDERHISTORY → SALESORDERLINEITEMS → INVENTORY (reduces quantity_on_hand)
3. **Time Tracking:** TIME_ENTRIES → SALESORDERHISTORY (tracks work on orders)

## Query Examples by Use Case

### Inventory Management
```sql
-- Get current stock levels
SELECT part_number, part_description, quantity_on_hand, reorder_point 
FROM inventory 
WHERE quantity_on_hand <= reorder_point;

-- Get parts with no stock
SELECT part_number, part_description 
FROM inventory 
WHERE quantity_on_hand = 0 OR quantity_on_hand IS NULL;
```

### Cost Analysis
```sql
-- Get last purchase cost for a part
SELECT pli.unit_cost, ph.purchase_date 
FROM purchaselineitems pli 
JOIN purchasehistory ph ON pli.purchase_id = ph.purchase_id 
WHERE pli.part_number = '123' 
ORDER BY ph.purchase_date DESC 
LIMIT 1;

-- Compare inventory cost vs last purchase cost
SELECT i.part_number, i.last_unit_cost, pli.unit_cost as last_purchase_cost
FROM inventory i
LEFT JOIN (
    SELECT DISTINCT ON (part_number) part_number, unit_cost
    FROM purchaselineitems
    ORDER BY part_number, line_item_id DESC
) pli ON i.part_number = pli.part_number;
```

### Sales Analysis
```sql
-- Get recent sales for a part
SELECT soh.sales_date, soli.unit_price, soli.quantity_sold
FROM salesorderlineitems soli
JOIN salesorderhistory soh ON soli.sales_order_id = soh.sales_order_id
WHERE soli.part_number = '123'
ORDER BY soh.sales_date DESC
LIMIT 10;
```

### Settings and Configuration
```sql
-- Get labour rate
SELECT value FROM global_settings WHERE key = 'labour_rate';

-- Get overhead rate
SELECT value FROM global_settings WHERE key = 'overhead_rate';

-- Get all global settings
SELECT key, value FROM global_settings;
```

This schema guide provides the foundation for the AI assistant to understand the database structure and generate accurate, helpful SQL queries for user questions. 
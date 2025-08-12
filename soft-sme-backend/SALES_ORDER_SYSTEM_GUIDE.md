# SOFT SME Sales Order System - Complete Guide

## Table of Contents
1. [Overview](#overview)
2. [Customer Management](#customer-management)
3. [Sales Order Creation](#sales-order-creation)
4. [Parts to Order System](#parts-to-order-system)
5. [Sales Order Management](#sales-order-management)
6. [Business Logic and Validation](#business-logic-and-validation)
7. [Field Editing and Validation](#field-editing-and-validation)
8. [Buttons and Actions](#buttons-and-actions)
9. [Database Structure](#database-structure)
10. [Calculations and Formulas](#calculations-and-formulas)
11. [Troubleshooting Common Issues](#troubleshooting-common-issues)
12. [Integration Features](#integration-features)

## Overview

The SOFT SME Sales Order system is a comprehensive solution for creating, managing, and tracking customer sales orders. The system includes customer management, inventory integration, parts to order functionality, and integration with QuickBooks Online. The system enforces strict business rules to ensure data integrity and proper workflow management.

## Customer Management

### Creating Customers

Customers are created through the **UnifiedCustomerDialog** component with the following fields:

**Required Fields:**
- **Customer Name** (required) - The name of the customer/client

**Optional Fields:**
- **Contact Person** - Primary contact at the customer
- **Email** - Customer's email address
- **Phone Number** - Customer's phone number
- **Street Address** - Customer's street address
- **City** - Customer's city
- **Province** - Customer's province/state
- **Country** - Customer's country
- **Postal Code** - Customer's postal/zip code
- **Website** - Customer's website URL

### Customer Creation Process

1. **Auto-fill Feature**: When creating a new customer, the system automatically fills City, Province, and Country from the business profile
2. **Validation**: Only customer name is required; all other fields are optional
3. **Database Storage**: Customers are stored in the `customermaster` table with auto-generated `customer_id`

### Customer Selection in Sales Orders

- **Search Functionality**: Users can search customers by name using autocomplete
- **Create New**: If a customer doesn't exist, users can create a new customer inline by typing the name and pressing Enter
- **Edit Existing**: Existing customers can be edited through the same dialog
- **Auto-complete**: System suggests existing customers as you type

## Sales Order Creation

### Creating a New Sales Order

1. **Navigation**: Go to Sales Orders → New Sales Order
2. **Basic Information**:
   - **Customer**: Select existing customer or create new one
   - **Sales Date**: Date the sales order is created (defaults to current date)
   - **Product**: Select existing product or create new one
   - **Product Description**: Detailed description of the product/service
   - **Terms**: Terms and conditions for the sale
   - **Status**: Defaults to "Open"

### Sales Order Number Generation

**Format**: `SO-YYYY-NNNNN`
- **SO**: Sales Order prefix
- **YYYY**: Current year
- **NNNNN**: 5-digit sequence number (padded with zeros)

**Example**: `SO-2024-00001`

### Sales Order Form Layout

**Top Section:**
- Customer (required)
- Sales Date (required)
- Product (required)

**Middle Section:**
- Product Description (multiline text area)
- Terms and Conditions (multiline text area)

**Line Items Section:**
- Part Number (required)
- Part Description (auto-filled, editable)
- Quantity (required)
- Unit (dropdown: Each, cm, ft, kg, pcs, hr, L)
- Unit Price (required)
- Line Amount (auto-calculated)

**Parts to Order Section:**
- Part Number (required)
- Part Description (auto-filled, editable)
- Quantity to Order (required)
- Unit (dropdown)
- Unit Price (auto-filled from inventory)
- Line Amount (auto-calculated)

## Parts to Order System

### What is Parts to Order?

The "Parts to Order" system is a separate section in sales orders that tracks parts that need to be ordered from suppliers to fulfill the sales order. This is different from the main line items which represent what the customer is actually purchasing.

### Business Logic

**Purpose:**
- Track parts needed for internal use to fulfill the sales order
- Separate customer-facing items from internal procurement needs
- Ensure all required parts are ordered before closing the sales order

**Key Rules:**
1. **Cannot Close Sales Order**: If there are quantities to order > 0, the sales order cannot be closed
2. **Cannot Export to QBO**: If there are quantities to order > 0, the sales order cannot be exported to QuickBooks
3. **Inventory Validation**: All parts to order must exist in inventory
4. **No Duplicates**: Each part can only appear once in the parts to order section

### Parts to Order Workflow

1. **Add Parts**: Add parts that need to be ordered to fulfill the sales order
2. **Set Quantities**: Specify how many of each part need to be ordered
3. **Order from Suppliers**: Use the parts to order list to create purchase orders
4. **Receive Parts**: When parts arrive, update inventory quantities
5. **Close Sales Order**: Only after all parts are ordered and received

### Parts to Order vs Line Items

**Line Items (Customer-Facing):**
- What the customer is actually purchasing
- Appears on customer invoice
- Contributes to sales order totals
- Can include LABOUR and OVERHEAD items

**Parts to Order (Internal):**
- Parts needed internally to fulfill the order
- Not visible to customer
- Does not affect sales order totals
- Used for internal procurement tracking

## Sales Order Management

### Sales Order List View

**Columns Displayed:**
- **Sales Order #**: Auto-generated sequence number (SO-YYYY-NNNNN)
- **Customer**: Selected customer name
- **Product**: Selected product name
- **Subtotal**: Sum of line item amounts
- **GST Amount**: Calculated GST
- **Total Amount**: Final total
- **Status**: Open or Closed
- **Actions**: Edit, Delete, Export to QBO

**Filtering Options:**
- **Status Filter**: All, Open, Closed
- **Search**: Search by sales order number, customer name, or product name
- **Sorting**: Default sort by sales order number (descending)

### Sales Order Actions

**Available Actions:**
- **Edit**: Modify sales order details
- **Delete**: Remove sales order (confirmation required)
- **Close**: Mark sales order as closed
- **Reopen**: Reopen a closed sales order
- **Download PDF**: Generate PDF of sales order
- **Export to QBO**: Send to QuickBooks Online

## Business Logic and Validation

### Critical Business Rules

**1. Parts to Order Validation:**
- **Cannot Close**: Sales order cannot be closed if there are quantities to order > 0
- **Cannot Export**: Sales order cannot be exported to QBO if there are quantities to order > 0
- **Must Exist in Inventory**: All parts to order must exist in inventory

**2. Line Item Validation:**
- **No Blank Part Numbers**: Line items with blank part numbers are not allowed
- **No Duplicates**: Each part can only appear once (excluding LABOUR and OVERHEAD)
- **No Zero Quantities**: Line items with 0 quantity are not allowed (excluding LABOUR and OVERHEAD)
- **Valid Parts Only**: Parts must exist in inventory and cannot be supply parts

**3. Inventory Integration:**
- **Stock Parts Only**: Only stock parts can be used in line items (not supply parts)
- **Quantity Validation**: Quantities must be greater than 0
- **Auto-Pricing**: Unit prices are auto-filled from inventory when available

### Validation Error Messages

**Common Validation Errors:**

1. **"Cannot close sales order: The following parts still need to be ordered"**
   - **Cause**: Parts to order section has quantities > 0
   - **Solution**: Remove parts from "Parts to Order" section or set quantities to 0

2. **"Line items with blank part numbers are not allowed"**
   - **Cause**: Empty part number fields in line items
   - **Solution**: Fill in part numbers or remove empty line items

3. **"Duplicate part numbers found"**
   - **Cause**: Same part number used multiple times in line items
   - **Solution**: Remove duplicate entries or use different parts

4. **"Line items with 0 quantity are not allowed"**
   - **Cause**: Zero quantities in line items
   - **Solution**: Set quantities > 0 or remove the line item

5. **"Invalid part numbers: [part] (not found in inventory)"**
   - **Cause**: Part doesn't exist in inventory
   - **Solution**: Add part to inventory first or use existing part

6. **"Invalid part numbers: [part] (supply part not allowed)"**
   - **Cause**: Trying to use supply parts in line items
   - **Solution**: Use stock parts only, supply parts are for internal use

### Status Management

**Open Status:**
- **Default Status**: All new sales orders start as "Open"
- **Editable**: Can be modified and saved
- **Exportable**: Can be exported to QuickBooks Online
- **Closable**: Can be closed if validation passes

**Closed Status:**
- **Final Status**: Sales order is completed
- **Read-only**: Cannot be modified (except reopening)
- **Historical**: Used for record keeping
- **Reopenable**: Can be reopened if needed

## Field Editing and Validation

### Editable Fields

**Sales Order Level:**
- **Customer**: Can be changed before saving
- **Sales Date**: Editable date picker
- **Product**: Auto-complete with create new option
- **Product Description**: Multiline text area
- **Terms and Conditions**: Multiline text area

**Line Item Level:**
- **Part Number**: Auto-complete with inventory validation
- **Part Description**: Auto-filled from inventory, can be edited
- **Quantity**: Numeric input with validation
- **Unit**: Dropdown selection
- **Unit Price**: Numeric input with validation

**Parts to Order Level:**
- **Part Number**: Auto-complete with inventory validation
- **Part Description**: Auto-filled from inventory, can be edited
- **Quantity to Order**: Numeric input with validation
- **Unit**: Dropdown selection
- **Unit Price**: Auto-filled from inventory

### Validation Rules

**Required Fields:**
- Customer must be selected
- Sales date must be provided
- Product must be selected
- Line items must have valid part numbers and quantities > 0

**Business Rules:**
- Sales order number is auto-generated and unique
- Parts to order must exist in inventory
- Line items cannot use supply parts
- No duplicate part numbers in line items
- No duplicate part numbers in parts to order

### Error Handling

**Validation Errors:**
- Red border around invalid fields
- Error messages displayed below fields
- Toast notifications for validation errors
- Form cannot be saved until all errors are resolved

**System Errors:**
- Toast notifications for API errors
- Loading states during operations
- Confirmation dialogs for destructive actions

## Buttons and Actions

### Primary Action Buttons

**Save Button (Purple with Save Icon):**
- **Color**: Primary purple (`color="primary"`) - #7c3aed
- **Icon**: SaveIcon from Material-UI
- **Action**: Saves sales order without closing
- **Behavior**: Validates form, shows loading state, displays success/error toast

**Close SO Button (Purple with Check Icon):**
- **Color**: Primary purple (`color="primary"`) - #7c3aed
- **Icon**: Check icon
- **Action**: Closes sales order (changes status to "Closed")
- **Behavior**: Validation check, confirmation dialog, updates status

**Reopen SO Button (Purple with Refresh Icon):**
- **Color**: Primary purple (`color="primary"`) - #7c3aed
- **Icon**: Refresh icon
- **Action**: Reopens closed sales order
- **Behavior**: Changes status back to "Open", navigates to edit view

**Download PDF Button (Purple with Download Icon):**
- **Color**: Primary purple (`color="primary"`) - #7c3aed
- **Icon**: DownloadIcon from Material-UI
- **Action**: Saves sales order and generates PDF
- **Behavior**: Saves first, then downloads PDF automatically

**Export to QBO Button (Purple with Cloud Upload Icon):**
- **Color**: Primary purple (`color="primary"`) - #7c3aed
- **Icon**: CloudUploadIcon from Material-UI
- **Action**: Exports sales order to QuickBooks Online
- **Behavior**: Validation check, shows loading state, exports to QBO

### Navigation Buttons

**Back Button (Gray with Arrow Icon):**
- **Color**: Default gray
- **Icon**: ArrowBackIcon from Material-UI
- **Action**: Navigates back to sales order list
- **Behavior**: Confirms unsaved changes before leaving

**Delete Button (Red with Trash Icon):**
- **Color**: Error red (`color="error"`)
- **Icon**: DeleteIcon from Material-UI
- **Action**: Deletes sales order
- **Behavior**: Confirmation dialog, removes from database

### Line Item Buttons

**Add Line Item Button (Outlined Purple):**
- **Color**: Outlined primary purple (`variant="outlined" color="primary"`) - #7c3aed
- **Icon**: Plus icon
- **Action**: Adds new empty line item
- **Behavior**: Adds to end of line items list

**Remove Line Item Button (Trash):**
- **Color**: Error red
- **Icon**: DeleteIcon
- **Action**: Removes specific line item
- **Behavior**: Confirmation dialog, removes from list

### Parts to Order Buttons

**Add Parts to Order Button (Outlined Purple):**
- **Color**: Outlined primary purple (`variant="outlined" color="primary"`) - #7c3aed
- **Icon**: Plus icon
- **Action**: Adds new parts to order item
- **Behavior**: Adds to end of parts to order list

**Remove Parts to Order Button (Trash):**
- **Color**: Error red
- **Icon**: DeleteIcon
- **Action**: Removes specific parts to order item
- **Behavior**: Confirmation dialog, removes from list

### Sales Order List Actions

**New SO Button (Contained Purple):**
- **Color**: Contained primary purple (`variant="contained"`) - #7c3aed
- **Icon**: AddIcon
- **Action**: Creates new sales order
- **Behavior**: Navigates to new sales order form

**Export CSV Button (Outlined Purple):**
- **Color**: Outlined primary purple (`variant="outlined"`) - #7c3aed
- **Icon**: DownloadIcon
- **Action**: Exports sales order list to CSV
- **Behavior**: Downloads CSV file

**Download PDF Button (Outlined Purple):**
- **Color**: Outlined primary purple (`variant="outlined"`) - #7c3aed
- **Icon**: DownloadIcon
- **Action**: Downloads PDF of sales order list
- **Behavior**: Generates and downloads PDF

### Customer/Product Creation Buttons

**Add Customer Button (Purple with Add Icon):**
- **Color**: Primary purple (`color="primary"`) - #7c3aed
- **Icon**: AddIcon
- **Action**: Opens customer creation dialog
- **Behavior**: Validates customer data, saves to database

**Add Product Button (Purple with Add Icon):**
- **Color**: Primary purple (`color="primary"`) - #7c3aed
- **Icon**: AddIcon
- **Action**: Opens product creation dialog
- **Behavior**: Validates product data, saves to database

### Dialog Buttons

**Save Customer Button (Contained Purple):**
- **Color**: Contained primary purple (`variant="contained"`) - #7c3aed
- **Text**: "Add Customer" or "Save Changes"
- **Action**: Saves customer to database
- **Behavior**: Validates form, saves customer, closes dialog

**Save Product Button (Contained Purple):**
- **Color**: Contained primary purple (`variant="contained"`) - #7c3aed
- **Text**: "Add Product" or "Save Changes"
- **Action**: Saves product to database
- **Behavior**: Validates form, saves product, closes dialog

**Cancel Button (Default Gray):**
- **Color**: Default gray
- **Text**: "Cancel"
- **Action**: Closes dialog without saving
- **Behavior**: Discards any changes made

### Status Indicators

**Status Chips:**
- **Open Status**: Success green (`color="success"`)
- **Closed Status**: Error red (`color="error"`)

**QBO Export Status Icons:**
- **Exported Successfully**: CheckCircleIcon in success green
- **Export Error**: ErrorIcon in error red
- **Not Exported**: HourglassEmptyIcon in warning orange

## Database Structure

### Sales Order Tables

**salesorderhistory Table:**
```sql
- sales_order_id (SERIAL PRIMARY KEY)
- sales_order_number (VARCHAR(255) UNIQUE NOT NULL)
- customer_id (INTEGER REFERENCES customermaster)
- sales_date (DATE)
- product_name (VARCHAR(255))
- product_description (TEXT)
- subtotal (DECIMAL(10,2))
- total_gst_amount (DECIMAL(10,2))
- total_amount (DECIMAL(10,2))
- status (VARCHAR(50) DEFAULT 'Open')
- estimated_cost (DECIMAL(10,2))
- default_hourly_rate (DECIMAL(10,2) DEFAULT 0.00)
- created_at (TIMESTAMP WITH TIME ZONE)
- updated_at (TIMESTAMP WITH TIME ZONE)
```

**salesorderlineitems Table:**
```sql
- sales_order_line_item_id (SERIAL PRIMARY KEY)
- sales_order_id (INTEGER REFERENCES salesorderhistory)
- part_number (VARCHAR(255) NOT NULL)
- part_description (TEXT)
- quantity_sold (DECIMAL(10,2) NOT NULL)
- unit (VARCHAR(50))
- unit_price (DECIMAL(10,2))
- line_amount (DECIMAL(10,2))
- created_at (TIMESTAMP WITH TIME ZONE)
- updated_at (TIMESTAMP WITH TIME ZONE)
```

**sales_order_parts_to_order Table:**
```sql
- id (SERIAL PRIMARY KEY)
- sales_order_id (INTEGER REFERENCES salesorderhistory)
- part_number (VARCHAR(255) NOT NULL)
- part_description (TEXT)
- quantity_needed (DECIMAL(10,2) NOT NULL DEFAULT 0)
- unit (VARCHAR(50))
- unit_price (DECIMAL(10,2) DEFAULT 0)
- line_amount (DECIMAL(10,2) DEFAULT 0)
- created_at (TIMESTAMP WITH TIME ZONE)
- updated_at (TIMESTAMP WITH TIME ZONE)
```

**customermaster Table:**
```sql
- customer_id (SERIAL PRIMARY KEY)
- customer_name (VARCHAR(255))
- contact_person (VARCHAR(255))
- email (VARCHAR(255))
- phone_number (VARCHAR(50))
- street_address (VARCHAR(255))
- city (VARCHAR(100))
- province (VARCHAR(100))
- country (VARCHAR(100))
- postal_code (VARCHAR(20))
- website (VARCHAR(255))
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

**products Table:**
```sql
- product_id (SERIAL PRIMARY KEY)
- product_name (VARCHAR(255))
- product_description (TEXT)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

### Database Relationships

**Sales Order to Customer:**
- `salesorderhistory.customer_id` → `customermaster.customer_id`
- Foreign key relationship
- One customer can have many sales orders

**Sales Order to Line Items:**
- `salesorderlineitems.sales_order_id` → `salesorderhistory.sales_order_id`
- Foreign key relationship
- One sales order can have many line items

**Sales Order to Parts to Order:**
- `sales_order_parts_to_order.sales_order_id` → `salesorderhistory.sales_order_id`
- Foreign key relationship
- One sales order can have many parts to order

## Calculations and Formulas

### Line Amount Calculation

**Line Amount:**
```javascript
const calculateLineAmount = (quantity, unit_price) => {
  const q = parseFloat(String(quantity)) || 0;
  const up = parseFloat(String(unit_price)) || 0;
  return q * up;
};
```

### Sales Order Totals

**Subtotal:**
```javascript
const subtotal = lineItems.reduce((sum, item) => {
  const lineAmount = calculateLineAmount(item.quantity, item.unit_price);
  return sum + lineAmount;
}, 0);
```

**GST Amount:**
```javascript
const total_gst_amount = subtotal * (gstRate / 100);
```

**Total Amount:**
```javascript
const total_amount = subtotal + total_gst_amount;
```

### Rounding

All monetary calculations are rounded to 2 decimal places:
```javascript
return Math.round(amount * 100) / 100;
```

### Validation Formulas

**Quantity Validation:**
```javascript
const quantity = parseFloat(String(lineItem.quantity));
if (isNaN(quantity) || quantity <= 0) {
  errors.quantity = 'Quantity must be greater than 0';
}
```

**Unit Price Validation:**
```javascript
const unitPrice = parseFloat(String(lineItem.unit_price));
if (isNaN(unitPrice) || unitPrice < 0) {
  errors.unit_price = 'Unit price must be 0 or greater';
}
```

## Troubleshooting Common Issues

### Issue: Cannot Save Sales Order

**Possible Causes:**
1. **Blank Part Numbers**: Line items with empty part numbers
2. **Duplicate Part Numbers**: Same part used multiple times
3. **Zero Quantities**: Line items with 0 quantity
4. **Invalid Parts**: Parts not in inventory or supply parts
5. **Missing Required Fields**: Customer, sales date, or product not selected

**Solutions:**
1. Fill in all part numbers or remove empty line items
2. Remove duplicate part entries
3. Set quantities > 0 or remove zero quantity items
4. Add parts to inventory or use existing stock parts
5. Complete all required fields

### Issue: Cannot Close Sales Order

**Possible Causes:**
1. **Parts to Order**: Quantities to order > 0
2. **Validation Errors**: Line item validation failures
3. **System Errors**: Database or API errors

**Solutions:**
1. Remove parts from "Parts to Order" section or set quantities to 0
2. Fix all validation errors before closing
3. Check system logs and try again

### Issue: Cannot Export to QBO

**Possible Causes:**
1. **Parts to Order**: Quantities to order > 0
2. **QBO Connection**: QuickBooks not connected or configured
3. **Customer Issues**: Customer not created in QBO
4. **System Errors**: API or network errors

**Solutions:**
1. Remove parts from "Parts to Order" section
2. Check QBO connection and settings
3. Create customer in QBO first
4. Check system logs and try again

### Issue: Line Items Not Saving

**Possible Causes:**
1. **Validation Errors**: Part numbers, quantities, or prices invalid
2. **Database Errors**: Foreign key constraints or data type issues
3. **Network Issues**: API connection problems

**Solutions:**
1. Fix all validation errors
2. Check database constraints and data types
3. Check network connection and try again

### Issue: Parts to Order Not Working

**Possible Causes:**
1. **Parts Not in Inventory**: Parts don't exist in inventory
2. **Supply Parts**: Trying to use supply parts
3. **Validation Errors**: Quantities or part numbers invalid

**Solutions:**
1. Add parts to inventory first
2. Use stock parts only (not supply parts)
3. Fix validation errors

### Issue: Calculations Incorrect

**Possible Causes:**
1. **Data Type Issues**: Numbers stored as strings
2. **Rounding Errors**: Floating point precision issues
3. **Formula Errors**: Incorrect calculation logic

**Solutions:**
1. Ensure proper data type conversion
2. Use proper rounding functions
3. Check calculation formulas

## Integration Features

### QuickBooks Online Integration

**Export to QBO:**
- Sales orders can be exported to QuickBooks Online
- Maintains customer and line item information
- Syncs with QBO customers and items
- Prevents export if parts to order exist

**Export Status:**
- **Pending**: Not yet exported
- **Success**: Successfully exported to QBO
- **Error**: Export failed with error details

### Customer Management Integration

**Customer Data:**
- Shared customer database with quotes and other modules
- Consistent customer information across the system
- Contact history tracking
- Communication management

### Product Management Integration

**Product Data:**
- Shared product database with quotes
- Consistent product information
- Product descriptions and pricing history

### Inventory Integration

**Inventory Validation:**
- All parts must exist in inventory
- Stock parts only for line items
- Supply parts for internal use only
- Auto-pricing from inventory

### PDF Generation

**Sales Order PDF:**
- Includes business logo and contact information
- Lists all line items with quantities and prices
- Shows totals and GST calculations
- Professional formatting for customer communication

This comprehensive guide covers all aspects of the SOFT SME Sales Order system, from basic creation to advanced troubleshooting. The system is designed to enforce strict business rules while providing powerful sales order management capabilities for small to medium-sized businesses. 
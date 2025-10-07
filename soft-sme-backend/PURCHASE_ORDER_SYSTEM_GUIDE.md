# NEURATASK Purchase Order System - Complete Guide

## Table of Contents
1. [Overview](#overview)
2. [Vendor Management](#vendor-management)
3. [Inventory Management](#inventory-management)
4. [Purchase Order Creation](#purchase-order-creation)
5. [Purchase Order Management](#purchase-order-management)
6. [Allocation System](#allocation-system)
7. [Part Types: Stock vs Supply](#part-types-stock-vs-supply)
8. [Field Editing and Validation](#field-editing-and-validation)
9. [Buttons and Actions](#buttons-and-actions)
10. [Database Structure](#database-structure)
11. [Calculations and Formulas](#calculations-and-formulas)

## Overview

The NEURATASK Purchase Order system is a comprehensive inventory management solution that allows businesses to create, manage, and track purchase orders with vendors. The system includes vendor management, inventory tracking, allocation to sales orders, and integration with QuickBooks Online.

## Vendor Management

### Creating Vendors

Vendors are created through the **UnifiedVendorDialog** component with the following fields:

**Required Fields:**
- **Vendor Name** (required) - The name of the vendor/supplier

**Optional Fields:**
- **Contact Person** - Primary contact at the vendor
- **Email** - Vendor's email address
- **Telephone Number** - Vendor's phone number
- **Street Address** - Vendor's street address
- **City** - Vendor's city
- **Province** - Vendor's province/state
- **Country** - Vendor's country
- **Postal Code** - Vendor's postal/zip code
- **Website** - Vendor's website URL

### Vendor Creation Process

1. **Auto-fill Feature**: When creating a new vendor, the system automatically fills City, Province, and Country from the business profile
2. **Validation**: Only vendor name is required; all other fields are optional
3. **Database Storage**: Vendors are stored in the `vendormaster` table with auto-generated `vendor_id`

### Vendor Selection in Purchase Orders

- **Search Functionality**: Users can search vendors by name using autocomplete
- **Create New**: If a vendor doesn't exist, users can create a new vendor inline
- **Edit Existing**: Existing vendors can be edited through the same dialog

## Inventory Management

### Part Types: Stock vs Supply

The system differentiates between two types of inventory items:

#### **Stock Items**
- **Purpose**: Items that are tracked by quantity and can be allocated to specific sales orders
- **Quantity Tracking**: Has a specific `quantity_on_hand` value (numeric)
- **Allocation**: Can be allocated to sales orders through the allocation system
- **Examples**: Specific parts, components, finished goods
- **Use Case**: When you need to know exactly how many of a specific item you have

#### **Supply Items**
- **Purpose**: Consumable items that are used up and not tracked by specific quantity
- **Quantity Tracking**: Quantity is set to "NA" (Not Applicable)
- **Allocation**: Cannot be allocated to specific sales orders
- **Examples**: Office supplies, cleaning materials, general consumables
- **Use Case**: When you don't need to track specific quantities for allocation

### Creating Parts

Parts are created through the **UnifiedPartDialog** component:

**Required Fields:**
- **Part Number** (required) - Unique identifier for the part (auto-uppercase)
- **Part Description** (required) - Description of the part
- **Part Type** (required) - Either "stock" or "supply"

**Optional Fields:**
- **Unit** - Measurement unit (Each, cm, ft, kg, pcs, L)
- **Last Unit Cost** - Most recent cost per unit
- **Quantity on Hand** - Current inventory level (numeric for stock, "NA" for supply)
- **Reorder Point** - Minimum quantity before reordering

### Part Type Behavior

**When Part Type = "stock":**
- Quantity on Hand accepts numeric values
- Part can be allocated to sales orders
- Shows in allocation suggestions

**When Part Type = "supply":**
- Quantity on Hand automatically set to "NA"
- Part cannot be allocated to sales orders
- Does not appear in allocation suggestions

## Purchase Order Creation

### Creating a New Purchase Order

1. **Navigation**: Go to Purchase Orders → Create New Purchase Order
2. **Basic Information**:
   - **Vendor**: Select existing vendor or create new one
   - **Date**: Purchase order date (defaults to current date)
   - **Bill Number**: Optional vendor invoice number
   - **Status**: Defaults to "Open"

### Adding Line Items

**Line Item Fields:**
- **Part Number**: Select from existing inventory or create new part
- **Part Description**: Auto-filled from inventory, can be edited
- **Quantity**: Number of items to order
- **Unit**: Measurement unit (Each, cm, ft, kg, pcs, L)
- **Unit Cost**: Cost per unit
- **Line Amount**: Auto-calculated (Quantity × Unit Cost)

**Line Item Actions:**
- **Add Line Item**: Click "+" button to add new line
- **Remove Line Item**: Click trash icon to delete line
- **Auto-fill**: Selecting a part number auto-fills description and unit cost

### Calculations

**Line Amount Calculation:**
```
Line Amount = Quantity × Unit Cost
```

**Purchase Order Totals:**
```
Subtotal = Sum of all Line Amounts
GST Amount = Subtotal × (GST Rate / 100)
Total Amount = Subtotal + GST Amount
```

**GST Rate**: Default 5%, customizable per purchase order

## Purchase Order Management

### Purchase Order List View

**Columns Displayed:**
- **Purchase Number**: Auto-generated sequence number
- **Vendor Name**: Selected vendor
- **Date**: Purchase order date
- **Bill Number**: Vendor invoice number
- **Subtotal**: Sum of line amounts
- **GST Amount**: Calculated GST
- **Total Amount**: Final total
- **Status**: Open or Closed

**Filtering Options:**
- **Status Filter**: All, Open, Closed
- **Search**: Search by purchase number, vendor name, or bill number
- **Date Range**: Filter by date range

### Purchase Order Actions

**Available Actions:**
- **Edit**: Modify purchase order details
- **Delete**: Remove purchase order (confirmation required)
- **Close**: Mark purchase order as closed
- **Download PDF**: Generate PDF of purchase order
- **Export to QBO**: Send to QuickBooks Online

## Allocation System

### What is Allocation?

Allocation is the process of assigning received inventory from purchase orders to specific sales orders that need those parts. This ensures that inventory is properly tracked and allocated to customer orders.

### Allocation Process

1. **Open Allocation Modal**: Click "Allocate" button on purchase order
2. **Review Suggestions**: System shows allocation suggestions based on:
   - Sales orders needing specific parts
   - Current inventory levels
   - Quantities ordered vs. needed

### Allocation Interface

**Allocation Modal Features:**
- **Part List**: Shows all parts in the purchase order
- **Sales Order Suggestions**: Lists sales orders needing each part
- **Quantity Fields**: Input fields for allocating quantities
- **Auto-Allocate**: Button to automatically allocate based on suggestions
- **Validation**: Ensures allocated quantities don't exceed ordered quantities

**Allocation Rules:**
- Can only allocate stock items (not supply items)
- Cannot allocate more than ordered quantity
- Can allocate to multiple sales orders
- Surplus quantities remain unallocated

### Allocation Buttons

**Auto-Allocate Button (Blue):**
- Automatically allocates quantities based on system suggestions
- Distributes inventory to sales orders with highest priority

**Save Allocations Button (Green):**
- Saves current allocation without closing purchase order
- Allows for partial allocation

**Close with Allocations Button (Orange):**
- Saves allocations and closes the purchase order
- Finalizes the allocation process

## Field Editing and Validation

### Editable Fields

**Purchase Order Level:**
- **Vendor**: Can be changed before saving
- **Date**: Editable date picker
- **Bill Number**: Free text field
- **Status**: Dropdown (Open/Closed)

**Line Item Level:**
- **Part Number**: Auto-complete with create new option
- **Part Description**: Editable text field
- **Quantity**: Numeric input with validation
- **Unit**: Dropdown selection
- **Unit Cost**: Numeric input with validation

### Validation Rules

**Required Fields:**
- Vendor must be selected
- At least one line item must be added
- Part number and description required for each line item
- Quantity must be greater than 0
- Unit cost must be greater than 0

**Business Rules:**
- Bill number must be unique (if provided)
- Purchase number is auto-generated and unique
- Cannot close purchase order without line items

### Error Handling

**Validation Errors:**
- Red border around invalid fields
- Error messages displayed below fields
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
- **Action**: Saves purchase order without closing
- **Behavior**: Validates form, shows loading state, displays success/error toast

**Close PO Button (Purple with Check Icon):**
- **Color**: Primary purple (`color="primary"`) - #7c3aed
- **Icon**: DoneAllIcon from Material-UI
- **Action**: Closes purchase order (changes status to "Closed")
- **Behavior**: Confirmation dialog, updates status, shows success toast

**Download PDF Button (Purple with Download Icon):**
- **Color**: Primary purple (`color="primary"`) - #7c3aed
- **Icon**: DownloadIcon from Material-UI
- **Action**: Saves purchase order and generates PDF
- **Behavior**: Saves first, then downloads PDF automatically

**Allocate Parts Button (Yellow with Check Icon):**
- **Color**: Secondary yellow (`color="secondary"`) - #ffd600
- **Icon**: DoneAllIcon from Material-UI
- **Action**: Opens allocation modal
- **Behavior**: Fetches allocation suggestions, opens modal dialog

### Navigation Buttons

**Back Button (Gray with Arrow Icon):**
- **Color**: Default gray
- **Icon**: ArrowBackIcon from Material-UI
- **Action**: Navigates back to purchase order list
- **Behavior**: Confirms unsaved changes before leaving

**Delete Button (Red with Trash Icon):**
- **Color**: Error red (`color="error"`)
- **Icon**: DeleteIcon from Material-UI
- **Action**: Deletes purchase order
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

### Purchase Order List Actions

**New PO Button (Contained Purple):**
- **Color**: Contained primary purple (`variant="contained"`) - #7c3aed
- **Icon**: AddIcon
- **Action**: Creates new purchase order
- **Behavior**: Navigates to new purchase order form

**Export CSV Button (Outlined Purple):**
- **Color**: Outlined primary purple (`variant="outlined"`) - #7c3aed
- **Icon**: DownloadIcon
- **Action**: Exports purchase order list to CSV
- **Behavior**: Downloads CSV file

**Download PDF Button (Outlined Purple):**
- **Color**: Outlined primary purple (`variant="outlined"`) - #7c3aed
- **Icon**: DownloadIcon
- **Action**: Downloads PDF of purchase order list
- **Behavior**: Generates and downloads PDF

**Export to QBO Button (Success Green):**
- **Color**: Success green (`color="success"`)
- **Icon**: CloudUploadIcon
- **Action**: Exports purchase order to QuickBooks Online
- **Behavior**: Shows loading state, exports to QBO

**Delete Button (Error Red):**
- **Color**: Error red (`color="error"`)
- **Icon**: DeleteIcon
- **Action**: Deletes purchase order
- **Behavior**: Confirmation dialog, removes from database

### Allocation Modal Buttons

**Auto Allocate Button (Outlined Purple):**
- **Color**: Outlined primary purple (`variant="outlined"`) - #7c3aed
- **Text**: "Auto Allocate (FIFO)"
- **Action**: Automatically allocates based on suggestions
- **Behavior**: Uses FIFO (First In, First Out) method

**Auto Allocate All Button (Outlined Purple):**
- **Color**: Outlined primary purple (`variant="outlined"`) - #7c3aed
- **Text**: "Auto Allocate All (FIFO)"
- **Action**: Automatically allocates all parts
- **Behavior**: Uses FIFO method for all parts

**Save Allocations Button (Contained Purple):**
- **Color**: Contained primary purple (`variant="contained"`) - #7c3aed
- **Text**: "Save Allocations"
- **Action**: Saves current allocation without closing purchase order
- **Behavior**: Allows for partial allocation

**Cancel Button (Default Gray):**
- **Color**: Default gray
- **Text**: "Cancel"
- **Action**: Closes modal without saving
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

### Purchase Order Tables

**purchasehistory Table:**
```sql
- purchase_id (SERIAL PRIMARY KEY)
- purchase_number (VARCHAR(255) UNIQUE)
- vendor_id (INTEGER REFERENCES vendormaster)
- purchase_date (DATE)
- bill_number (VARCHAR(255))
- subtotal (DECIMAL(10,2))
- total_gst_amount (DECIMAL(10,2))
- total_amount (DECIMAL(10,2))
- status (VARCHAR(50) DEFAULT 'Open')
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

**purchaselineitems Table:**
```sql
- line_item_id (SERIAL PRIMARY KEY)
- purchase_id (INTEGER REFERENCES purchasehistory)
- part_number (VARCHAR(255))
- part_description (TEXT)
- quantity (DECIMAL(10,2))
- unit (VARCHAR(50))
- unit_cost (DECIMAL(10,2))
- gst_amount (DECIMAL(10,2))
- line_total (DECIMAL(10,2))
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

**vendormaster Table:**
```sql
- vendor_id (SERIAL PRIMARY KEY)
- vendor_name (VARCHAR(255))
- street_address (VARCHAR(255))
- city (VARCHAR(100))
- province (VARCHAR(100))
- country (VARCHAR(100))
- contact_person (VARCHAR(255))
- telephone_number (VARCHAR(50))
- email (VARCHAR(255))
- website (VARCHAR(255))
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

**inventory Table:**
```sql
- part_number (VARCHAR(50) PRIMARY KEY)
- part_description (VARCHAR(255))
- unit (VARCHAR(50))
- last_unit_cost (NUMERIC(12,2))
- quantity_on_hand (NUMERIC(12,2))
- reorder_point (NUMERIC(12,2))
- part_type (VARCHAR(10) DEFAULT 'stock')
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

## Calculations and Formulas

### Line Item Calculations

**Line Amount:**
```javascript
const calculateLineAmount = (quantity, unit_cost) => {
  const q = parseFloat(String(quantity)) || 0;
  const uc = parseFloat(String(unit_cost)) || 0;
  return q * uc;
};
```

### Purchase Order Totals

**Subtotal:**
```javascript
const subtotal = lineItems.reduce((sum, item) => {
  const lineAmount = calculateLineAmount(item.quantity, item.unit_cost);
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

**Unit Cost Validation:**
```javascript
const unitCost = parseFloat(String(lineItem.unit_cost));
if (isNaN(unitCost) || unitCost < 0) {
  errors.unit_cost = 'Unit cost must be 0 or greater';
}
```

## Integration Features

### QuickBooks Online Integration

**Export to QBO:**
- Purchase orders can be exported to QuickBooks Online
- Maintains vendor and line item information
- Syncs with QBO accounts and items

**Export Status:**
- **Pending**: Not yet exported
- **Success**: Successfully exported to QBO
- **Error**: Export failed with error details

### PDF Generation

**Purchase Order PDF:**
- Includes business logo and contact information
- Lists all line items with quantities and costs
- Shows totals and GST calculations
- Professional formatting for vendor communication

### CSV Export

**Purchase Order List Export:**
- Exports all purchase orders to CSV format
- Includes all relevant fields for analysis
- Compatible with Excel and other spreadsheet applications

## Best Practices

### Creating Purchase Orders

1. **Vendor Selection**: Always verify vendor information before creating PO
2. **Part Numbers**: Use consistent part numbering system
3. **Quantities**: Double-check quantities before saving
4. **Unit Costs**: Verify unit costs with vendor before ordering
5. **Bill Numbers**: Include vendor invoice numbers when available

### Managing Inventory

1. **Part Types**: Use "stock" for items that need quantity tracking
2. **Part Types**: Use "supply" for consumable items
3. **Reorder Points**: Set appropriate reorder points for stock items
4. **Unit Costs**: Keep unit costs updated for accurate pricing

### Allocation Process

1. **Review Suggestions**: Always review allocation suggestions before auto-allocating
2. **Manual Allocation**: Use manual allocation for complex scenarios
3. **Surplus Management**: Monitor surplus quantities for future orders
4. **Close Orders**: Close purchase orders after allocation is complete

### Data Management

1. **Regular Backups**: Ensure regular database backups
2. **Data Validation**: Validate data before saving
3. **Audit Trail**: Monitor changes through timestamps
4. **Error Handling**: Address validation errors promptly

This comprehensive guide covers all aspects of the NEURATASK Purchase Order system, from basic creation to advanced allocation features. The system is designed to be user-friendly while providing powerful inventory management capabilities for small to medium-sized businesses. 
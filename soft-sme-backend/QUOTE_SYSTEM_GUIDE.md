# SOFT SME Quote System - Complete Guide

## Table of Contents
1. [Overview](#overview)
2. [Customer Management](#customer-management)
3. [Product Management](#product-management)
4. [Quote Creation](#quote-creation)
5. [Quote Management](#quote-management)
6. [Quote Status and Workflow](#quote-status-and-workflow)
7. [Field Editing and Validation](#field-editing-and-validation)
8. [Buttons and Actions](#buttons-and-actions)
9. [Database Structure](#database-structure)
10. [Calculations and Formulas](#calculations-and-formulas)
11. [PDF Generation](#pdf-generation)
12. [Sales Order Conversion](#sales-order-conversion)

## Overview

The SOFT SME Quote system is a comprehensive solution for creating, managing, and tracking customer quotes. The system allows businesses to generate professional quotes for customers, track quote status, and convert approved quotes into sales orders. The system includes customer management, product management, and integration with the sales order workflow.

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

### Customer Selection in Quotes

- **Search Functionality**: Users can search customers by name using autocomplete
- **Create New**: If a customer doesn't exist, users can create a new customer inline by typing the name and pressing Enter
- **Edit Existing**: Existing customers can be edited through the same dialog
- **Auto-complete**: System suggests existing customers as you type

## Product Management

### Creating Products

Products are created through the **UnifiedProductDialog** component:

**Required Fields:**
- **Product Name** (required) - The name of the product/service

### Product Creation Process

1. **Simple Creation**: Only product name is required
2. **Inline Creation**: Users can create new products directly from the quote form
3. **Database Storage**: Products are stored in the `products` table with auto-generated `product_id`

### Product Selection in Quotes

- **Search Functionality**: Users can search products by name using autocomplete
- **Create New**: If a product doesn't exist, users can create a new product inline by typing the name and pressing Enter
- **Auto-complete**: System suggests existing products as you type

## Quote Creation

### Creating a New Quote

1. **Navigation**: Go to Quotes → New Quote
2. **Basic Information**:
   - **Customer**: Select existing customer or create new one
   - **Quote Date**: Date the quote is created (defaults to current date)
   - **Valid Until**: Date the quote expires (defaults to current date)
   - **Product**: Select existing product or create new one
   - **Estimated Price**: Cost estimate for the quote
   - **Status**: Defaults to "Draft"

### Quote Number Generation

**Format**: `QO-YYYY-NNNNN`
- **QO**: Quote prefix
- **YYYY**: Current year
- **NNNNN**: 5-digit sequence number (padded with zeros)

**Example**: `QO-2024-00001`

### Additional Quote Fields

**Optional Fields:**
- **Customer PO Number**: Customer's purchase order number
- **VIN Number**: Vehicle identification number (for automotive quotes)
- **Product Description**: Detailed description of the product/service
- **Terms and Conditions**: Custom terms for the quote

### Quote Form Layout

**Top Row:**
- Customer (required)
- Customer PO # (optional)
- Estimated Price (required)

**Second Row:**
- Product (required)
- VIN # (optional)

**Third Row:**
- Quote Date (required)
- Valid Until (required)

**Bottom Section:**
- Product Description (multiline text area)
- Terms and Conditions (multiline text area)

## Quote Management

### Quote List View

**Columns Displayed:**
- **Quote #**: Auto-generated sequence number (QO-YYYY-NNNNN)
- **Customer**: Selected customer name
- **Product**: Selected product name
- **Est. Price**: Estimated cost
- **Quote Date**: Date quote was created
- **Valid Until**: Quote expiration date
- **Actions**: Delete button

**Filtering Options:**
- **Search**: Search by quote number, customer name, or product name
- **Sorting**: Default sort by quote number (descending)

### Quote Actions

**Available Actions:**
- **Edit**: Click on any row to edit quote details
- **Delete**: Remove quote (confirmation required)
- **Convert to SO**: Convert quote to sales order
- **Download PDF**: Generate PDF of quote
- **Export CSV**: Export quote list to CSV
- **Export PDF**: Export quote list to PDF

## Quote Status and Workflow

### Quote Statuses

**Draft Status:**
- **Default Status**: All new quotes start as "Draft"
- **Editable**: Can be modified and saved
- **Convertible**: Can be converted to sales order

**Closed Status:**
- **Final Status**: Quote is no longer valid
- **Read-only**: Cannot be modified
- **Historical**: Used for record keeping

### Quote Workflow

1. **Create Draft**: User creates new quote with basic information
2. **Edit and Refine**: User adds details, descriptions, and terms
3. **Save Quote**: Quote is saved to database with "Draft" status
4. **Send to Customer**: PDF can be generated and sent to customer
5. **Customer Review**: Customer reviews quote and provides feedback
6. **Convert to Sales Order**: If approved, quote is converted to sales order
7. **Close Quote**: If rejected or expired, quote is closed

## Field Editing and Validation

### Editable Fields

**Quote Level:**
- **Customer**: Can be changed before saving
- **Quote Date**: Editable date picker
- **Valid Until**: Editable date picker
- **Product**: Auto-complete with create new option
- **Estimated Price**: Numeric input with validation
- **Customer PO #**: Free text field
- **VIN #**: Free text field
- **Product Description**: Multiline text area
- **Terms and Conditions**: Multiline text area

### Validation Rules

**Required Fields:**
- Customer must be selected
- Quote date must be provided
- Valid until date must be provided
- Product must be selected
- Estimated price must be greater than 0

**Business Rules:**
- Quote number is auto-generated and unique
- Valid until date should be after quote date
- Customer must exist in database
- Product must exist in database

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

**Save Quote Button (Purple with Save Icon):**
- **Color**: Primary purple (`color="primary"`) - #7c3aed
- **Icon**: SaveIcon from Material-UI
- **Action**: Saves quote without closing
- **Behavior**: Validates form, shows loading state, displays success/error toast

**Save Changes Button (Purple with Save Icon):**
- **Color**: Primary purple (`color="primary"`) - #7c3aed
- **Icon**: SaveIcon from Material-UI
- **Action**: Updates existing quote
- **Behavior**: Validates form, shows loading state, displays success/error toast

**Convert to SO Button (Purple with Convert Icon):**
- **Color**: Primary purple (`color="primary"`) - #7c3aed
- **Icon**: Convert icon
- **Action**: Converts quote to sales order
- **Behavior**: Creates new sales order with quote data, navigates to sales order

**Download PDF Button (Purple with Download Icon):**
- **Color**: Primary purple (`color="primary"`) - #7c3aed
- **Icon**: DownloadIcon from Material-UI
- **Action**: Saves quote and generates PDF
- **Behavior**: Saves first, then downloads PDF automatically

### Navigation Buttons

**Back Button (Gray with Arrow Icon):**
- **Color**: Default gray
- **Icon**: ArrowBackIcon from Material-UI
- **Action**: Navigates back to quote list
- **Behavior**: Confirms unsaved changes before leaving

**Delete Button (Red with Trash Icon):**
- **Color**: Error red (`color="error"`)
- **Icon**: DeleteIcon from Material-UI
- **Action**: Deletes quote
- **Behavior**: Confirmation dialog, removes from database

### Quote List Actions

**New Quote Button (Contained Purple):**
- **Color**: Contained primary purple (`variant="contained"`) - #7c3aed
- **Icon**: AddIcon
- **Action**: Creates new quote
- **Behavior**: Navigates to new quote form

**Export CSV Button (Outlined Purple):**
- **Color**: Outlined primary purple (`variant="outlined"`) - #7c3aed
- **Icon**: DownloadIcon
- **Action**: Exports quote list to CSV
- **Behavior**: Downloads CSV file

**Export PDF Button (Outlined Purple):**
- **Color**: Outlined primary purple (`variant="outlined"`) - #7c3aed
- **Icon**: DownloadIcon
- **Action**: Downloads PDF of quote list
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
- **Draft Status**: Default gray
- **Closed Status**: Error red (`color="error"`)

## Database Structure

### Quote Tables

**quotes Table:**
```sql
- quote_id (SERIAL PRIMARY KEY)
- quote_number (VARCHAR(255) UNIQUE NOT NULL)
- customer_id (INTEGER REFERENCES customermaster)
- quote_date (DATE)
- valid_until (DATE)
- product_name (VARCHAR(255))
- product_description (TEXT)
- estimated_cost (DECIMAL(12,2))
- status (VARCHAR(50))
- sequence_number (VARCHAR(16))
- terms (TEXT)
- customer_po_number (VARCHAR(255))
- vin_number (VARCHAR(255))
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

**Quote to Customer:**
- `quotes.customer_id` → `customermaster.customer_id`
- Foreign key relationship
- One customer can have many quotes

**Quote to Product:**
- `quotes.product_name` → `products.product_name`
- Text-based relationship
- One product can be used in many quotes

## Calculations and Formulas

### Quote Number Generation

**Sequence Number Logic:**
```javascript
const currentYear = new Date().getFullYear();
const { sequenceNumber, nnnnn } = await getNextSequenceNumberForYear(currentYear);
const formattedQuoteNumber = `QO-${currentYear}-${nnnnn.toString().padStart(5, '0')}`;
```

**Example:**
- Year: 2024
- Sequence: 1
- Result: `QO-2024-00001`

### Validation Formulas

**Estimated Cost Validation:**
```javascript
const estimatedCost = parseFloat(String(quote.estimated_cost));
if (isNaN(estimatedCost) || estimatedCost <= 0) {
  errors.estimatedCost = 'Estimated cost must be greater than 0';
}
```

**Date Validation:**
```javascript
const quoteDate = dayjs(quote.quote_date);
const validUntil = dayjs(quote.valid_until);
if (validUntil.isBefore(quoteDate)) {
  errors.validUntil = 'Valid until date must be after quote date';
}
```

### Rounding

All monetary calculations are rounded to 2 decimal places:
```javascript
return Math.round(amount * 100) / 100;
```

## PDF Generation

### Quote PDF Features

**Header Information:**
- Business logo and contact information
- Quote number and date
- Customer information
- Valid until date

**Quote Details:**
- Product name and description
- Estimated cost
- Customer PO number (if provided)
- VIN number (if provided)

**Footer Information:**
- Terms and conditions
- Business contact details
- Professional formatting

### PDF Generation Process

1. **Data Collection**: Gather all quote information
2. **Template Creation**: Use PDFKit to create professional layout
3. **Content Population**: Fill template with quote data
4. **File Generation**: Create PDF file with quote number in filename
5. **Download**: Automatically download PDF to user's device

### PDF File Naming

**Format**: `quote_QUOTE_NUMBER_DATE.pdf`
**Example**: `quote_QO-2024-00001_2024-01-15.pdf`

## Sales Order Conversion

### Conversion Process

**When Quote is Approved:**
1. **Convert Button**: User clicks "Convert to SO" button
2. **Data Transfer**: Quote data is transferred to sales order
3. **Sales Order Creation**: New sales order is created with quote information
4. **Navigation**: User is redirected to sales order page
5. **Quote Status**: Quote can be closed or left as draft

### Data Mapping

**Quote to Sales Order Mapping:**
- **Customer**: Same customer information
- **Product**: Same product and description
- **Cost**: Estimated cost becomes sales order amount
- **Dates**: Quote date becomes sales order date
- **Additional Info**: Customer PO and VIN numbers are preserved

### Conversion Benefits

**Streamlined Workflow:**
- No need to re-enter customer information
- Product details are automatically transferred
- Cost estimates become actual prices
- Maintains data consistency

**Business Process:**
- Quote approval process is formalized
- Sales order creation is automated
- Reduces data entry errors
- Improves customer experience

## Best Practices

### Creating Quotes

1. **Customer Information**: Always verify customer details before creating quote
2. **Product Descriptions**: Provide detailed product descriptions for clarity
3. **Pricing**: Ensure estimated costs are accurate and competitive
4. **Terms**: Include clear terms and conditions
5. **Expiration**: Set reasonable expiration dates

### Managing Quotes

1. **Regular Review**: Review draft quotes regularly
2. **Follow-up**: Follow up on quotes before they expire
3. **Conversion**: Convert approved quotes promptly
4. **Documentation**: Keep records of all quote communications
5. **Analysis**: Use quote data for business analysis

### Customer Communication

1. **Professional Presentation**: Use PDF format for customer communication
2. **Clear Information**: Ensure all quote details are clear and accurate
3. **Contact Information**: Include business contact details
4. **Terms**: Clearly state terms and conditions
5. **Follow-up**: Follow up on quotes sent to customers

### Data Management

1. **Regular Backups**: Ensure regular database backups
2. **Data Validation**: Validate data before saving
3. **Audit Trail**: Monitor changes through timestamps
4. **Error Handling**: Address validation errors promptly
5. **Data Integrity**: Maintain referential integrity

## Integration Features

### Sales Order Integration

**Quote to Sales Order:**
- Seamless conversion process
- Data preservation and transfer
- Workflow automation
- Status tracking

### Customer Management Integration

**Customer Data:**
- Shared customer database
- Consistent customer information
- Contact history tracking
- Communication management

### Product Management Integration

**Product Data:**
- Shared product database
- Consistent product information
- Pricing history
- Product descriptions

This comprehensive guide covers all aspects of the SOFT SME Quote system, from basic creation to advanced conversion features. The system is designed to be user-friendly while providing powerful quote management capabilities for small to medium-sized businesses. 
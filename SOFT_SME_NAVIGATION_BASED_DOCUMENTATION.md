# Aiven Application - Navigation-Based Complete Documentation

## Table of Contents
1. [Application Overview](#application-overview)
2. [Navigation Structure](#navigation-structure)
3. [Dashboard & Landing Page](#dashboard--landing-page)
4. [Business Profile Management](#business-profile-management)
5. [Purchasing Module](#purchasing-module)
6. [Sales Module](#sales-module)
7. [Products & Inventory Module](#products--inventory-module)
8. [Employees & Time Tracking Module](#employees--time-tracking-module)
9. [System Management](#system-management)
10. [Modal Dialogs & Detail Pages](#modal-dialogs--detail-pages)
11. [Page Connections & Workflows](#page-connections--workflows)

---

## Application Overview

Aiven is a comprehensive business management application designed for small and medium enterprises. The application provides integrated modules for purchasing, sales, inventory management, employee management, time tracking, and financial operations with QuickBooks Online integration.

**Key Features:**
- Multi-platform support (Web, Desktop via Electron, Mobile via Capacitor)
- Role-based access control (Admin, Sales and Purchase, Time Tracking, Mobile Time Tracker, Quotes)
- Real-time data synchronization
- QuickBooks Online integration
- Comprehensive reporting and export capabilities
- Backup and restore functionality

---

## Navigation Structure

The application uses a hierarchical navigation system with the following main sections:

### Main Navigation Categories:
1. **Dashboard** - Main landing page with module overview
2. **Business Profile** - Company information and settings
3. **Purchasing** - Purchase orders and vendor management
4. **Sales** - Quotes, sales orders, pricing, and customer management
5. **Products & Inventory** - Product definitions, stock, and supply management
6. **Employees & Time Tracking** - Employee management and time tracking
7. **System** - Backup management and system settings

### Role-Based Access:
- **Admin**: Full access to all modules
- **Sales and Purchase**: Limited to purchasing, sales, inventory, and customer management
- **Time Tracking**: Access only to attendance and time tracking
- **Mobile Time Tracker**: Mobile-specific time tracking interface
- **Quotes**: Access only to quotes module

---

## Dashboard & Landing Page

### Landing Page (`/`)
**Purpose:** Main entry point and overview of all application modules

**Features:**
- **Welcome Banner**: Displays application title and description
- **Module Cards**: Categorized sections with navigation cards
- **Role-Based Display**: Shows only relevant modules based on user role
- **Responsive Design**: Adapts to different screen sizes

**Module Categories Displayed:**
1. **Purchasing**
   - Purchase Orders
   - Vendors
2. **Sales**
   - Quotes
   - Sales Orders
   - Margin & Labour Rate
   - Overhead Management
   - Parts to Order
   - Customers
3. **Products & Inventory**
   - Products
   - Stock
   - Supply
4. **Employees & Time Tracking**
   - Employees
   - Attendance
   - Time Tracking
   - Time Tracking Reports
5. **Business Profile**
   - Business Profile

**Navigation Flow:**
- Each card links to its respective module page
- Cards have hover effects and visual feedback
- Responsive grid layout adapts to screen size

---

## Business Profile Management

### Business Profile Page (`/business-profile`)
**Purpose:** Manage company information, logo, and QuickBooks integration

**Features:**
- **Company Information Management**:
  - Business name, number, address
  - Contact information (phone, email)
  - Logo upload and management
- **QuickBooks Integration**:
  - Connect to QuickBooks Online
  - Access QBO account mapping settings
- **Dual Mode Operation**:
  - Read-only view for existing profiles
  - Edit mode for creating/updating profiles

**Key Functionality:**
- **Profile Creation**: First-time setup with all required fields
- **Profile Editing**: Update existing company information
- **Logo Management**: Upload, preview, and delete company logo
- **QuickBooks Connection**: Direct link to OAuth authentication
- **QBO Settings Access**: Navigation to account mapping configuration

**Form Fields:**
- Business Name (required)
- Business Number/GST-HST Registration Number
- Street Address, City, Province, Country, Postal Code
- Telephone Number, Email, Website
- Logo upload with preview

**Connections:**
- Links to QBO Account Mapping page
- Integrates with QuickBooks OAuth flow
- Used by quotes, invoices, and other business documents

### QBO Account Mapping Page (`/qbo-account-mapping`)
**Purpose:** Configure QuickBooks Online account mappings for financial transactions

**Features:**
- **Connection Status**: Real-time QuickBooks connection monitoring
- **Account Discovery**: Browse and search QuickBooks accounts
- **Mapping Configuration**: Map Aiven operations to QBO accounts
- **Account Categories**: Organized by classification (Asset, Liability, Revenue, Expense)

**Account Mappings:**
1. **Shared Accounts** (Purchase Orders & Sales Orders):
   - GST/Tax Account
   - Inventory Account

2. **Purchase Order Accounts**:
   - Supply Expense Account
   - Accounts Payable

3. **Sales Order Accounts**:
   - Sales Account
   - Accounts Receivable

4. **Cost Accounts** (Journal Entries):
   - Cost of Materials
   - Cost of Labour
   - Labour Expense Reduction
   - Overhead COGS

**Key Functionality:**
- **Account Search**: Filter accounts by name, number, or description
- **Account Browser**: View all QBO accounts by classification
- **Mapping Validation**: Ensure required accounts are selected
- **Current Mapping Display**: Show existing configuration
- **Connection Testing**: Verify QuickBooks connectivity

**Connections:**
- Requires QuickBooks connection from Business Profile
- Used by purchase order and sales order export functionality
- Integrates with financial transaction processing

---

## Purchasing Module

### Purchase Orders Page (`/open-purchase-orders`)
**Purpose:** Manage and track all purchase orders

**Features:**
- **Purchase Order List**: DataGrid with comprehensive order information
- **Status Filtering**: Filter by All, Open, or Closed orders
- **Search Functionality**: Search by purchase number, vendor, or bill number
- **Export Capabilities**: CSV and PDF export options
- **QuickBooks Integration**: Export closed orders to QuickBooks as bills

**Data Display:**
- Purchase Number, Vendor Name, Bill Number
- Subtotal, GST Rate, GST Amount, Total Amount
- Status (Open/Closed), QBO Export Status
- Action buttons for export and deletion

**Key Functionality:**
- **Create New PO**: Navigate to purchase order creation
- **View/Edit Orders**: Click rows to access detail pages
- **Export to QuickBooks**: Convert closed orders to QBO bills
- **Delete Orders**: Remove open orders (admin only)
- **Status Management**: Track order lifecycle

**Navigation Flow:**
- Click "New PO" → Open Purchase Order Detail Page (creation mode)
- Click existing order → Open Purchase Order Detail Page (edit mode)
- Closed orders → Purchase Order Detail Page (read-only)

### Open Purchase Order Detail Page (`/open-purchase-orders/:id`)
**Purpose:** Create and edit purchase orders with line items

**Features:**
- **Vendor Selection**: Autocomplete with option to add new vendors
- **Line Item Management**: Add, edit, and remove purchase order items
- **Automatic Calculations**: Subtotal, GST, and total calculations
- **Part Management**: Add new parts directly from line items
- **Allocation System**: Allocate parts to sales orders
- **PDF Generation**: Download purchase order as PDF

**Key Functionality:**
- **Vendor Management**: Select existing vendors or create new ones
- **Line Item Operations**:
  - Add parts with quantity, unit, and cost
  - Auto-calculate line amounts
  - Remove items (quantity = 0)
- **Part Creation**: Add new parts directly from line items
- **Order Status**: Open/Close purchase orders
- **Bill Number Management**: Required for closing orders
- **GST Rate Configuration**: Global GST rate setting

**Form Fields:**
- Vendor (autocomplete with add new option)
- Bill Number
- GST Rate (%)
- Line Items: Part Number, Description, Quantity, Unit, Unit Cost, Amount

**Connections:**
- Integrates with Vendor Management
- Connects to Inventory Management for part creation
- Links to Parts to Order system
- Exports to QuickBooks Online

### Vendor List Page (`/vendors`)
**Purpose:** Manage vendor information and relationships

**Features:**
- **Vendor Directory**: Complete list of all vendors
- **Search Functionality**: Search by name, contact person, or email
- **Add/Edit Vendors**: Modal dialogs for vendor management
- **Export Options**: CSV and PDF export capabilities
- **Delete Functionality**: Remove vendors from system

**Data Display:**
- Vendor Name, Contact Person, Email, Phone Number
- Action buttons for edit and delete operations

**Key Functionality:**
- **Vendor Creation**: Add new vendors with complete information
- **Vendor Editing**: Update existing vendor details
- **Vendor Deletion**: Remove vendors (with confirmation)
- **Data Export**: Export vendor list in multiple formats
- **Search and Filter**: Find vendors quickly

**Vendor Information Fields:**
- Vendor Name, Contact Person
- Email, Phone Number, Website
- Street Address, City, Province, Country, Postal Code

**Connections:**
- Used by Purchase Order creation and management
- Referenced in purchase order exports
- Integrated with QuickBooks vendor sync

---

## Sales Module

### Quotes Page (`/quotes`)
**Purpose:** Create and manage customer quotes

**Features:**
- **Quote Management**: Create, edit, and track quotes
- **Customer Integration**: Select customers or create new ones
- **Product Selection**: Choose products or add new ones
- **Quote Conversion**: Convert quotes to sales orders
- **PDF Generation**: Download quotes as professional PDFs
- **Status Tracking**: Open/Closed quote status

**Key Functionality:**
- **Quote Creation**: New quote with customer and product selection
- **Quote Editing**: Modify existing quotes
- **Quote Conversion**: Transform quotes into sales orders
- **Quote Closing**: Mark quotes as closed
- **PDF Export**: Generate professional quote documents
- **Customer Management**: Add new customers during quote creation

**Form Fields:**
- Customer (autocomplete with add new option)
- Quote Date, Valid Until Date
- Product (autocomplete with add new option)
- Product Description, Terms and Conditions
- Estimated Price

**Data Display:**
- Quote Number, Customer Name, Product Name
- Estimated Price, Quote Date, Valid Until Date
- Action buttons for conversion and deletion

**Connections:**
- Links to Customer Management
- Connects to Product Management
- Integrates with Sales Order creation
- Used by PDF generation system

### Sales Orders Page (`/open-sales-orders`)
**Purpose:** Manage and track all sales orders

**Features:**
- **Sales Order List**: Comprehensive order tracking
- **Status Filtering**: All, Open, or Closed orders
- **Work in Process Tracking**: Total value of open orders
- **Search Functionality**: Search by order number, customer, or product
- **QuickBooks Integration**: Export closed orders to QuickBooks as invoices

**Data Display:**
- Sales Order Number, Customer Name, Product Name/Description
- Subtotal, GST, Total Amount
- Status (Open/Closed), QBO Export Status
- Action buttons for export and deletion

**Key Functionality:**
- **Create New SO**: Navigate to sales order creation
- **View/Edit Orders**: Access detail pages for existing orders
- **Export to QuickBooks**: Convert closed orders to QBO invoices
- **Status Management**: Track order lifecycle
- **Work in Process**: Monitor total value of open orders

**Navigation Flow:**
- Click "New SO" → Sales Order Detail Page (creation mode)
- Click existing order → Open Sales Order Detail Page (edit mode)

### Open Sales Order Detail Page (`/open-sales-orders/:id`)
**Purpose:** Create and edit sales orders with line items

**Features:**
- **Customer Selection**: Autocomplete with option to add new customers
- **Line Item Management**: Add, edit, and remove sales order items
- **Inventory Integration**: Real-time inventory level checking
- **Automatic Calculations**: Subtotal, GST, and total calculations
- **Part Management**: Add new parts directly from line items
- **Parts to Order**: Track parts that need to be ordered
- **PDF Generation**: Download sales order as PDF

**Key Functionality:**
- **Customer Management**: Select existing customers or create new ones
- **Line Item Operations**:
  - Add parts with quantity, unit, and price
  - Auto-calculate line amounts
  - Remove items (quantity = 0)
- **Inventory Validation**: Check stock levels and warn about shortages
- **Part Creation**: Add new parts directly from line items
- **Order Status**: Open/Close sales orders
- **Parts to Order Tracking**: Monitor parts that need ordering

**Form Fields:**
- Customer (autocomplete with add new option)
- Product Name, Product Description
- Line Items: Part Number, Description, Quantity, Unit, Unit Price, Amount
- Terms and Conditions

**Connections:**
- Integrates with Customer Management
- Connects to Inventory Management
- Links to Parts to Order system
- Exports to QuickBooks Online

### Margin Schedule Page (`/margin-schedule`)
**Purpose:** Configure pricing margins and labour rates

**Features:**
- **Margin Schedule Management**: Define cost-based margin factors
- **Labour Rate Configuration**: Set hourly labour rates
- **Overhead Rate Management**: Configure overhead hourly rates
- **Schedule Editing**: Add, edit, and delete margin entries

**Key Functionality:**
- **Margin Schedule**:
  - Cost Lower Bound, Cost Upper Bound
  - Margin Factor (percentage)
  - Add/Edit/Delete margin entries
- **Labour Rate**: Set default hourly labour rate
- **Overhead Rate**: Configure overhead hourly rate
- **Schedule Validation**: Ensure proper cost ranges

**Data Display:**
- Margin ID, Cost Lower Bound, Cost Upper Bound, Margin Factor
- Action buttons for editing and deletion

**Connections:**
- Used by sales order pricing calculations
- Integrated with labour cost tracking
- Referenced in margin calculations

### Overhead Management Page (`/overhead-management`)
**Purpose:** Configure overhead expense distribution for QuickBooks integration

**Features:**
- **Expense Distribution**: Map overhead expenses to QBO accounts
- **Percentage Management**: Configure distribution percentages
- **QuickBooks Integration**: Browse and select QBO accounts
- **Distribution Summary**: Monitor total percentage allocation

**Key Functionality:**
- **Account Mapping**: Select QBO expense accounts
- **Percentage Configuration**: Set distribution percentages (total must equal 100%)
- **Distribution Management**: Add, edit, and delete distributions
- **Account Browser**: View all available QBO accounts
- **Validation**: Ensure percentages don't exceed 100%

**Data Display:**
- Expense Account, Percentage, Description
- Total percentage tracking
- Action buttons for editing and deletion

**Connections:**
- Integrates with QuickBooks Online
- Used by overhead cost calculations
- Connected to COGS journal entries

### Parts to Order Page (`/parts-to-order`)
**Purpose:** Track and manage parts that need to be ordered

**Features:**
- **Aggregated Parts List**: Combine parts needed across multiple sales orders
- **Quantity Management**: Adjust quantities to order
- **Sales Order Breakdown**: View which sales orders require each part
- **Part Addition**: Add parts manually to the order list
- **Minimum Required Tracking**: Track minimum quantities needed

**Key Functionality:**
- **Parts Aggregation**: Combine requirements from multiple sales orders
- **Quantity Adjustment**: Modify quantities to order
- **Sales Order Details**: Expand to see contributing sales orders
- **Manual Addition**: Add parts not currently in sales orders
- **Minimum Requirements**: Track minimum quantities needed

**Data Display:**
- Part Number, Description, Quantity to Order
- Unit, Unit Price, Total Amount, Minimum Required
- Expandable sales order breakdown

**Connections:**
- Integrates with Sales Order Management
- Connects to Inventory Management
- Links to Purchase Order creation
- Used by inventory planning

### Customer List Page (`/customers`)
**Purpose:** Manage customer information and relationships

**Features:**
- **Customer Directory**: Complete list of all customers
- **Search Functionality**: Search by name, email, phone, or address
- **Add/Edit Customers**: Modal dialogs for customer management
- **Export Options**: CSV and PDF export capabilities
- **Delete Functionality**: Remove customers from system

**Data Display:**
- Customer Name, Contact Person, Email, Phone Number
- Action buttons for edit and delete operations

**Key Functionality:**
- **Customer Creation**: Add new customers with complete information
- **Customer Editing**: Update existing customer details
- **Customer Deletion**: Remove customers (with confirmation)
- **Data Export**: Export customer list in multiple formats
- **Search and Filter**: Find customers quickly

**Customer Information Fields:**
- Customer Name, Contact Person
- Email, Phone Number, Website
- Street Address, City, Province, Country, Postal Code

**Connections:**
- Used by Quotes and Sales Order creation
- Referenced in sales order exports
- Integrated with QuickBooks customer sync

---

## Products & Inventory Module

### Products Page (`/products`)
**Purpose:** Manage product definitions and catalog

**Features:**
- **Product Catalog**: List of all product definitions
- **Product Management**: Add, edit, and delete products
- **Search Functionality**: Search products by name
- **Export Options**: PDF export capability
- **Simple Interface**: Focused on product definitions

**Data Display:**
- Product ID, Product Name
- Action buttons for deletion

**Key Functionality:**
- **Product Creation**: Add new product definitions
- **Product Editing**: Update existing product information
- **Product Deletion**: Remove products (with confirmation)
- **Data Export**: Export product list to PDF
- **Search**: Find products quickly

**Product Information Fields:**
- Product Name (required)
- Product Description (optional)

**Connections:**
- Referenced by Quotes and Sales Orders
- Foundation for inventory items
- Used in product selection dropdowns

### Stock Page (`/inventory`)
**Purpose:** Manage stock inventory items with quantities and costs

**Features:**
- **Stock Management**: Track stock items with quantities on hand
- **Real-time Editing**: Edit quantities and costs directly in grid
- **CSV Import/Export**: Bulk import and export capabilities
- **Part Creation**: Add new stock parts
- **Value Calculations**: Automatic inventory value calculations
- **Cleanup Tools**: Remove leading/trailing spaces from data

**Data Display:**
- Part Number, Part Description, Quantity on Hand
- Unit, Last Unit Cost, Reorder Point, Value
- Action buttons for deletion

**Key Functionality:**
- **Stock Tracking**: Monitor quantities on hand
- **Cost Management**: Track last unit costs
- **Reorder Points**: Set minimum stock levels
- **Value Calculation**: Automatic inventory value computation
- **CSV Operations**: Import/export with progress tracking
- **Data Cleanup**: Remove formatting issues

**Stock Item Fields:**
- Part Number, Part Description, Unit
- Last Unit Cost, Quantity on Hand, Reorder Point
- Part Type (stock)

**Connections:**
- Integrated with Sales Order inventory validation
- Connected to Purchase Order part creation
- Used by Parts to Order calculations
- Exports to QuickBooks inventory accounts

### Supply Page (`/supply`)
**Purpose:** Manage supply items (non-stock inventory)

**Features:**
- **Supply Management**: Track supply items without quantity tracking
- **Cost Tracking**: Monitor unit costs for supply items
- **CSV Import/Export**: Bulk import and export capabilities
- **Part Creation**: Add new supply parts
- **Reorder Points**: Set reorder thresholds

**Data Display:**
- Part Number, Part Description, Unit
- Last Unit Cost, Reorder Point, Part Type
- Action buttons for deletion

**Key Functionality:**
- **Supply Tracking**: Manage supply items (quantity = "NA")
- **Cost Management**: Track unit costs
- **Reorder Points**: Set reorder thresholds
- **CSV Operations**: Import/export with progress tracking
- **Part Management**: Add, edit, and delete supply parts

**Supply Item Fields:**
- Part Number, Part Description, Unit
- Last Unit Cost, Reorder Point
- Part Type (supply)

**Connections:**
- Used by Purchase Orders for supply items
- Connected to expense account mapping
- Integrated with QuickBooks expense accounts

---

## Employees & Time Tracking Module

### Employees Page (`/employees`)
**Purpose:** Manage employee accounts and access roles

**Features:**
- **Employee Registration**: Create new employee accounts
- **Role Management**: Assign access roles to employees
- **Account Management**: Edit employee information and passwords
- **Role-Based Access**: Different access levels for different roles

**Key Functionality:**
- **Employee Creation**: Register new employees with roles
- **Role Assignment**: Assign access roles (Admin, Sales and Purchase, Time Tracking, etc.)
- **Account Editing**: Update employee information and passwords
- **Account Deletion**: Remove employee accounts
- **Password Management**: Set and update employee passwords

**Employee Information Fields:**
- Username, Email, Initial Password
- Access Role (Admin, Sales and Purchase, Time Tracking, Mobile Time Tracker, Quotes)

**Access Roles:**
- **Admin**: Full access to all modules
- **Sales and Purchase**: Limited to purchasing, sales, inventory, customers
- **Time Tracking**: Access only to attendance and time tracking
- **Mobile Time Tracker**: Mobile-specific time tracking
- **Quotes**: Access only to quotes module

**Connections:**
- Controls access to all other modules
- Integrated with authentication system
- Used by time tracking for employee identification

### Attendance Page (`/attendance`)
**Purpose:** Track employee attendance and shift management

**Features:**
- **Profile Management**: Create and manage employee profiles
- **Shift Tracking**: Clock in/out for attendance tracking
- **Shift History**: View complete shift history
- **Shift Editing**: Modify clock in/out times
- **Unclosed Shift Warnings**: Alert for incomplete shifts

**Key Functionality:**
- **Profile Creation**: Add new employee profiles
- **Clock In/Out**: Track attendance with timestamps
- **Shift Management**: View and edit shift records
- **History Tracking**: Complete shift history with durations
- **Data Validation**: Prevent multiple open shifts

**Data Display:**
- Profile Name, Clock In Time, Clock Out Time, Duration
- Action buttons for clock out and editing

**Form Fields:**
- Profile Name, Email (for profile creation)
- Clock In/Out times (for editing)

**Connections:**
- Integrated with Time Tracking system
- Used by Time Tracking Reports
- Connected to employee profiles

### Time Tracking Page (`/time-tracking`)
**Purpose:** Track time spent on specific sales orders

**Features:**
- **Profile Management**: Create and manage employee profiles
- **Sales Order Selection**: Choose sales orders to track time against
- **Time Entry Management**: Clock in/out for specific sales orders
- **Rate Configuration**: Set and manage hourly rates
- **Real-time Duration**: Live duration tracking for active entries

**Key Functionality:**
- **Profile Creation**: Add new employee profiles
- **Sales Order Selection**: Choose from available sales orders
- **Clock In/Out**: Track time against specific sales orders
- **Rate Management**: Set default hourly rates
- **Entry Editing**: Modify clock in/out times
- **Real-time Updates**: Live duration calculation

**Data Display:**
- Sales Order Number, Clock In Time, Clock Out Time, Duration
- Action buttons for clock out and editing

**Form Fields:**
- Profile Name, Email (for profile creation)
- Sales Order selection
- Clock In/Out times (for editing)

**Connections:**
- Integrated with Sales Order Management
- Used by Time Tracking Reports
- Connected to labour cost calculations
- Exports to QuickBooks for billing

### Time Tracking Reports Page (`/time-tracking/reports`)
**Purpose:** Generate comprehensive time tracking reports

**Features:**
- **Report Generation**: Create time tracking reports by date range
- **Profile Filtering**: Filter reports by specific employees
- **Shift Integration**: Combine attendance shifts with time entries
- **Export Capabilities**: CSV and PDF export options
- **Detailed Breakdown**: View time entries by shift and sales order

**Key Functionality:**
- **Date Range Selection**: Choose report period
- **Profile Filtering**: Filter by specific employees
- **Shift Summary**: Total hours and idle time per profile
- **Entry Details**: Detailed time entry breakdown
- **Export Options**: Multiple export formats
- **Entry Editing**: Modify time entries from reports

**Report Types:**
- **Shift-based Reports**: Grouped by attendance shifts
- **Sales Order Reports**: Filtered by specific sales orders
- **Profile Reports**: Filtered by specific employees
- **Unscheduled Entries**: Time entries not within shifts

**Data Display:**
- Profile Name, Sales Order, Date, Clock In/Out, Duration
- Shift summaries with total hours and idle time
- Action buttons for editing entries

**Connections:**
- Integrates with Attendance and Time Tracking
- Used for labour cost analysis
- Exports to QuickBooks for billing
- Connected to sales order profitability

---

## System Management

### Backup Management Page (`/backup-management`)
**Purpose:** Create, manage, and restore system backups

**Features:**
- **Backup Creation**: Create complete system backups
- **Backup Management**: List, download, and delete backups
- **Restore Functionality**: Restore system from backups
- **Component Tracking**: Monitor backup components (database, uploads, config)
- **System Information**: Track system details for each backup

**Key Functionality:**
- **Backup Creation**: Generate complete system backups
- **Backup Listing**: View all available backups with details
- **Backup Download**: Download backup files locally
- **Backup Restoration**: Restore system from selected backup
- **Backup Deletion**: Remove old backup files
- **Component Validation**: Verify backup component availability

**Backup Components:**
- **Database**: Complete database backup
- **Uploads**: File uploads and assets
- **Config**: System configuration files

**Data Display:**
- Date & Time, Components, Size, System Info
- Action buttons for download, restore, and delete

**Safety Features:**
- **Restore Warnings**: Clear warnings about data overwrite
- **Component Validation**: Verify backup integrity
- **Confirmation Dialogs**: Require confirmation for destructive actions

**Connections:**
- Protects all system data
- Used for disaster recovery
- Integrated with system configuration

---

## Modal Dialogs & Detail Pages

This section documents the modal dialogs and detail pages that are not directly accessible through the main navigation bar but are crucial components of the application workflow.

### Modal Dialogs

#### Unified Part Dialog
**Purpose:** Add or edit parts (stock and supply items)

**Features:**
- **Part Type Selection**: Choose between 'stock' and 'supply' items
- **Dynamic Form Fields**: Quantity field hidden for supply items
- **Validation**: Comprehensive form validation with error messages
- **Auto-focus**: Automatically focuses on part number field
- **Duplicate Detection**: Prevents duplicate part numbers

**Form Fields:**
- **Part Number** (required, auto-uppercase, disabled in edit mode)
- **Part Type** (required, stock/supply selection)
- **Part Description** (required)
- **Unit** (required, dropdown: Each, cm, ft, ft^2, kg, pcs, L)
- **Last Unit Cost** (optional, numeric)
- **Quantity on Hand** (required for stock, auto-set to "NA" for supply)
- **Reorder Point** (optional, numeric)

**Key Functionality:**
- **Smart Part Type Handling**: Automatically sets quantity to "NA" for supply items
- **Form Validation**: Real-time validation with specific error messages
- **Duplicate Prevention**: Checks for existing part numbers
- **Auto-save Prevention**: Prevents closing during save operations
- **Business Profile Integration**: Auto-fills location data from business profile

**Usage Contexts:**
- Inventory Page: Add new stock parts
- Supply Page: Add new supply parts
- Purchase Order Detail: Add parts from line items
- Sales Order Detail: Add parts from line items

#### Unified Vendor Dialog
**Purpose:** Add or edit vendor information

**Features:**
- **Complete Vendor Information**: All vendor contact and address fields
- **Auto-fill Integration**: Auto-fills city, province, country from business profile
- **Form Validation**: Required field validation
- **Responsive Layout**: Grid-based responsive form design

**Form Fields:**
- **Vendor Name** (required)
- **Contact Person** (optional)
- **Email** (optional, email validation)
- **Telephone Number** (optional)
- **Street Address** (optional)
- **City** (optional, auto-filled from business profile)
- **Province/State** (optional, auto-filled from business profile)
- **Country** (optional, auto-filled from business profile)
- **Postal Code** (optional)
- **Website** (optional)

**Key Functionality:**
- **Business Profile Integration**: Auto-fills location data for new vendors
- **Form Reset**: Clears form when dialog opens/closes
- **Validation**: Basic required field validation
- **Responsive Design**: Adapts to different screen sizes

**Usage Contexts:**
- Vendor List Page: Add new vendors
- Purchase Order Detail: Add vendors from vendor selection

#### Unified Customer Dialog
**Purpose:** Add or edit customer information

**Features:**
- **Complete Customer Information**: All customer contact and address fields
- **Auto-fill Integration**: Auto-fills city, province, country from business profile
- **Form Validation**: Required field validation with error display
- **Responsive Layout**: Grid-based responsive form design

**Form Fields:**
- **Customer Name** (required)
- **Contact Person** (optional)
- **Email** (optional, email validation)
- **Phone Number** (optional)
- **Street Address** (optional)
- **City** (optional, auto-filled from business profile)
- **Province/State** (optional, auto-filled from business profile)
- **Country** (optional, auto-filled from business profile)
- **Postal Code** (optional)
- **Website** (optional)

**Key Functionality:**
- **Business Profile Integration**: Auto-fills location data for new customers
- **Form Validation**: Required field validation with error messages
- **Form Reset**: Clears form when dialog opens/closes
- **Responsive Design**: Adapts to different screen sizes

**Usage Contexts:**
- Customer List Page: Add new customers
- Sales Order Detail: Add customers from customer selection
- Quotes Page: Add customers from customer selection

#### Unified Product Dialog
**Purpose:** Add or edit product definitions

**Features:**
- **Simple Product Management**: Focused on product name and description
- **Form Validation**: Required field validation
- **Auto-focus**: Automatically focuses on product name field
- **Minimal Interface**: Streamlined for quick product creation

**Form Fields:**
- **Product Name** (required)

**Key Functionality:**
- **Simple Validation**: Only product name is required
- **Auto-focus**: Automatically focuses on product name field
- **Form Reset**: Clears form when dialog opens/closes
- **Error Display**: Shows validation errors clearly

**Usage Contexts:**
- Products Page: Add new products
- Quotes Page: Add products from product selection
- Sales Order Detail: Add products from product selection

#### Allocation Modal
**Purpose:** Allocate parts from purchase orders to sales orders

**Features:**
- **Smart Allocation**: Suggests optimal allocation based on sales order needs
- **FIFO Allocation**: First-in-first-out allocation algorithm
- **Supply Part Filtering**: Automatically filters out supply parts
- **Real-time Validation**: Validates allocations against ordered quantities
- **Expandable Details**: Collapsible sales order breakdown
- **Auto-allocation**: Automatic allocation with manual override capability

**Key Functionality:**
- **Allocation Suggestions**: System suggests optimal allocations
- **FIFO Algorithm**: Prioritizes older sales orders
- **Supply Part Handling**: Excludes supply parts from allocation
- **Quantity Validation**: Ensures allocations don't exceed ordered quantities
- **Surplus Management**: Tracks surplus quantities for stock
- **Manual Override**: Allows manual adjustment of suggested allocations

**Allocation Process:**
1. **Load Suggestions**: Fetches allocation suggestions from backend
2. **Filter Supply Parts**: Removes supply parts from allocation
3. **Calculate Needs**: Determines total quantity needed across sales orders
4. **FIFO Allocation**: Allocates based on sales order age
5. **Surplus Distribution**: Distributes remaining quantities
6. **Validation**: Ensures allocations are valid
7. **Save/Close**: Saves allocations and optionally closes purchase order

**Data Display:**
- **Purchase Order Summary**: Overview of all parts in the order
- **Part Details**: Individual part allocation with expandable sales orders
- **Allocation Fields**: Manual input fields for allocation quantities
- **Status Indicators**: Visual indicators for needed vs. optional allocations
- **Surplus Tracking**: Automatic surplus calculation

**Usage Contexts:**
- Open Purchase Order Detail: Allocate parts when closing purchase orders
- Purchase Order Management: Manage part allocations for inventory tracking

### Detail Pages (Read-Only)

#### Purchase Order Detail Page (`/purchase-orders/:id`)
**Purpose:** View closed purchase order details (read-only)

**Features:**
- **Complete Order Information**: Full purchase order details
- **Line Item Display**: All purchase order line items
- **PDF Generation**: Download purchase order as PDF
- **QuickBooks Integration**: Export to QuickBooks Online
- **Reopen Functionality**: Reopen closed purchase orders (admin only)

**Key Functionality:**
- **Order Display**: Shows complete purchase order information
- **PDF Export**: Generate professional PDF documents
- **QBO Export**: Export to QuickBooks as bills
- **Order Management**: Reopen orders for editing
- **Print Functionality**: Print purchase order details

**Data Display:**
- Purchase Order Number, Vendor, Bill Number
- Creation Date, Status, QBO Export Status
- Complete line item breakdown
- Totals (Subtotal, GST, Total Amount)

**Connections:**
- Links back to Purchase Orders list
- Integrates with QuickBooks Online
- Used for order documentation and archiving

#### Sales Order Detail Page (`/sales-orders/:id`)
**Purpose:** View closed sales order details (read-only)

**Features:**
- **Complete Order Information**: Full sales order details
- **Line Item Display**: All sales order line items
- **PDF Generation**: Download sales order as PDF
- **QuickBooks Integration**: Export to QuickBooks Online
- **Reopen Functionality**: Reopen closed sales orders (admin only)

**Key Functionality:**
- **Order Display**: Shows complete sales order information
- **PDF Export**: Generate professional PDF documents
- **QBO Export**: Export to QuickBooks as invoices
- **Order Management**: Reopen orders for editing
- **Print Functionality**: Print sales order details

**Data Display:**
- Sales Order Number, Customer, Product
- Sales Date, Status, QBO Export Status
- Complete line item breakdown
- Totals (Subtotal, GST, Total Amount)

**Connections:**
- Links back to Sales Orders list
- Integrates with QuickBooks Online
- Used for order documentation and archiving

---

## Page Connections & Workflows

### Primary Workflows

#### 1. Sales Order Workflow
1. **Customer Management** (`/customers`) → Create/select customer
2. **Products** (`/products`) → Define products
3. **Stock/Supply** (`/inventory`, `/supply`) → Manage inventory items
4. **Quotes** (`/quotes`) → Create customer quote
5. **Sales Orders** (`/open-sales-orders`) → Convert quote to sales order
6. **Parts to Order** (`/parts-to-order`) → Track parts needed
7. **Purchase Orders** (`/open-purchase-orders`) → Order required parts
8. **Time Tracking** (`/time-tracking`) → Track labour time
9. **Time Reports** (`/time-tracking/reports`) → Generate labour reports
10. **QuickBooks Export** → Export to QuickBooks Online

#### 2. Purchase Order Workflow
1. **Vendor Management** (`/vendors`) → Create/select vendor
2. **Stock/Supply** (`/inventory`, `/supply`) → Select parts to order
3. **Purchase Orders** (`/open-purchase-orders`) → Create purchase order
4. **Inventory Update** → Update stock levels
5. **QuickBooks Export** → Export to QuickBooks Online

#### 3. Time Tracking Workflow
1. **Employee Management** (`/employees`) → Create employee accounts
2. **Attendance** (`/attendance`) → Track attendance/shifts
3. **Time Tracking** (`/time-tracking`) → Track time on sales orders
4. **Time Reports** (`/time-tracking/reports`) → Generate reports
5. **Labour Cost Integration** → Calculate labour costs

#### 4. Financial Integration Workflow
1. **Business Profile** (`/business-profile`) → Set up company information
2. **QBO Connection** → Connect to QuickBooks Online
3. **Account Mapping** (`/qbo-account-mapping`) → Configure account mappings
4. **Margin Schedule** (`/margin-schedule`) → Set pricing margins
5. **Overhead Management** (`/overhead-management`) → Configure overhead distribution
6. **Export Operations** → Export transactions to QuickBooks

### Cross-Module Connections

#### Data Dependencies
- **Customers** → Used by Quotes, Sales Orders
- **Vendors** → Used by Purchase Orders
- **Products** → Referenced by Quotes, Sales Orders
- **Inventory Items** → Used by Sales Orders, Purchase Orders, Parts to Order
- **Employees** → Used by Time Tracking, Attendance
- **Sales Orders** → Used by Time Tracking, Parts to Order

#### Integration Points
- **QuickBooks Online**: Business Profile → Account Mapping → Export Operations
- **Inventory System**: Stock/Supply → Sales Orders → Parts to Order → Purchase Orders
- **Time Tracking**: Employees → Attendance → Time Tracking → Reports
- **Pricing System**: Margin Schedule → Sales Orders → Quotes

#### Role-Based Access Patterns
- **Admin**: Full access to all modules
- **Sales and Purchase**: Focus on customer, vendor, inventory, and order management
- **Time Tracking**: Limited to attendance and time tracking functions
- **Quotes**: Restricted to quote creation and management

### Navigation Patterns

#### Primary Navigation
- **Dashboard** → Module overview and quick access
- **Sidebar Navigation** → Direct access to all modules
- **Breadcrumb Navigation** → Context-aware navigation

#### Detail Page Navigation
- **List Pages** → Click rows to access detail pages
- **Detail Pages** → Back buttons to return to lists
- **Modal Dialogs** → In-place editing for simple operations

#### Workflow Navigation
- **Sequential Workflows** → Guided navigation through processes
- **Cross-Reference Links** → Direct links between related data
- **Export/Import** → File-based data exchange

This comprehensive documentation covers all pages accessible via the navigation bar, their functionality, features, and interconnections, as well as all modal dialogs and detail pages that are crucial to the application workflow. The application provides a complete business management solution with integrated modules for sales, purchasing, inventory, time tracking, and financial operations. 

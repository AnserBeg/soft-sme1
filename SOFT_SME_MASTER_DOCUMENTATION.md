# SOFT SME Complete Application Documentation

## Overview

The SOFT SME (Small and Medium Enterprise) application is a comprehensive business management system designed for small to medium-sized businesses. The application provides integrated modules for customer management, inventory control, sales and purchase order processing, time tracking, and accounting integration.

## System Architecture

### Core Modules
1. **Customer Management** - Centralized customer database used across all modules
2. **Inventory Management** - Stock and supply item tracking with allocation system
3. **Quote System** - Customer quote creation and management
4. **Sales Order System** - Sales order processing with parts-to-order functionality
5. **Purchase Order System** - Vendor management and purchase order processing
6. **Time Tracking System** - Employee time tracking with automatic sales order integration
7. **Settings System** - Business profile, QuickBooks integration, global variables, backup management

### Technology Stack
- **Frontend**: React with TypeScript, Material-UI components
- **Backend**: Node.js with Express, TypeScript
- **Database**: PostgreSQL with comprehensive schema
- **Integration**: QuickBooks Online API integration
- **Deployment**: Docker containers with nginx reverse proxy

## Detailed System Documentation

### 1. Purchase Order System
**File**: `PURCHASE_ORDER_SYSTEM_GUIDE.md`
**Key Features**:
- Vendor management with auto-fill from business profile
- Inventory integration (stock vs supply items)
- Purchase order creation with line items
- Allocation system for inventory to sales orders
- QuickBooks Online export functionality
- PDF generation and CSV export

**Business Logic**:
- Stock items can be allocated to sales orders
- Supply items are consumables not tracked by quantity
- Purchase orders can be closed after allocation
- Integration with inventory management system

### 2. Quote System
**File**: `QUOTE_SYSTEM_GUIDE.md`
**Key Features**:
- Customer management with inline creation
- Product management with simple creation
- Quote number generation (QO-YYYY-NNNNN format)
- Quote status management (Draft/Closed)
- PDF generation for customer communication
- Sales order conversion workflow

**Business Logic**:
- Quotes start as "Draft" status
- Can be converted to sales orders when approved
- Customer and product data shared across modules
- Professional PDF generation for customer communication

### 3. Sales Order System
**File**: `SALES_ORDER_SYSTEM_GUIDE.md`
**Key Features**:
- Customer management integration
- Product management integration
- Line items for customer-facing items
- Parts-to-order system for internal procurement
- Strict validation rules preventing closure with pending orders
- QuickBooks Online export (when no parts to order)

**Business Logic**:
- Cannot close sales order if parts to order > 0
- Cannot export to QBO if parts to order > 0
- Line items are customer-facing, parts-to-order are internal
- Integration with time tracking for labour/overhead costs

### 4. Time Tracking System
**File**: `TIME_TRACKING_SYSTEM_GUIDE.md`
**Key Features**:
- Employee profile management
- Clock in/out functionality with real-time duration
- Automatic sales order integration
- Global labour and overhead rate management
- Automatic LABOUR and OVERHEAD line item creation
- Sales order rate override capability

**Business Logic**:
- One active time entry per sales order per profile
- Real-time duration updates for active entries
- Automatic creation of LABOUR and OVERHEAD line items on clock out
- Rate priority: Sales order rate > Global rate > 0
- Integration with sales orders for cost tracking

### 5. Settings System
**File**: `SETTINGS_SYSTEM_GUIDE.md`
**Key Features**:
- Business profile management (logo, contact info, address)
- QuickBooks Online OAuth2 integration
- Global variable management (labour rate, overhead rate)
- Comprehensive backup system (database, uploads, config)
- Session management and device tracking
- Account mapping for QBO integration

**Business Logic**:
- Business profile data used across all documents
- QBO integration enables accounting export
- Global rates affect time tracking calculations
- Backup system ensures data protection
- Session management controls user access

## System Integration Points

### Customer Data Integration
- **Shared Database**: All modules use the same `customermaster` table
- **Auto-fill**: Business profile data pre-fills customer creation forms
- **Consistent Information**: Customer data is consistent across quotes, sales orders, and purchase orders

### Inventory Integration
- **Stock vs Supply**: System differentiates between trackable stock items and consumable supply items
- **Allocation System**: Purchase order items can be allocated to sales orders
- **Validation**: All parts used in sales orders must exist in inventory
- **Auto-pricing**: Unit prices auto-filled from inventory when available

### Time Tracking Integration
- **Sales Order Integration**: Time entries automatically create LABOUR and OVERHEAD line items
- **Rate Management**: Global rates and sales order-specific rates
- **Cost Calculation**: Labour and overhead costs automatically calculated and added to sales orders

### QuickBooks Integration
- **OAuth2 Authentication**: Secure connection to QuickBooks Online
- **Account Mapping**: Configurable mapping of SOFT SME accounts to QBO accounts
- **Export Workflow**: Sales orders and purchase orders can be exported to QBO
- **Data Synchronization**: Customer and item data synced between systems

### Document Generation
- **Business Profile**: Logo and contact information used in all PDFs
- **Professional Formatting**: Consistent document formatting across all modules
- **Auto-download**: PDFs automatically download after generation

## Database Architecture

### Core Tables
- **customermaster**: Customer information shared across all modules
- **vendormaster**: Vendor information for purchase orders
- **inventory**: Stock and supply items with allocation tracking
- **products**: Product information for quotes and sales orders
- **productmaster**: Additional product information with cost tracking

### Transaction Tables
- **quotes**: Quote information with customer references
- **salesorderhistory**: Sales order headers with customer references
- **salesorderlineitems**: Sales order line items with inventory references
- **sales_order_parts_to_order**: Internal parts needed for sales orders
- **purchasehistory**: Purchase order headers with vendor references
- **purchaselineitems**: Purchase order line items with inventory references
- **saleshistory**: Legacy sales history table
- **saleslineitems**: Legacy sales line items table

### Time Tracking Tables
- **profiles**: Employee profiles for time tracking
- **time_entries**: Time tracking entries with sales order references
- **attendance_shifts**: Employee shift tracking
- **user_profile_access**: User access control for profiles
- **user_sessions**: Session management for authentication

### Settings Tables
- **business_profile**: Company information and logo
- **global_settings**: System-wide configuration variables (key-value pairs)
- **qbo_connection**: QuickBooks OAuth tokens and connection info
- **qbo_account_mapping**: Account mapping for QBO integration
- **companies**: Multi-company support with session management
- **users**: User authentication and company association

### Inventory Management Tables
- **inventory_audit_log**: Audit trail for inventory changes
- **labourrate**: Labour rate configuration
- **marginschedule**: Product margin configuration
- **overhead_expense_distribution**: Overhead expense allocation

### Aggregation Tables
- **aggregated_parts_to_order**: Consolidated parts needed across multiple sales orders
- **labour_line_items**: Labour cost line items for sales orders

## Business Workflows

### Quote to Sales Order Workflow
1. Create quote with customer and product information
2. Generate PDF and send to customer
3. Customer reviews and approves quote
4. Convert quote to sales order
5. Add line items and parts to order
6. Order parts from suppliers (purchase orders)
7. Track time spent on sales order
8. Close sales order when complete
9. Export to QuickBooks for accounting

### Purchase Order to Inventory Workflow
1. Create purchase order with vendor and line items
2. Receive items from vendor
3. Allocate received items to sales orders
4. Update inventory quantities
5. Close purchase order
6. Export to QuickBooks for accounting

### Time Tracking Workflow
1. Employee clocks in to specific sales order
2. System applies appropriate labour rate
3. Real-time duration tracking
4. Employee clocks out
5. System calculates final duration
6. Automatic creation of LABOUR and OVERHEAD line items
7. Integration with sales order totals

## Validation and Business Rules

### Sales Order Validation
- Cannot close if parts to order > 0
- Cannot export to QBO if parts to order > 0
- Line items must have valid part numbers and quantities > 0
- No duplicate part numbers in line items
- Parts must exist in inventory and be stock items (not supply)

### Purchase Order Validation
- Vendor must be selected
- At least one line item required
- Line items must have valid quantities and costs
- Bill numbers must be unique if provided

### Time Tracking Validation
- One active entry per sales order per profile
- Clock out time must be after clock in time
- Valid sales order and profile required

### Quote Validation
- Customer and product required
- Valid until date must be after quote date
- Estimated cost must be greater than 0

## Security and Access Control

### Authentication
- JWT-based authentication with refresh tokens
- Session management with device tracking
- Configurable session timeouts and limits
- Multi-device access control

### Data Protection
- Encrypted token storage
- Secure API communication
- Backup system with encryption
- Audit logging for changes

### Access Control
- Role-based access control
- Company-level data isolation
- Profile access management for time tracking
- Administrative session management

## Integration Features

### QuickBooks Online Integration
- OAuth2 authentication flow
- Automatic token refresh
- Customer and item synchronization
- Invoice and bill creation
- Account mapping for proper categorization

### Document Generation
- PDF generation for all major documents
- Professional formatting with business branding
- Auto-download functionality
- CSV export for data analysis

### Backup System
- Complete database backups
- File upload backups
- Configuration backups
- Automated backup scheduling
- Restore functionality with validation

## Troubleshooting and Support

### Common Issues
- **Validation Errors**: Detailed error messages guide users to fix issues
- **Integration Problems**: Clear status indicators for QBO export
- **Data Consistency**: Referential integrity maintained across all modules
- **Performance**: Optimized database queries and indexing

### Error Handling
- Client-side validation with immediate feedback
- Server-side validation with detailed error messages
- Toast notifications for user feedback
- Loading states for all operations
- Confirmation dialogs for destructive actions

## Best Practices

### Data Management
- Regular database backups
- Consistent naming conventions
- Proper validation before saving
- Audit trail maintenance

### User Training
- Start with business profile setup
- Configure global settings for rates
- Set up QuickBooks integration
- Train on workflow processes

### System Maintenance
- Regular backup verification
- Monitor session management
- Update global rates as needed
- Review and clean up old data

## Conclusion

The SOFT SME application provides a comprehensive business management solution with integrated modules that work together seamlessly. The system enforces proper business rules while providing flexibility for different business processes. The documentation in the individual system guides provides detailed information about each module's functionality, while this master documentation provides the overall context and integration points.

For detailed information about specific systems, refer to the individual documentation files:
- `PURCHASE_ORDER_SYSTEM_GUIDE.md`
- `QUOTE_SYSTEM_GUIDE.md`
- `SALES_ORDER_SYSTEM_GUIDE.md`
- `TIME_TRACKING_SYSTEM_GUIDE.md`
- `SETTINGS_SYSTEM_GUIDE.md`

Each guide contains comprehensive information about the specific system's functionality, business logic, database structure, API endpoints, and troubleshooting procedures. 
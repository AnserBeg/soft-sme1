# NeuraTask Database Structure Documentation

## Overview
The NeuraTask database contains **30 actual tables** with comprehensive business management functionality. The database supports multi-company operations, inventory management, sales/purchase tracking, time tracking, and QuickBooks Online integration.

## Core Business Tables

### Customer Management
- **customermaster** (3 records)
  - Customer information: name, contact, address, phone, email
  - Key fields: customer_id, customer_name, contact_person, telephone_number, email
  - Location: street_address, city, province, country, postal_code

### Vendor Management  
- **vendormaster** (16 records)
  - Vendor information: name, contact, address, phone, email
  - Key fields: vendor_id, vendor_name, contact_person, telephone_number, email
  - Location: street_address, city, province, country, postal_code

### Product Management
- **products** (5 records)
  - Product definitions: name, description
  - Key fields: product_id, product_name, product_description
  - Timestamps: created_at, updated_at

- **productmaster** (0 records)
  - Extended product information with inventory tracking
  - Key fields: product_id, product_name, product_description, unit, last_unit_cost, quantity_on_hand, reorder_point

### Inventory Management
- **inventory** (30 records)
  - Stock and supply items with quantities and costs
  - Key fields: part_number, part_description, unit, last_unit_cost, quantity_on_hand, reorder_point
  - Part types: 'stock' or 'supply'
  - Timestamps: created_at, updated_at

- **inventory_audit_log** (71 records)
  - Tracks inventory changes with reasons
  - Key fields: part_id, delta, new_on_hand, reason, sales_order_id, user_id
  - Timestamps: created_at

### Sales Management
- **salesorderhistory** (10 records)
  - Main sales orders with customer and financial data
  - Key fields: sales_order_id, sales_order_number, customer_id, sales_date, product_name, subtotal, total_amount, status
  - QuickBooks integration: exported_to_qbo, qbo_invoice_id, qbo_export_status
  - Timestamps: created_at, updated_at

- **salesorderlineitems** (18 records)
  - Individual line items in sales orders
  - Key fields: sales_order_id, part_number, part_description, quantity_sold, unit_price, line_amount
  - Inventory tracking: quantity_committed, quantity_to_order
  - Timestamps: created_at, updated_at

- **quotes** (2 records)
  - Customer quotes with validity periods
  - Key fields: quote_id, quote_number, customer_id, quote_date, valid_until, product_name, estimated_cost, status
  - Sequence tracking: sequence_number
  - Terms: terms field for quote conditions

### Purchase Management
- **purchasehistory** (13 records)
  - Main purchase orders with vendor and financial data
  - Key fields: purchase_id, purchase_number, vendor_id, purchase_date, bill_number, subtotal, total_amount, status
  - GST handling: total_gst_amount, gst_rate
  - QuickBooks integration: exported_to_qbo, qbo_bill_id, qbo_export_status
  - Timestamps: created_at, updated_at

- **purchaselineitems** (27 records)
  - Individual line items in purchase orders
  - Key fields: purchase_id, part_number, part_description, quantity, unit_cost, line_total
  - GST handling: gst_amount
  - Timestamps: created_at, updated_at

### Parts to Order Management
- **aggregated_parts_to_order** (0 records)
  - Aggregated view of parts needed across multiple orders
  - Key fields: part_number, part_description, total_quantity_needed, unit_price, total_line_amount, min_required_quantity

- **sales_order_parts_to_order** (1 record)
  - Parts needed for specific sales orders
  - Key fields: sales_order_id, part_number, quantity_needed, unit_price, line_amount

- **salesorder_parts_to_order** (1 record)
  - Alternative parts to order table
  - Similar structure to sales_order_parts_to_order

### Financial Management
- **marginschedule** (1 record)
  - Margin calculation rules based on cost ranges
  - Key fields: product_id, cost_lower_bound, cost_upper_bound, margin_factor
  - Timestamps: created_at, updated_at

- **labourrate** (0 records)
  - Labour rate configuration
  - Key fields: rate
  - Timestamps: updated_at

- **labour_line_items** (0 records)
  - Labour charges on sales orders
  - Key fields: sales_order_id, date, title, units, quantity, unit_price, total
  - Timestamps: created_at, updated_at

- **overhead_expense_distribution** (3 records)
  - Overhead expense allocation rules
  - Key fields: company_id, expense_account_id, percentage, description, is_active
  - Timestamps: created_at, updated_at

### Time Tracking & Attendance
- **time_entries** (5 records)
  - Time tracking for employees on sales orders
  - Key fields: profile_id, sales_order_id, clock_in, clock_out, duration, unit_price
  - Timestamps: created_at, updated_at

- **attendance_shifts** (3 records)
  - Employee attendance tracking
  - Key fields: profile_id, clock_in, clock_out, created_by
  - Timestamps: updated_at

### Business Configuration
- **business_profile** (1 record)
  - Company business information
  - Key fields: business_name, street_address, city, province, country, telephone_number, email, business_number
  - Logo: logo_url
  - Timestamps: created_at, updated_at

- **companies** (4 records)
  - Multi-company support configuration
  - Key fields: company_name, max_concurrent_sessions, session_timeout_hours, refresh_token_days, allow_multiple_devices
  - Timestamps: created_at, updated_at

- **global_settings** (2 records)
  - Application-wide settings
  - Key fields: key, value (key-value pairs)
  - Example: labour_rate = 120.00

### QuickBooks Online Integration
- **qbo_connection** (2 records)
  - QuickBooks OAuth connection details
  - Key fields: company_id, realm_id, access_token, refresh_token, expires_at
  - Timestamps: created_at, updated_at

- **qbo_account_mapping** (1 record)
  - Mapping between NeuraTask and QuickBooks accounts
  - Key fields: company_id, qbo_inventory_account_id, qbo_gst_account_id, qbo_ap_account_id, qbo_ar_account_id
  - Additional mappings for sales, labour, COGS, and expense accounts

### User Management
- **profiles** (1 record)
  - User profile information
  - Key fields: name, email
  - Timestamps: created_at, updated_at

- **user_sessions** (102 records)
  - User session management with device tracking
  - Key fields: user_id, session_token, refresh_token, device_info, ip_address, user_agent
  - Security: expires_at, refresh_expires_at, is_active
  - Timestamps: created_at, last_used_at, updated_at

### System Tables
- **migrations** (50 records)
  - Database migration tracking
  - Key fields: name, executed_at
  - Tracks which migration scripts have been run

## Data Summary
- **3 customers** in the system
- **16 vendors** available
- **5 products** defined
- **30 inventory items** (stock and supply)
- **10 sales orders** with 18 line items
- **13 purchase orders** with 27 line items
- **2 quotes** created
- **5 time entries** tracked
- **3 attendance shifts** recorded
- **102 user sessions** managed

## Key Relationships
1. **Sales Orders** → **Customers** (via customer_id)
2. **Sales Orders** → **Sales Order Line Items** (via sales_order_id)
3. **Purchase Orders** → **Vendors** (via vendor_id)
4. **Purchase Orders** → **Purchase Line Items** (via purchase_id)
5. **Time Entries** → **Profiles** (via profile_id)
6. **Time Entries** → **Sales Orders** (via sales_order_id)
7. **Inventory Audit Log** → **Sales Orders** (via sales_order_id)

## Business Workflow
1. **Customer Management**: Add customers in customermaster
2. **Vendor Management**: Add vendors in vendormaster
3. **Product Setup**: Define products in products table
4. **Inventory Management**: Track stock/supply in inventory table
5. **Sales Process**: Create quotes → Convert to sales orders → Track line items
6. **Purchase Process**: Create purchase orders → Track line items → Update inventory
7. **Time Tracking**: Record time entries for labour billing
8. **Financial Integration**: Export to QuickBooks Online

## Security & Access
- **user_sessions** table manages authentication and session security
- **companies** table supports multi-tenant architecture
- **global_settings** provides application configuration
- All tables include created_at/updated_at timestamps for audit trails 
# Data Models and Cross-Module Workflows

Summaries of the canonical tables, records, and end-to-end processes that power Soft SME. Use these to answer schema and workflow questions without cross-referencing multiple files.

## Core Tables

| Domain | Key Tables | Primary References |
| --- | --- | --- |
| Customers | `customers`, `customer_contacts`, `customer_addresses` | `SOFT_SME_DATABASE_STRUCTURE.md`, `CUSTOMER_CREATION_ERROR_FIX_SUMMARY.md` |
| Inventory | `inventory_items`, `inventory_adjustments`, `inventory_counts` | `SOFT_SME_DATABASE_SCHEMA_GUIDE.md`, `CSV_UPLOAD_SYSTEM.md` |
| Vendors | `vendors`, `vendor_contacts`, `vendor_catalog` | `SOFT_SME_DATABASE_STRUCTURE.md`, `PURCHASE_ORDER_SYSTEM_GUIDE.md` |
| Purchasing | `purchase_orders`, `po_lines`, `receipts` | `PURCHASE_ORDER_CALCULATION_UPDATE_SUMMARY.md` |
| Sales | `quotes`, `sales_orders`, `so_lines`, `fulfillment_events` | `SALES_ORDER_SYSTEM_GUIDE.md`, `QUOTE_SYSTEM_GUIDE.md` |
| Time Tracking | `time_entries`, `shift_templates`, `approvals` | `TIME_TRACKING_SYSTEM_GUIDE.md` |
| Settings | `users`, `roles`, `permissions`, `feature_flags` | `SETTINGS_SYSTEM_GUIDE.md`, `USER_EMAIL_SYSTEM_IMPLEMENTATION.md` |

## Derived & Aggregation Tables

- **Inventory Forecasts:** Aggregated demand vs. supply metrics for parts-to-order workflows.
- **Revenue Dashboards:** `sales_summary_daily`, `sales_summary_monthly` used for BI exports.
- **Labor Utilization:** `time_summary_weekly`, `overtime_alerts` powering compliance dashboards.

## Cross-Module Workflows

### Quote → Sales Order → Purchase Order → QBO Sync
1. Draft quote (pricing matrix, approval workflow).
2. Convert to sales order (reserve inventory, schedule fulfillment).
3. Generate purchase orders for shortages (parts-to-order logic).
4. Sync invoices and bills to QuickBooks Online (QBO integration module).

**Key Checks:** Inventory availability, vendor lead times, accounting sync health.

### Inventory Imports & Adjustments
1. Prepare CSV using `CSV_UPLOAD_SYSTEM.md` template.
2. Upload through inventory module; validation middleware enforces schema.
3. Processed entries create adjustments, update counts, and trigger audit logs.

**Key Checks:** Duplicate detection, adjustment approval, reconciliation reports.

### Time Tracking Lifecycle
1. Employee clocks in via mobile or desktop (`MOBILE_USER_ACCESS_SYSTEM.md`).
2. Shift data persists to `time_entries`, triggers real-time alerts.
3. Supervisors approve shifts; exports feed payroll integrations.

**Key Checks:** Geofence enforcement, overtime flags, export confirmation.

## Reporting & Analytics

- Dashboard definitions live in `SOFT_SME_MASTER_DOCUMENTATION.md` (Reporting chapter).
- Scheduled exports use scripts in `scripts/` and backend jobs (`soft-sme-backend/src/jobs/`).

## Data Governance

- Follow retention and archival policies outlined in `DATABASE_OPTIMIZATION_GUIDE.md` and deployment checklists.
- Sensitive data (PII, financials) must comply with masking rules in ETL pipelines before ingestion into vector stores.

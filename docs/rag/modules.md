# Module Deep Dives

Each module is normalized into consistent chunks so embeddings can capture the essentials. Follow the Summary → Key Validations → Troubleshooting → FAQs format when extending the documentation.

## Inventory Management

- **Summary:** Core behaviors and flows live in `SOFT_SME_COMPLETE_DOCUMENTATION.md` (Inventory) and `SOFT_SME_MASTER_DOCUMENTATION.md`.
- **Key Validations:** Stock adjustment accuracy, supplier linkage, and CSV import checks (`CSV_UPLOAD_SYSTEM.md`).
- **Troubleshooting:** Reference `PRODUCT_CREATION_ERROR_FIX_SUMMARY.md` and `DATABASE_OPTIMIZATION_GUIDE.md` for common inconsistencies.
- **FAQs:** How to sync with QuickBooks, audit adjustments, and manage offline edits.

## Vendor Mapping & Purchasing

- **Summary:** `PURCHASE_ORDER_SYSTEM_GUIDE.md`, `PURCHASE_ORDER_CALCULATION_UPDATE_SUMMARY.md`, and `SOFT_SME_COMPLETE_DOCUMENTATION.md` (Purchasing).
- **Key Validations:** Ensure vendor defaults, lead times, and currency conversions are enforced.
- **Troubleshooting:** Utilize `PURCHASE_ORDER_CALCULATION_UPDATE_SUMMARY.md` and `PURCHASE_ORDER_SYSTEM_GUIDE.md` remediation notes.
- **FAQs:** Vendor onboarding, recalculating POs, and syncing to QBO.

## Sales Orders & Quotes

- **Summary:** `SALES_ORDER_SYSTEM_GUIDE.md`, `SALES_ORDER_CALCULATION_UPDATE_SUMMARY.md`, `QUOTE_SYSTEM_GUIDE.md`.
- **Key Validations:** Pricing tiers, tax calculations, fulfillment status transitions.
- **Troubleshooting:** See `SALES_ORDER_CREATION_ERROR_FIX_SUMMARY.md` and `QUOTE_SYSTEM_GUIDE.md` appendix.
- **FAQs:** Converting quotes to sales orders, adjusting partial shipments, managing approvals.

## Parts-to-Order & Aggregations

- **Summary:** Pull from aggregation notes in `SOFT_SME_MASTER_DOCUMENTATION.md` and `PURCHASE_ORDER_SYSTEM_GUIDE.md`.
- **Key Validations:** Cross-module sync between inventory needs and supplier commitments.
- **Troubleshooting:** Investigate using `DATABASE_OPTIMIZATION_GUIDE.md` for reconciliation routines.
- **FAQs:** When to trigger replenishment, handling negative stock, and batch processing.

## Time Tracking

- **Summary:** `TIME_TRACKING_SYSTEM_GUIDE.md` and sections in the master docs.
- **Key Validations:** Shift boundaries, overtime rules, user role access.
- **Troubleshooting:** `TIME_TRACKING_SYSTEM_GUIDE.md` troubleshooting appendix plus `MOBILE_USER_ACCESS_SYSTEM.md` for mobile sync issues.
- **FAQs:** Editing punches, exporting to payroll, resolving sync conflicts.

## Admin & Settings

- **Summary:** `SETTINGS_SYSTEM_GUIDE.md`, `USER_EMAIL_SYSTEM_IMPLEMENTATION.md`, and admin chapters within the master docs.
- **Key Validations:** Role-based access, notification templates, multi-tenant controls.
- **Troubleshooting:** Postmortems such as `CUSTOMER_CREATION_ERROR_FIX_SUMMARY.md` and `EMAIL_SETUP_GUIDE.md`.
- **FAQs:** Resetting credentials, managing feature flags, auditing user actions.

## Offline Handling

- **Summary:** See offline coverage in `SOFT_SME_NAVIGATION_BASED_DOCUMENTATION.md` and mobile rollouts (`DESKTOP_APP_SUMMARY.md`, `MOBILE_USER_ACCESS_SYSTEM.md`).
- **Key Validations:** Sync intervals, conflict resolution rules, storage quotas.
- **Troubleshooting:** Reference `DATABASE_OPTIMIZATION_GUIDE.md` and deployment scripts (`render-build.sh`, `build-desktop.sh`).
- **FAQs:** Clearing caches, recovering unsynced records, enabling offline bundles.

## Business Rules & Workflows

- **Summary:** `IMPLEMENTATION_SUMMARY.md`, `ENHANCED_ROW_SPECIFIC_GUIDE.md`, and cross-workflow chapters in master docs.
- **Key Validations:** Sequencing constraints, automation triggers, compliance checks.
- **Troubleshooting:** `SEQUENCE_SYNCHRONIZATION_PREVENTION_GUIDE.md` and related error-fix summaries.
- **FAQs:** Modifying validations, coordinating SO→PO flows, integrating with automations.

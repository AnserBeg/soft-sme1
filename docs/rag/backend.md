# Backend API and Service Catalog

This catalog mirrors the Express routers and service integrations so retrieval can answer endpoint-level questions accurately. Use it as a jumping-off point to the detailed backend source in `soft-sme-backend/` and the legacy documentation.

## Authentication & User Management

- **Endpoints:** `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/password`.
- **Scopes:** Credential validation, session rotation, MFA hooks.
- **References:** `SOFT_SME_MASTER_DOCUMENTATION.md` (Auth), `USER_EMAIL_SYSTEM_IMPLEMENTATION.md` (password flows).
- **Middleware:** Rate limiting, session verification, audit logging.

## Business Profile & Administration

- **Endpoints:** `/business-profile`, `/settings`, `/features`.
- **Scopes:** Company metadata, feature toggles, tenant provisioning.
- **References:** `SETTINGS_SYSTEM_GUIDE.md`, `IMPLEMENTATION_SUMMARY.md`.
- **Middleware:** Tenant resolver, permission matrix enforcement.

## Customers & Contacts

- **Endpoints:** `/customers`, `/contacts`, `/addresses`.
- **Scopes:** CRUD for customer master data, contact rollups, integration mapping.
- **References:** `CUSTOMER_CREATION_ERROR_FIX_SUMMARY.md`, `SOFT_SME_COMPLETE_DOCUMENTATION.md` (Customers).
- **Middleware:** Validation library, duplicate detection.

## Inventory & Catalog

- **Endpoints:** `/inventory/items`, `/inventory/adjustments`, `/inventory/import`.
- **Scopes:** Item lifecycle, stock adjustments, CSV ingestion.
- **References:** `CSV_UPLOAD_SYSTEM.md`, `DATABASE_OPTIMIZATION_GUIDE.md`.
- **Middleware:** Stock validation, import queue dispatcher.

## Vendors & Purchasing

- **Endpoints:** `/vendors`, `/purchase-orders`, `/receiving`.
- **Scopes:** Vendor records, purchase order orchestration, receiving reconciliations.
- **References:** `PURCHASE_ORDER_SYSTEM_GUIDE.md`, `PURCHASE_ORDER_CALCULATION_UPDATE_SUMMARY.md`.
- **Middleware:** Vendor authorization, currency normalization, fulfillment sync.

## Quotes & Sales Orders

- **Endpoints:** `/quotes`, `/sales-orders`, `/fulfillment`.
- **Scopes:** Quote authoring, SO lifecycle, fulfillment coordination.
- **References:** `QUOTE_SYSTEM_GUIDE.md`, `SALES_ORDER_SYSTEM_GUIDE.md`, `SALES_ORDER_CALCULATION_UPDATE_SUMMARY.md`.
- **Middleware:** Pricing engine, approval workflow, notification emitter.

## Time Tracking & Labor

- **Endpoints:** `/time-tracking/shifts`, `/time-tracking/approvals`, `/time-tracking/reports`.
- **Scopes:** Punch capture, supervisor approvals, export automation.
- **References:** `TIME_TRACKING_SYSTEM_GUIDE.md`, `MOBILE_USER_ACCESS_SYSTEM.md`.
- **Middleware:** Device attestation, geofence validation, payroll export queue.

## Integrations & External Services

- **QuickBooks Online (QBO):** `/integrations/qbo/*` (sync, health, tokens). Use `CLOUD_DEPLOYMENT_SUMMARY.md` and QBO notes in master docs.
- **Email:** `/communications/email` with references to `EMAIL_SETUP_GUIDE.md`.
- **AI & Voice:** `/ai/*`, `/voice/*` documented in `docs/ai-assistant/` (see `ai-automation.md`).
- **Tasks & Planner:** `/planner/*`, `/tasks/*` referencing `docs/ai-assistant/planner-schema-contract.md`.

## Shared Middleware & Utilities

- **Error Handling:** Express error boundary lives in `soft-sme-backend/src/app.ts`.
- **Auth Guards:** Role and session checks in `soft-sme-backend/src/middleware/authMiddleware.ts` and `soft-sme-backend/src/utils/sessionManager.ts`.
- **Request Validation:** Inline validation helpers within each route (see `soft-sme-backend/src/routes/*`).
- **Background Jobs:** Worker definitions under `soft-sme-backend/src/workers/` with supporting utilities in `soft-sme-backend/src/utils/`.

Ensure each endpoint summary links back to the owning router file when expanding this catalog for deeper API coverage.

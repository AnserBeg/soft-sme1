# Frontend Journeys and Shared Components

Organize UI documentation per route so the RAG system can retrieve targeted answers for operators and developers. Each route entry references the canonical guides and highlights reusable components, guardrails, and troubleshooting workflows.

## Navigation Principles

- Start from `SOFT_SME_NAVIGATION_BASED_DOCUMENTATION.md` for the canonical sitemap and menu structure.
- Overlay change management guidance from `IMPLEMENTATION_SUMMARY.md` and `DESKTOP_APP_SUMMARY.md`.

## Route-Level Summaries

### Inventory & Catalog
- **Primary Flows:** Item list, detail modals, bulk adjustments, CSV imports (`CSV_UPLOAD_SYSTEM.md`).
- **Shared Components:** Search/filter header, inventory table row component, supplier chips.
- **Guardrails:** Offline edits require sync confirmation; enforce validation before bulk apply.
- **Troubleshooting:** See `PRODUCT_CREATION_ERROR_FIX_SUMMARY.md` and deployment notes for caching issues.

### Purchase Orders & Vendor Management
- **Primary Flows:** PO creation, vendor assignment, receiving, and vendor analytics.
- **Shared Components:** Vendor selector, PO line editor, fulfillment timeline.
- **Guardrails:** Lock pricing after approval; require lead-time validation.
- **Troubleshooting:** Use `PURCHASE_ORDER_SYSTEM_GUIDE.md` and calculation update summaries.

### Quotes & Sales Orders
- **Primary Flows:** Quote drafting, conversion to SO, fulfillment tracking.
- **Shared Components:** Pricing matrix, approval banner, fulfillment status badges.
- **Guardrails:** Maintain tax profile sync and prevent duplicate conversions.
- **Troubleshooting:** Reference `QUOTE_SYSTEM_GUIDE.md` and `SALES_ORDER_CREATION_ERROR_FIX_SUMMARY.md`.

### Time Tracking & Labor
- **Primary Flows:** Clock-in/out, timesheet review, admin adjustments.
- **Shared Components:** Timeline view, shift exception banner, approval chips.
- **Guardrails:** Restrict edits to authorized roles; enforce overtime warnings.
- **Troubleshooting:** `TIME_TRACKING_SYSTEM_GUIDE.md` and mobile access references.

### Settings & Administration
- **Primary Flows:** Role management, notification templates, integrations.
- **Shared Components:** Tabbed settings layout, permission matrix component, integration cards.
- **Guardrails:** Require confirmation for destructive actions; audit log updates.
- **Troubleshooting:** See `SETTINGS_SYSTEM_GUIDE.md`, `USER_EMAIL_SYSTEM_IMPLEMENTATION.md`, and error fix notes.

## Shared UI Components

Document shared component contracts under `soft-sme-frontend/`:

- **Dialogs & Modals:** `soft-sme-frontend/src/components/` (e.g., `UnifiedProductDialog.tsx`, `AddVendorModal.tsx`) handle CRUD workflows.
- **Chat & Collaboration:** `soft-sme-frontend/src/components/planner/` and `soft-sme-frontend/src/components/tasks/` cover planner insights, task chat, and summaries.
- **Navigation & Shell:** `soft-sme-frontend/src/components/Layout.tsx` defines top-level chrome, breadcrumbs, and offline banners shared across routes.

## Testing & QA Hooks

- Pair each route with smoke/regression scripts in `soft-sme-frontend/scripts/`.
- Reference offline sync recipes in `DESKTOP_APP_SUMMARY.md` and mobile deployment guides.

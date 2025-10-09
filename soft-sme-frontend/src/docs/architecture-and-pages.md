# Aiven – Comprehensive System Documentation (AI-Agent Ready)

## Overview
- Frontend: React 18 + MUI 5 + React Router v6 + Dayjs. Electron packaging supported.
- Backend: Node + Express + PostgreSQL; SQL migrations in `soft-sme-backend/migrations`.
- Mobile: `clockwise-mobile` (React + Capacitor).
- This document is organized by navigation routes (pages), shared components, backend APIs, data schema highlights, business flows, invariants, and change recipes. Use per-section chunking when ingesting into a vector DB.

## Navigation Map (App Shell)
- Router: `soft-sme-frontend/src/App.tsx`
- Protected layout wraps most routes: `src/components/Layout.tsx`
- Key routes (under `/`):
  - `/` and `/dashboard`: LandingPage
  - `/business-profile`: BusinessProfilePage
  - `/qbo-account-mapping`: QBOAccountMappingPage
  - `/customers`, `/customers/:id`: Customer list and details
  - `/products`, `/products/:id`: Product list and details
  - `/inventory`: InventoryPage; `/supply`: SupplyPage
  - Purchase Orders: `/open-purchase-orders`, `/open-purchase-orders/:id`
  - Vendors: `/vendors`, `/vendors/:id`
  - Employees: `/employees`
  - Time: `/time-tracking`, `/attendance`, `/time-tracking/reports`
  - Sales Orders: `/open-sales-orders`, `/open-sales-orders/:id`, `/woker-sales-orders`, `/woker-sales-orders/:id`
  - Quotes: `/quotes`, `/quotes/new`, `/quotes/:id`
  - `/margin-schedule`, `/overhead-management`, `/parts-to-order`, `/backup-management`, `/mobile-user-access`, `/email-settings`, `/email-templates`

## Pages (by navigation)

### LandingPage (`src/pages/LandingPage.tsx`)
- Dashboard-style intro. No complex logic.

### BusinessProfilePage (`src/pages/BusinessProfilePage.tsx`)
- Displays/edit business profile fields; integrates with backend `/api/business-profile`.
- Critical for invoice/quote headers; changes propagate to PDF exports.

### QBOAccountMappingPage (`src/pages/QBOAccountMappingPage.tsx`)
- Configure QuickBooks account mapping. Data pushed to backend mapping tables.
- Respect account-type constraints when adding/updating mappings.

### CustomerListPage / CustomerDetailPage (`src/pages/CustomerListPage.tsx`, `src/pages/CustomerDetailPage.tsx`)
- List customers; drill into details. CRUD via `/api/customers`.
- Used by Quotes/Sales Orders for customer selection.

### ProductsPage / ProductDetailPage (`src/pages/ProductsPage.tsx`, `src/pages/ProductDetailPage.tsx`)
- Manage product catalog used for quotes and SOs (non-inventory product names/descriptions).

### InventoryPage (`src/pages/InventoryPage.tsx`)
- Shows inventory items.
- Clean function (preview-first):
  - Rules: remove spaces, uppercase, remove punctuation except `( ) /`, wrap bare fractions `d/d` including two-digit denominators; flag description-in-PN (3+ letters + fraction); flag decimals near digits.
  - Produces fixes/flags; clicking opens `UnifiedPartDialog` for manual edit.
- Vendor variations panel/drawer (planned minimal UI): shows vendor mappings from `inventory_vendors`.
- Backend: `/api/inventory` and vendor APIs (see Vendor section below).

### SupplyPage (`src/pages/SupplyPage.tsx`)
- Supply items management (special inventory type). Avoids oversell logic.

### Vendors: VendorListPage / VendorDetailPage (`src/pages/VendorListPage.tsx`, `src/pages/VendorDetailPage.tsx`)
- Manage vendors used by POs and vendor PN mappings.

### Purchase Orders – List (`src/pages/OpenPurchaseOrdersPage.tsx`)
- List and search open POs. Navigate to detail page.

### Purchase Orders – Detail (`src/pages/OpenPurchaseOrderDetailPage.tsx`)
- Purpose: create/edit POs.
- Key behaviors:
  - Vendor selection with autocomplete.
  - Duplicate bill number check (prompts to continue).
  - Line items with part selection; totals calculation via `utils/purchaseOrderCalculations.ts`.
  - Vendor-specific PN mapping: when vendor is selected, swap line PN to vendor’s preferred → most-used → canonical; on vendor change, update all mapped lines accordingly.
  - Save, PDF generation, close PO flows.
  - Unsaved-changes guard active.
- APIs: `/api/purchase-orders`, `/api/inventory`, vendor mapping APIs.

### Employees (`src/pages/EmployeeManagementPage.tsx`)
- Admin-only. Manage employees and access roles.

### Time Tracking (`src/pages/TimeTrackingPage.tsx`, `src/pages/AttendancePage.tsx`, `src/pages/TimeTrackingReportsPage.tsx`)
- Track attendance/shifts (also supported on mobile app). Reports show time aggregates.

### Sales Orders – List (`src/pages/OpenSalesOrdersPage.tsx`)
- List and search SOs (open/closed). Navigate to detail.

### Sales Orders – Detail (Sales and Purchase) (`src/pages/OpenSalesOrderDetailPage.tsx`)
- Create/edit SOs with full validation and totals.
- Availability banners: show negative availability per PN based on deltas vs original items in edit mode; can transfer to Parts to Order.
- Save: allows 0 quantity; Close SO prevents 0-qty for non-special lines and requires no outstanding parts to order.
- Disallows duplicate PNs as separate lines (forces edit existing line).
- Parts to Order section exists in edit mode only.
- Unsaved-changes guard active.
- APIs: `/api/sales-orders`, `/api/inventory`.

### Sales Orders – Worker Page (`src/pages/WokerSalesOrderPage.tsx`)
- Worker-focused editing with large Part Finder; simplified line layout.
- Negative availability: alerts push header/top area only; line items appear stationary.
- Parts to Order included; quantity auto-transfer from negative banners.
- Unsaved-changes guard active.
- APIs: `/api/sales-orders`, `/api/inventory`.

### Quotes – List & Editor (`src/pages/QuotePage.tsx`, `src/pages/QuoteEditorPage.tsx`)
- QuotePage: list and open editor.
- QuoteEditorPage: create/edit; PDF/email; “Convert to SO” (button present). Unsaved-changes guard active.
- APIs: `/api/quotes`, `/api/quotes/:id/pdf`.

### MarginSchedulePage (`src/pages/MarginSchedulePage.tsx`)
- Configure cost bands → margin factor. Used for pricing PN unit prices from last cost.

### OverheadManagementPage (`src/pages/OverheadManagementPage.tsx`)
- Define overhead expense distributions mapped to QBO expense accounts (for COGS journaling during export). UI enforces total percentage allocation (aim for 100%).

### PartsToOrderPage (`src/pages/PartsToOrderPage.tsx`)
- Aggregate view: items to order across SOs. Guides purchasing.

### BackupManagementPage (`src/pages/BackupManagementPage.tsx`)
- Admin-only. Triggers backup/restore jobs (scripts under backend root).

### MobileUserAccessPage (`src/pages/MobileUserAccessPage.tsx`)
- Control mobile user access rights and app linking.

### Email Settings and Templates (`src/pages/UserEmailSettingsPage.tsx`, `src/pages/EmailTemplatesPage.tsx`)
- Configure per-user email settings and templates for document sending.

## Shared Components

### PartFinderDialog (`src/components/PartFinderDialog.tsx`)
- Purpose: large click-first part selection.
- Features:
  - A–Z/0–9 prefix chips; dynamic description tokens; big, touch-friendly chips.
  - Search bar filters by PN/description; token weighting via usage, recency, favorites, and query match.
  - Dimensional parts: tokenization considers shapes/materials (from description) and dimensions (from PN such as `1X1X(1/16)`, `16GA`).
  - Persistence: localStorage for SO-specific recents/favorites; server endpoints ready for usage/favorites.
- Integration: used from worker page and can be wired elsewhere.

### UnifiedPartDialog (`src/components/UnifiedPartDialog.tsx`)
- Purpose: Add/Edit inventory part, including vendor PN mappings.
- Vendor section:
  - List vendor mappings; add/edit/delete; mark preferred; usage count visible.
  - Service calls in `src/services/inventoryService.ts`.

### UnsavedChangesGuard (`src/components/UnsavedChangesGuard.tsx`)
- Route-blocker modal + beforeunload, with actions: Cancel, Leave without saving, Save and leave.
- Integrated into 4 key editors: Worker SO, Open SO Detail, Quote Editor, PO Detail.

### Other dialogs
- UnifiedCustomerDialog, UnifiedProductDialog, EmailModal (used by respective pages).

## Backend Highlights

- Server: `soft-sme-backend/src/index.ts` mounts routes with `authMiddleware`.
- DB: `soft-sme-backend/src/db.ts` (PG). SQL migrations under `soft-sme-backend/migrations`.
- Vendor PN Mapping (`inventory_vendors`): `20250102_create_inventory_vendors.sql`.
- Inventory vendor routes: `src/routes/inventoryVendorRoutes.ts`
  - GET `/:partNumber/vendors`
  - POST `/:partNumber/vendors` (upsert)
  - PUT `/:partNumber/vendors/:id`
  - DELETE `/:partNumber/vendors/:id`
  - POST `/usage` (increment usage_count and last_used_at)

## Data Model (selected)
- `inventory`: canonical PN data; description, unit, quantity_on_hand, last_unit_cost, part_type.
- `inventory_vendors`: vendor mappings for PN; preferred flag; usage_count; indexes by `(part_number, vendor_id)` and usage.
- SO-related tables: header and line items; parts-to-order on edit.
- PO tables: header and line items (unit_cost, line_amount); duplicate bill number checks.
- Quotes: header (customer/product/terms) and PDF/email.

## Business Flows & Invariants
- Special PNs: `LABOUR`, `OVERHEAD`, `SUPPLY` have special handling:
  - SO Save allows qty 0 (except Close). Close requires non-zero for non-special lines and no outstanding parts-to-order.
  - SUPPLY auto-managed when LABOUR present and supply rate > 0.
- Availability: for SOs, per-PN availability considers deltas vs original items (edit mode). Negative banners can transfer to Parts to Order.
- Duplicate PNs: In Open SO Detail, duplicates are disallowed as separate lines.
- Vendor PN swap: preferred → most-used → canonical fallback. Reacts to vendor selection changes.
- Inventory cleaning: preview-first; wraps fractions; flags decimals and description-in-PN.
- Totals: always via utilities (`utils/*Calculations.ts`). Avoid duplicating logic.

## API Surface (selected)
- Inventory: GET/POST `/api/inventory`
- Vendors (mapping): routes in `inventoryVendorRoutes.ts`
- Sales Orders: GET/POST/PUT `/api/sales-orders`
- Purchase Orders: POST/PUT `/api/purchase-orders`, PDF endpoint
- Quotes: GET/POST/PUT `/api/quotes`, PDF endpoint

## Change Recipes
- Add SO line field: update backend routes/DTO; update page state and totals; reflect in validations; manage invariants.
- Tune cleaning rules: update `InventoryPage.tsx` normalization; ensure duplicate grouping aligns with “cleaned PN” logic.
- Enhance Part Finder weighting: adjust token scoring and usage persistence; bias by recency/favorites/query.
- Wire vendor usage on PO save/finalize: call `recordVendorUsage` per chosen vendor PN line.

## Testing/Validation Tips
- Verify negative availability banners and transfer flow across both SO pages.
- Check unsaved-changes dialog appears on navigation and refresh when edits exist.
- Validate vendor PN swapping on PO page when changing vendor.
- Confirm inventory cleaning wraps `1/16` correctly; hyphens removed when required by rules.

---

## Roles & Access Control (Routing Guards)
- Location: `src/App.tsx`
- Auth wrapper: `PrivateRoute` reads `useAuth()`.
- Role behavior:
  - Time Tracking: redirected to `/attendance` if opening `/` or `/dashboard`. Only allowed: `/time-tracking`, `/attendance`, `/open-sales-orders` (and its detail), `/woker-sales-orders` (detail).
  - Sales and Purchase: allowed only: `/`, `/open-sales-orders[/...]`, `/open-purchase-orders[/...]`, `/parts-to-order`.
  - Quotes: allowed only `/quotes` and `/quotes/:id`.
  - Admin (or other): unrestricted (see comments in code).
- Implications/Troubleshooting:
  - If a user cannot access a page from the side menu, confirm their `access_role` and route allowlist in `PrivateRoute`.
  - The left drawer menu adjusts via `Layout.tsx` using `useAuth().user`. For Sales and Purchase, only “Sales & Purchase” subset is shown.

## Layout & Navigation Drawer
- Location: `src/components/Layout.tsx`
- Drawer menu sections reflect role; uses `navigate(item.path)`.
- Back button calls `navigate(-1)`.
- Offline indicator: shows “Offline • Pending: N” when `(window as any).__backendUnavailableSince` is set; `pendingCount` polled via `services/offlineSync`.
- Troubleshooting:
  - If the drawer shows unexpected items, re-check `filteredMenuItems` logic and `user.access_role`.
  - If offline banner persists, backend might be unreachable; check network/API health; pending events are auto-synced when online.

## Offline Sync Layer
- Locations: `src/App.tsx`, `src/components/Layout.tsx`, `src/services/offlineSync`.
- App-level polling every 15s calls `getPendingCount()` and attempts `syncPending()` if backend is reachable.
- Manual trigger: `(window as any).__triggerSync()` defined in `App.tsx` for debugging.
- Troubleshooting:
  - If pending items never clear, inspect local storage/queue in `offlineSync`, and API failures. The global flag `__backendUnavailableSince` blocks sync attempts until cleared.

## Detailed Page Docs (extended)

### OpenSalesOrdersPage (`src/pages/OpenSalesOrdersPage.tsx`)
- Purpose: List SOs (open/closed/all), search, export CSV, create new (non-Time-Tracking users).
- Data fetching: `GET /api/sales-orders?status={open|closed|all}`.
- Sorting: by numeric sequence in `sales_order_number` (descending) with regex `\d+` extraction.
- Columns: number, customer, product name/description, subtotal/GST/total (backend-provided), status, QBO exported indicator.
- Actions:
  - Time Tracking role: only open orders shown; no delete/export actions.
  - Close/Reopen flow handled by fetching full SO and `PUT /api/sales-orders/:id` with updated status and current line items.
  - Export to QBO: `POST /api/sales-orders/:id/export-to-qbo`; success shows invoice ID; refreshes list.
- Navigation: row click opens `/woker-sales-orders/:id` for Time Tracking users; `/open-sales-orders/:id` otherwise.
- Troubleshooting & Pitfalls:
  - Error messages on close/reopen are surfaced from backend (`error`, `details`, or `message`). Inventory-related issues are highlighted if they contain keywords (insufficient/negative).
  - Work In Process total is computed from `subtotal` of current open orders; ensure backend returns numeric strings parsable by `parseFloat`.
  - Creating new SO uses `/open-sales-orders/new` handled by `OpenSalesOrderDetailPage` in creation mode (id === 'new').

### OpenSalesOrderDetailPage (`src/pages/OpenSalesOrderDetailPage.tsx`)
- Purpose: Create/edit SO in full mode (Sales & Purchase users).
- State highlights:
  - Header: customer/product/date/terms/PO/VIN/estimated cost.
  - Lines: single occurrence enforced for each PN (duplicates disallowed; prompts to edit existing line).
  - Parts to Order: edit mode only; aggregate quantities to order; prevents closing if quantities > 0.
  - Special lines: `LABOUR`, `OVERHEAD`, `SUPPLY` managed with special rules (supply rate computed from labour amount when globalSupplyRate > 0).
- Availability banners:
  - Edit mode computes availability using deltas: total of current lines vs original lines; shows warning if negative; transfer dialog moves excess to Parts to Order and reduces line quantity.
- Save vs Close:
  - Save allows 0 quantity lines. Close disallows 0 quantity for non-special lines and disallows closing while parts-to-order exist.
- Calculations: totals via `calculateSalesOrderTotals` from `utils/salesOrderCalculations.ts`.
- Unsaved Changes: `UnsavedChangesGuard` with a signature covering header fields, `lineItems`, `quantityToOrderItems`.
- Troubleshooting & Pitfalls:
  - Duplicate PN attempt: blocked at Autocomplete onChange; ensures data integrity; merge by editing existing line.
  - Availability not matching expectations: check case-insensitivity and original vs current delta computation.
  - SUPPLY line behavior: auto-added when LABOUR exists (and rate > 0) and removed when not; amount derived from labour subtotal * supply rate.
  - Import dialog: imports from another SO; filters out LABOUR; maps quantity appropriately (creation vs edit mode differences).
  - QBO export: available after close; errors show via `exportError`; user may need to create customer in QBO if missing (guided flow present).

### WokerSalesOrderPage (`src/pages/WokerSalesOrderPage.tsx`)
- Purpose: Worker-focused SO edits; larger inputs, Part Finder integration, simplified fields.
- Movement with banners: negative availability alerts render in normal flow above the line-items card but fixed scrolling makes the list appear stationary; uses `useLayoutEffect` and scrollBy on alert height delta.
- Lines:
  - Hidden fields: unit cost, line amount removed from UI.
  - “Find Part” button opens `PartFinderDialog` for click-first selection.
  - Remove button sizing/alignment adjusted; grid cols sized for consistency.
- Parts to Order: mirrors line item layout; remove unit cost/amount; same alignment tweaks; transfer from alerts supported.
- Validation on save: allows 0 quantity; prevents invalid/supply parts; ensures no oversell (only last line per PN is considered for oversell check in worker flow).
- Unsaved Changes: signature includes `{ lineItems, partsToOrder }`.
- Troubleshooting & Pitfalls:
  - If list moves with alerts: ensure transform is removed from list container; scrollBy effect active.
  - If duplicate PNs present, merge on save by grouping in payload builder (groups by lowercase PN) to backend.
  - If Part Finder not filtering: check token weights and localStorage keys scoped by SO id.

### OpenPurchaseOrdersPage (`src/pages/OpenPurchaseOrdersPage.tsx`)
- Purpose: List/search POs; create; export CSV/PDF; delete; export to QBO.
- Data fetching: `GET /api/purchase-history?status=...&searchTerm=...`.
- Sorting: by numeric sequence in `purchase_number` (desc) with regex.
- Navigation: row click -> `/open-purchase-orders/:id` (open) or `/purchase-order/:id` (closed).
- Actions: New PO (`/open-purchase-orders/new`), delete PO, export to QBO for closed and not-yet-exported POs.
- Troubleshooting & Pitfalls:
  - Export to QBO requires a closed PO and appropriate backend QBO connectivity; shows `qbo_export_status` errors.
  - Search filters vendor name, purchase number; CSV uses raw rows; consider sanitizing before ingestion.

### OpenPurchaseOrderDetailPage (`src/pages/OpenPurchaseOrderDetailPage.tsx`)
- Purpose: Create/edit POs with vendor-aware part numbers.
- Vendor selection: Autocomplete with ranking; unsaved guard active.
- Duplicate bill number check: warns and allows proceed; set `requireBillNumber` true when closing.
- Line items: PN selection; totals via `calculatePurchaseOrderTotals`.
- Vendor PN mapping:
  - Fetch with `getPartVendors(partNumber)`; cache in `vendorPartMap`.
  - On vendor change or part select, swap PN to vendor preferred → most-used → fallback canonical.
  - `recordVendorUsage` available to increment usage upon finalize (recommended on save/close per line).
- Troubleshooting & Pitfalls:
  - If PNs don’t swap: ensure `ensureVendorMappings()` is called and vendor is selected; verify mapping rows exist for canonical PN.
  - If totals mismatch: confirm line `quantity` and `unit_cost` are parsed to numbers; DataGrid may carry strings.
  - Duplicate bill number false positives: backend search sensitivity; users can proceed after confirmation.

### QuotePage & QuoteEditorPage
- Listing: `GET /api/quotes`; CSV export; delete quote.
- Editor: create/edit; email/PDF. Unsaved guard active; updates route to `/quotes/:id` after create.
- Fields: customer/product/quote date/valid until/estimated cost/description/terms/PO/VIN.
- Troubleshooting & Pitfalls:
  - VIN validation: must be length 17 if provided (UI error shown).
  - On create, after POST the code resolves the new id from multiple possible response shapes; ensure backend returns one of: `quote_id`, `quoteId`, `id`, or `quote.quote_id`.

### InventoryPage (extended)
- Data source: `getStockInventory()` wrapper; rows keyed by `part_number`.
- Inline edits (`processRowUpdate`): numeric validation for `quantity_on_hand`, `reorder_point`, `last_unit_cost` (rejects NaN); sends minimal fields to `PUT /api/inventory/:partNumber`.
- Row delete: `DELETE /api/inventory/:partNumber`.
- CSV upload: `/api/inventory/upload-csv`; progress simulation to 90%; shows errors/warnings; template download from `/api/inventory/csv-template`.
- Cleanup preview:
  - Normalizes PN (remove spaces, uppercase, strip punctuation except `( ) /`, wrap fractions, detect flags).
  - Groups duplicates by normalized PN; proposes a keep; notes unit mismatches.
  - Clicking a fix/flag opens `UnifiedPartDialog` with prefilled fields for manual correction.
  - Apply cleanup: `applyCleanupEnforce('stock', merges)` (service abstraction) to apply merges in backend; refresh inventory.
- Troubleshooting & Pitfalls:
  - If normalization wraps improperly (e.g., `1/16`): confirm regex and ensure already-wrapped fractions `(...)` are skipped.
  - Hyphens: current normalization strips them; confirm with user preference (some domains prefer `-`).
  - Category field: ensure `CategorySelect` values map to backend enums.
  - Access: for `Sales and Purchase` role, row click to open edit dialog is disabled (read-only line edits still available where allowed).

### Email Settings (UserEmailSettingsPage)
- File: `src/pages/UserEmailSettingsPage.tsx`
- Purpose: Per-user SMTP configuration to send emails from the app using the user’s own mailbox.
- Fields stored (backend): `email_provider`, `email_host`, `email_port`, `email_secure`, `email_user`, `email_from`, and optionally `email_pass`.
- Provider presets: Gmail, Outlook/Hotmail, Yahoo, iCloud; “Custom SMTP” allows manual host/port/SSL.
- Key behaviors:
  - Load: GET `/api/email/user-settings` → returns `{ success, settings }`.
  - Save: POST `/api/email/user-settings` with settings; if an existing record is present and the password is left blank, backend keeps the prior password.
  - Test: POST `/api/email/test-user-connection` uses saved credentials to attempt an SMTP login and reports `{ success }`.
  - UI shows provider-specific instructions (e.g., Gmail App Password required when 2FA is enabled).
- Troubleshooting:
  - Connection test fails: verify `email_host`/`email_port`/`email_secure` match the provider, and use App Password for Gmail with 2FA.
  - “From Name” optional: if not set, backend typically uses the `email_user` as the from display.
  - Password updates: sending an empty password while updating existing settings retains the old password by design; enter a new one to update.

### Email Templates (EmailTemplatesPage)
- File: `src/pages/EmailTemplatesPage.tsx`
- Purpose: CRUD for reusable email templates of types: `purchase_order`, `sales_order`, `quote`, or `custom`.
- Template fields: `name`, `type`, `subject`, `html_content`, optional `text_content`, `is_default`.
- API:
  - GET `/api/email/templates` → `{ success, templates }` (lists)
  - POST `/api/email/templates` → create
  - PUT `/api/email/templates/:id` → update
  - DELETE `/api/email/templates/:id` → delete
- Usage:
  - When emailing from pages (quotes/SO/PO), backend can select the default template by type or a chosen template.
  - Rich formatting via `html_content`; `text_content` supports plain-text fallback.
- Troubleshooting:
  - If templates don’t load: confirm API returns `{ success: true, templates: [...] }` and user has permissions.
  - Subject/body variables: if backend supports token replacement, follow its token vocabulary; otherwise content is literal.

### Accounting (QuickBooks) Mapping (QBOAccountMappingPage)
- File: `src/pages/QBOAccountMappingPage.tsx`
- Purpose: Connect to QuickBooks Online and map app transactions to QBO accounts for exports.
- Connect to QBO:
  - “Connect to QuickBooks” → redirects to backend OAuth: baseURL + `/api/qbo/auth`.
  - Connection status: GET `/api/qbo-accounts/test-connection` → shows connected/realm info.
- Load data:
  - GET `/api/qbo-accounts/accounts` → accounts grouped by classification (Asset/Liability/Revenue/Expense) + `accountTypes` catalog.
  - GET `/api/qbo-accounts/mapping` → current mapping.
- Save mapping:
  - POST `/api/qbo-accounts/mapping` with selected account IDs; required: `qbo_inventory_account_id`, `qbo_gst_account_id`, `qbo_ap_account_id`; optional: `qbo_supply_expense_account_id`, `qbo_sales_account_id`, `qbo_labour_sales_account_id`, `qbo_ar_account_id`, `qbo_cogs_account_id`, `qbo_cost_of_labour_account_id`, `qbo_cost_of_materials_account_id`, `qbo_labour_expense_reduction_account_id`, `qbo_overhead_cogs_account_id`.
- How exports use mapping (typical):
  - Purchase Orders: Inventory, GST, AP; Supply items may post to Supply Expense.
  - Sales Orders: AR, Sales (Revenue), GST. Cost side journals to COGS (materials/labour/overhead), if enabled.
- Troubleshooting:
  - “Not Connected” banner: complete OAuth flow (often available via Business Profile or this page’s button).
  - Missing accounts: refresh `/api/qbo-accounts/accounts`; confirm QBO scope and company data.
  - Export failures: check `qbo_export_status` on record and ensure mapping covers all required accounts.

### Overhead Management (OverheadManagementPage)
- File: `src/pages/OverheadManagementPage.tsx`
- Purpose: Configure overhead distributions across QBO expense accounts for COGS journaling.
- Data:
  - Accounts: GET `/api/qbo-accounts/accounts` (with `accountTypes` for browsing)
  - Distributions: GET `/api/overhead/distribution` → list of `{ expense_account_id, percentage, description }` entries
- Manage distributions:
  - Add: POST `/api/overhead/distribution`
  - Edit: PUT `/api/overhead/distribution/:id`
  - Delete: DELETE `/api/overhead/distribution/:id`
- Constraints & UI:
  - Percentages must be > 0 and ≤ 100.
  - UI displays total/remaining; shows status as Complete/Over 100%/Incomplete.
- How it connects:
  - Complements QBO mapping (especially `qbo_overhead_cogs_account_id`).
  - During sales-side journaling (export/close), backend can allocate a configured portion of overhead to specified expense accounts for accurate COGS.
- Troubleshooting:
  - Totals > 100% blocked by UI; adjust entries.
  - No impact observed in exports: verify backend journaling uses distributions and that the Overhead COGS mapping is set.

### End-to-end linkage: Email + Accounting + Overhead
- Email: users save SMTP settings (per-user). Templates provide type-specific subject/body. When emailing a quote/SO/PO, backend selects a default or specific template and sends via user’s SMTP (tested in Email Settings page).
- QBO Mapping: ensures exports (SO/PO) post to correct accounts (Inventory/AP/GST on PO; AR/Sales/GST on SO; COGS side entries for materials/labour/overhead if configured).
- Overhead: distributions define how overhead costs are divided across expense accounts during COGS journaling, ensuring profitability reflects real overhead.

## Shared Components (extended details)

### PartFinderDialog
- Inputs: inventory items array; SO context id; `onSelect(part)` callback.
- Selection model: prefix chips A–Z/0–9, dynamic tokens derived from PN/description; token weights: usage (SO + global), recency, favorites, and query relevance.
- Local persistence: per-SO localStorage keys for favorites and recents.
- Server persistence: usage and favorite endpoints can be wired to share learning across users.
- Troubleshooting:
  - If tokens don’t reflect new parts: ensure token generation recomputes on new inventory props and query; check memoization dependencies.
  - Large datasets: consider virtualized results list; current DataGrid/list sizing should handle typical volumes.

### UnifiedPartDialog (Vendor Mappings)
- Vendor mapping UI is shown when `part_number` is present.
- Actions: add mapping (vendor, vendor PN, description, preferred), edit preferred flag, delete mapping.
- Service calls: `inventoryService.ts` mapping functions; backend routes in `inventoryVendorRoutes.ts`.
- Troubleshooting:
  - Duplicate mapping conflict: backend unique constraint `(part_number, vendor_id, vendor_part_number)` will error; handle user feedback in dialog.
  - Preferred toggle: only one preferred per (part, vendor) should be enforced UI-side if desired.

### UnsavedChangesGuard
- Blocks navigation using `unstable_useBlocker` and `beforeunload` (note: modern browsers show generic message only).
- Provides “Save and leave” (calls onSave and proceeds on success) or “Leave without saving”.
- Troubleshooting:
  - If modal doesn’t appear: ensure `when={isDirty}` true and `initialSignature` is set on load.
  - Save failure keeps user on page; ensure onSave throws or rejects on error so modal stays.

## Backend Error Catalogue (common messages)
- Inventory cleanup/apply: may return `{ error, details }` describing merge conflicts or validation errors.
- SO/PO save/close:
  - Insufficient inventory/negative inventory → prevent close or save (per page rules).
  - Duplicate bill number → warning prompt; can proceed.
  - Missing customer/vendor → 400/422 with message.
- QBO export:
  - `CUSTOMER_NOT_FOUND` on SO export to QBO → guided prompt to create in QBO path.
  - General `qbo_export_status` recorded in history rows; surfaced in list pages.

## Performance & Reliability Notes
- Large lists: DataGrid with pagination; sort models applied. Prefer server-side filtering for very large datasets.
- Numeric parsing: consistent use of `parseNumericInput` avoids NaN; ensure conversions when reading backend strings.
- Case sensitivity: part matching generally case-insensitive; normalize to upper/lower where indicated.

## Deployment & Packaging
- Electron packaging configured in `soft-sme-frontend/package.json` (builder targets, extra resources for backend).
- Backend Dockerfiles present; Render/Cloudflare configs in backend root.
- Backup scripts: `soft-sme-backend/backup-system.js` and schedulers; ensure permissions and paths set per environment.

## Vector Ingestion Guidance
- Chunk by:
  - Per-page sections (as above)
  - Shared components (Part Finder, Unsaved Guard, Unified dialogs)
  - Backend endpoints and data model
  - Business flows & invariants
  - Troubleshooting sections per feature
- Include file paths in embeddings to improve retrieval-to-code linkage.

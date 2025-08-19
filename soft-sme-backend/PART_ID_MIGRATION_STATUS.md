## Part ID Migration Status

Last updated: 2025-08-19

### Goal
Use `part_id` (integer PK from `inventory`) as the canonical identifier across the app. Keep `part_number` for display and human input, but never rely on it for identity-critical logic.

---

### Current state (done)

- Schema
  - `inventory.part_id` is canonical PK and used as FK by:
    - `inventory_audit_log.part_id` (INTEGER, FK) [migrated]
    - `salesorderlineitems.part_id` (INTEGER, FK) [migrated/backfilled]
    - `purchaselineitems.part_id` (INTEGER, FK) [already existed/backfilled]
    - `purchase_order_allocations.part_id` (INTEGER, FK) [migrated/backfilled]
    - `inventory_vendors.part_id` (preferred in unique conflict keys) [migrated]

- Backend routes/services
  - Inventory
    - `InventoryService`
      - `getOnHandByPartId`, `adjustInventoryByPartId`: fully `part_id`-based
      - `getOnHand(part_number)`, `adjustInventory(part_number)`: resolve to `part_id` then operate
  - Sales Orders
    - `SalesOrderService`
      - Upserts/queries match by `(part_id OR (part_id IS NULL AND part_number))`
      - Inserts include `part_id` when resolvable
      - Inventory adjustments prefer `part_id`
  - Purchase Orders
    - `purchaseOrderRoutes`
      - Auto-create PO: `purchaselineitems` insert resolves and stores `part_id`
      - PUT update PO: line inserts/updates resolve and store `part_id`
      - Close PO: inventory updates by `part_id`; allocations create/update SO lines with `part_id`
      - Reopen PO: inventory quantity revert by `part_id`
      - QBO export: inventory lookup prefers `part_id` when present on lines
    - `purchaseHistoryRoutes`
      - Save allocations: resolves/stores `part_id` in `purchase_order_allocations`
      - Close-with-allocations: SO line match by `(part_id OR part_number)`; new SO lines include `part_id`
      - Close/Reopen inventory updates prefer `part_id` when available
  - Inventory Vendors
    - `inventoryVendorRoutes`: upserts and conflict handling by `part_id`

- Frontend
  - Sales Order pages (`OpenSalesOrderDetailPage.tsx`, `WokerSalesOrderPage.tsx`)
    - Validation prefers `part_id` (fallback to `part_number`)
    - Payload line items include `part_id` when resolvable
    - Local `SalesOrderLineItem` interfaces include optional `part_id`
  - Part dialog/autocomplete: debounced lookups; unchanged (display-oriented)

- Data cleanup scripts
  - `20250119_migrate_line_items_to_part_id.sql`: add/backfill `part_id` columns
  - `20250120_purchase_order_allocations_use_part_id.sql`: add/backfill FK/index
  - `fix_part_id_mismatches.sql`: fuzzy match (remove `-`, spaces, quotes) to backfill `part_id`
  - `restore_labour_line_items.sql`: restore labour items from `time_entries`

---

### Remaining areas and recommendations

1) Tables still keyed by `part_number`
   - `sales_order_parts_to_order`
   - `aggregated_parts_to_order`
   - Recommendation:
     - Add `part_id INTEGER NULL` to both tables
     - Backfill via normalized `part_number` match to `inventory`
     - Add FK to `inventory(part_id)` with `ON DELETE SET NULL`
     - Update writers/readers to prefer `part_id` while keeping `part_number` for display and compatibility
     - Keep unique/PKs as-is initially; later consider keyed uniqueness on `part_id` where appropriate

2) Inventory service transitional APIs
   - `InventoryService.getOnHand(part_number)` and `adjustInventory(part_number)` still accept `part_number`.
   - Recommendation:
     - Internally, already resolve to `part_id`. For safety, update all DB `UPDATE ... WHERE part_number` calls to `WHERE part_id = $1` after resolution (some paths done; audit remaining).
     - Introduce deprecation notice in code comments; prefer `...ByPartId` methods for new code.

3) QBO export flow
   - Some checks still read inventory by `part_number` when `part_id` is not present on the line.
   - Recommendation:
     - Ensure all PO/SO lines include `part_id` end-to-end and adjust QBO helpers to require/use `part_id` (fallback only for legacy data).

4) Agent tools (`services/agentV2/tools.ts`)
   - Updated to resolve/store `part_id` when creating/updating POs.
   - Recommendation:
     - Enforce `part_id` in payloads where possible; continue to resolve from `part_number` for backward compatibility.

5) Frontend PO pages
   - Current server logic resolves `part_id` for inserts/updates.
   - Recommendation:
     - Optionally include `part_id` in PO line item payloads from the UI (when selected via autocomplete) to reduce server-side resolution.

6) Normalization/indexing
   - We rely on normalized comparisons for `part_number` during backfills.
   - Recommendation:
     - Consider a computed/search column for normalized `part_number` (e.g., strip `-`, spaces, quotes, `UPPER`), with an index to speed resolution. Not required if most paths use `part_id`.

7) Test coverage
   - Some tests delete by `part_number` for setup/teardown.
   - Recommendation:
     - Fine to keep; for identity tests, add coverage that asserts `part_id` flow (SO/PO line insert/update, allocations, inventory adjust).

---

### Concrete next steps (optional)

- Migrations
  - [ ] Add `part_id` to `sales_order_parts_to_order`, backfill, FK, index
  - [ ] Add `part_id` to `aggregated_parts_to_order`, backfill, FK, index

- Backend refactors
  - [ ] Update remaining `InventoryService` code paths to always `UPDATE ... WHERE part_id`
  - [ ] Ensure QBO export code passes/uses `part_id` through all layers

- Frontend
  - [ ] Include `part_id` in PO line payloads when items come from inventory autocomplete

---

### Risk notes

- Labour/Overhead/Supply lines intentionally have `part_id = NULL`; validation and inventory logic must keep excluding these from stock adjustments.
- Legacy data with mismatched `part_number` may still create `NULL part_id` lines; keep fuzzy backfill script handy and prefer UI to choose parts from inventory to ensure `part_id` is present.

---

### References

- Migrations
  - `soft-sme-backend/migrations/20250119_migrate_line_items_to_part_id.sql`
  - `soft-sme-backend/migrations/20250120_purchase_order_allocations_use_part_id.sql`
- Key backend files
  - `src/services/InventoryService.ts`
  - `src/services/SalesOrderService.ts`
  - `src/routes/purchaseOrderRoutes.ts`
  - `src/routes/purchaseHistoryRoutes.ts`
  - `src/routes/inventoryVendorRoutes.ts`
- Frontend
  - `soft-sme-frontend/src/pages/OpenSalesOrderDetailPage.tsx`
  - `soft-sme-frontend/src/pages/WokerSalesOrderPage.tsx`
  - `soft-sme-frontend/src/utils/salesOrderCalculations.ts`



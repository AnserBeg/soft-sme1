# Backend Inventory for AI Assistant Integration

This document lists existing Express routes and services that the new AI assistant should leverage instead of introducing direct database writes.

## Core Assistant Integration
- `src/routes/aiAssistantRoutes.ts`: Current HTTP surface that proxies chat, health, initialization, conversation history, stats, and start/stop commands to the Python agent via `aiAssistantService`.
- `src/services/aiAssistantService.ts`: Manages the legacy agent process/connection (Gemini-based) and should be refactored or replaced during the rebuild.

## Purchase Orders
- `src/routes/purchaseOrderRoutes.ts`: Full CRUD flow for purchase orders, including vendor mapping helpers and PDF generation.
- `src/services/PurchaseOrderCalculationService.ts`: Performs cost/total calculations reused when drafting purchase orders.

## Sales Orders
- `src/routes/salesOrderRoutes.ts`: Handles sales order creation, updates, QuickBooks syncing, and inventory adjustments.
- `src/services/SalesOrderService.ts` (and related helpers): Encapsulate business logic for sales orders.

## Customers & Vendors
- `src/routes/customerRoutes.ts`: CRUD endpoints for customers, including validation and duplicate checks.
- `src/routes/vendorRoutes.ts`: CRUD endpoints for vendors and vendor search helpers.

## Inventory & Products (for data lookups)
- `src/routes/inventoryRoutes.ts`: Inventory listing, filtering, and detail retrieval.
- `src/routes/productRoutes.ts`: Product catalog operations relevant to sales workflows.

## Email Configuration & Sending
- `src/routes/emailRoutes.ts`: Outbound email setup, testing, and templated sends.
- `src/services/emailService.ts`: Underlying mailer implementation (includes provider configuration).

## Authentication & Authorization
- `src/middleware/authMiddleware.ts`: Injects user identity into requests; agent runtime must respect the same auth context.
- `src/routes/authRoutes.ts`: Useful reference for session handling.

## Supporting Utilities
- `src/utils/sequence.ts`: Generates sequential numbers (e.g., PO numbers).
- `src/services/pdfService.ts`: Handles PDF generation (purchase orders, quotes) that the agent may need to trigger.

## Next Steps
1. Confirm which of the above modules must be wrapped as tools for the MVP.
2. Identify any missing API capabilities or validation gaps that require backend enhancements before agent orchestration.
3. Document authentication expectations (JWT claims, tenant scoping) so the agent can act on behalf of the current user securely.


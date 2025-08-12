# Purchase Order Calculation Update Summary

## Overview
This update ensures that purchase order totals (subtotal, GST amount, and total amount) are automatically recalculated and updated whenever a purchase order is saved or closed. This addresses inconsistencies where manual changes to line items might not properly update the header totals.

## Key Changes Made

### 1. Backend Calculation Service
**File**: `soft-sme-backend/src/services/PurchaseOrderCalculationService.ts`
- Created a comprehensive calculation service for purchase orders
- Handles line amount, subtotal, GST, and total calculations
- Provides database update functionality
- Includes validation methods
- Ensures consistent rounding to 2 decimal places

**Key Features**:
- `calculateLineAmount()`: Calculate individual line totals
- `calculateTotals()`: Calculate all purchase order totals
- `recalculateAndUpdateTotals()`: Update database with calculated totals
- `validatePurchaseOrder()`: Validate purchase order data

### 2. Legacy JavaScript Wrapper
**File**: `soft-sme-backend/src/services/purchaseOrderCalculations.js`
- CommonJS version of the calculation service for legacy routes in `index.js`
- Same functionality as TypeScript version but compatible with older code

### 3. Updated Purchase Order Routes

#### TypeScript Routes (`soft-sme-backend/src/routes/purchaseOrderRoutes.ts`)
- **POST `/`**: Recalculates totals after creating new purchase orders
- **PUT `/:id`**: Recalculates totals after updating purchase orders
- **POST `/:id/recalculate`**: Manual recalculation endpoint for debugging/maintenance

#### Legacy Routes (`soft-sme-backend/index.js`)
- **POST `/api/purchase-history`**: Recalculates totals after creation
- **PUT `/api/purchase-history/:id`**: Recalculates totals after updates

### 4. Frontend Updates

#### Calculation Utilities (`soft-sme-frontend/src/utils/purchaseOrderCalculations.ts`)
- Updated `calculateLineAmount()` to match backend rounding behavior
- Ensures frontend calculations match backend calculations

#### Service Layer (`soft-sme-frontend/src/services/purchaseOrderService.ts`)
- Added `recalculatePurchaseOrderTotals()` function for manual recalculation
- Provides interface to trigger backend recalculation if needed

#### Display Layer (`soft-sme-frontend/src/pages/OpenPurchaseOrdersPage.tsx`)
- Already properly configured to refresh data after updates
- Will automatically display updated calculations

## Automatic Calculation Triggers

The calculation service is automatically triggered in the following scenarios:

### Purchase Order Creation
1. User creates a new purchase order
2. Line items are inserted into the database
3. **NEW**: Calculation service recalculates totals based on actual line items
4. Database is updated with accurate totals
5. Frontend receives updated data

### Purchase Order Updates
1. User modifies an existing purchase order (line items, quantities, costs)
2. Line items are updated in the database
3. **NEW**: Calculation service recalculates totals based on updated line items
4. Database is updated with accurate totals
5. Frontend receives updated data

### Purchase Order Closure
1. User closes a purchase order (status changes to 'Closed')
2. Line items are finalized
3. **NEW**: Calculation service ensures final totals are accurate
4. Database stores final, calculated totals
5. Frontend displays accurate closed purchase order totals

## Manual Recalculation

For maintenance or debugging purposes, a manual recalculation endpoint is available:

```bash
POST /api/purchase-orders/{id}/recalculate
```

This can be used to fix any existing purchase orders with incorrect totals.

## Benefits

1. **Data Accuracy**: All purchase order totals are guaranteed to be mathematically correct
2. **Consistency**: Frontend and backend calculations use identical logic
3. **Real-time Updates**: Totals update immediately when line items change
4. **Automatic Correction**: Manual data entry errors are automatically corrected
5. **Audit Trail**: All calculations are logged for debugging

## Implementation Notes

- Calculations use 2-decimal precision with proper rounding
- GST rate is retrieved from the purchase order settings (default: 5%)
- Calculation service works within existing database transactions
- Errors in calculation don't prevent purchase order operations
- Frontend automatically receives updated totals through existing API calls

## Testing Recommendations

1. Create a new purchase order with multiple line items
2. Verify that subtotal, GST, and total are calculated correctly
3. Modify line item quantities and costs
4. Verify that totals update automatically
5. Close a purchase order and verify final totals are accurate
6. Check that the OpenPurchaseOrdersPage displays correct totals

## Sales Orders

Sales orders already have a similar calculation system in place via `SalesOrderService.recalculateAndUpdateSummary()`, so this update brings purchase orders to the same level of accuracy and consistency.
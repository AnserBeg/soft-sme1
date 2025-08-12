# Sales Order Calculation Update Summary

## Overview
This update ensures that sales order totals (subtotal, GST amount, and total amount) are automatically recalculated and updated whenever a sales order is saved or closed. This addresses inconsistencies between the newer TypeScript routes and legacy JavaScript routes, and improves calculation precision.

## Issues Found and Fixed

### 1. **Legacy Route Inconsistencies**
**Problem**: Legacy sales order routes in `index.js` were doing manual calculations instead of using the `SalesOrderService.recalculateAndUpdateSummary` method.

**Files Affected**: 
- `soft-sme-backend/index.js` (lines ~1156-1167, ~1090-1095)

**Solution**: Updated legacy routes to use the proper `SalesOrderService` for consistent calculations.

### 2. **Calculation Precision Issues**
**Problem**: The `SalesOrderService.recalculateAndUpdateSummary` method lacked proper rounding, potentially causing floating-point precision errors.

**Files Affected**: 
- `soft-sme-backend/src/services/SalesOrderService.ts`
- `soft-sme-frontend/src/utils/salesOrderCalculations.ts`

**Solution**: Added proper rounding to 2 decimal places in both backend and frontend calculations.

## Key Changes Made

### 1. Backend Service Improvements

#### Updated SalesOrderService (`soft-sme-backend/src/services/SalesOrderService.ts`)
- **Enhanced `recalculateAndUpdateSummary` method**: Added proper rounding to avoid floating-point precision issues
- **Added calculation logging**: For debugging and audit purposes
- **Consistent 2-decimal precision**: All monetary calculations now use `Math.round(value * 100) / 100`

#### Updated Legacy Routes (`soft-sme-backend/index.js`)
- **Added SalesOrderService import and instance**: Legacy routes now use the proper service
- **POST `/api/sales-order-history`**: Now calls `recalculateAndUpdateSummary` after creation
- **PUT `/api/sales-order-history/:id`**: Now calls `recalculateAndUpdateSummary` after updates
- **Removed manual calculations**: No more ad-hoc GST and total calculations

#### New API Endpoint (`soft-sme-backend/src/routes/salesOrderRoutes.ts`)
- **POST `/api/sales-orders/:id/recalculate`**: Manual recalculation endpoint for maintenance/debugging

### 2. Frontend Consistency

#### Updated Calculation Utilities (`soft-sme-frontend/src/utils/salesOrderCalculations.ts`)
- **Enhanced `calculateLineAmount` function**: Added proper rounding to match backend precision
- **Consistent precision**: Frontend calculations now match backend calculations exactly

## Automatic Calculation Triggers

The calculation service is now automatically triggered in the following scenarios:

### Sales Order Creation
1. User creates a new sales order via **any route** (TypeScript or legacy)
2. Line items are inserted into the database
3. **ENHANCED**: `SalesOrderService.recalculateAndUpdateSummary` calculates accurate totals
4. Database is updated with precise totals
5. Frontend receives updated data

### Sales Order Updates
1. User modifies an existing sales order via **any route** (TypeScript or legacy)
2. Line items are updated in the database
3. **ENHANCED**: `SalesOrderService.recalculateAndUpdateSummary` recalculates totals
4. Database is updated with accurate totals
5. Frontend receives updated data

### Sales Order Closure
1. User closes a sales order (status changes to 'Closed')
2. TypeScript routes already handle this properly
3. **FIXED**: Legacy routes now also trigger proper recalculation
4. Final totals are guaranteed to be accurate

## Routes Comparison

| Route Type | Create Route | Update Route | Calculation Method |
|------------|--------------|--------------|-------------------|
| **TypeScript** | `POST /api/sales-orders/` | `PUT /api/sales-orders/:id` | ✅ `SalesOrderService.recalculateAndUpdateSummary` |
| **Legacy (BEFORE)** | `POST /api/sales-order-history` | `PUT /api/sales-order-history/:id` | ❌ Manual calculation |
| **Legacy (AFTER)** | `POST /api/sales-order-history` | `PUT /api/sales-order-history/:id` | ✅ `SalesOrderService.recalculateAndUpdateSummary` |

## Calculation Improvements

### Before (Potential Issues)
```javascript
// Manual calculation in legacy routes
const calcSubtotal = lineItems.reduce((sum, item) => sum + Number(item.line_amount || 0), 0);
const calcGST = calcSubtotal * 0.05; // No rounding
const calcTotal = calcSubtotal + calcGST; // Potential precision errors
```

### After (Consistent & Precise)
```typescript
// SalesOrderService with proper rounding
subtotal = Math.round(subtotal * 100) / 100;
const total_gst_amount = Math.round((subtotal * 0.05) * 100) / 100;
const total_amount = Math.round((subtotal + total_gst_amount) * 100) / 100;
```

## Benefits

1. **Data Consistency**: All sales order routes now use the same calculation logic
2. **Precision Accuracy**: Proper rounding eliminates floating-point errors
3. **Maintenance**: Single source of truth for calculation logic
4. **Debugging**: Added logging for calculation tracking
5. **Future-Proof**: Manual recalculation endpoint for maintenance

## Manual Recalculation

For maintenance or debugging purposes, a manual recalculation endpoint is available:

```bash
POST /api/sales-orders/{id}/recalculate
```

This can be used to fix any existing sales orders with incorrect totals.

## Testing Recommendations

1. **Create new sales orders** via both routes and verify calculations match
2. **Update existing sales orders** and ensure totals recalculate correctly
3. **Close sales orders** and verify final totals are accurate
4. **Test precision** with amounts that might cause floating-point issues (e.g., $10.01 * 3)
5. **Compare legacy vs TypeScript routes** to ensure they produce identical results

## Impact on Frontend Tables

Sales order tables will now always display accurate totals because:
- All backend routes guarantee mathematically correct calculations
- Frontend calculation utilities match backend precision
- Database always stores properly rounded values
- No more discrepancies between manual and automatic calculations

## Summary

This update brings sales order calculations to the same level of precision and consistency as the purchase order system. Both legacy JavaScript routes and modern TypeScript routes now use the same calculation service, ensuring data integrity across all sales order operations.
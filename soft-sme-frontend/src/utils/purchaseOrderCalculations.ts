/**
 * Utility functions for robust purchase order calculations
 * Ensures consistent calculation of line amounts, subtotals, GST, and totals
 */

export interface PurchaseOrderLineItem {
  part_number: string;
  part_description: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  line_amount?: number;
}

export interface PurchaseOrderTotals {
  subtotal: number;
  total_gst_amount: number;
  total_amount: number;
}

/**
 * Calculate line amount for a single line item
 * @param quantity - Quantity of items
 * @param unit_cost - Cost per unit
 * @returns Line amount (quantity * unit_cost)
 */
export const calculateLineAmount = (quantity: number, unit_cost: number): number => {
  const q = parseFloat(String(quantity)) || 0;
  const uc = parseFloat(String(unit_cost)) || 0;
  return Math.round((q * uc) * 100) / 100; // Round to 2 decimal places
};

/**
 * Calculate all totals for a purchase order
 * @param lineItems - Array of line items
 * @param gstRate - GST rate as percentage (default: 5.0)
 * @returns Object with subtotal, total_gst_amount, and total_amount
 */
export const calculatePurchaseOrderTotals = (
  lineItems: PurchaseOrderLineItem[],
  gstRate: number = 5.0
): PurchaseOrderTotals => {
  // Calculate subtotal by summing all line amounts
  const subtotal = lineItems.reduce((sum, item) => {
    const lineAmount = calculateLineAmount(item.quantity, item.unit_cost);
    return sum + lineAmount;
  }, 0);

  // Calculate GST amount (subtotal * gstRate / 100)
  const total_gst_amount = subtotal * (gstRate / 100);

  // Calculate total amount (subtotal + total_gst_amount)
  const total_amount = subtotal + total_gst_amount;

  return {
    subtotal: Math.round(subtotal * 100) / 100, // Round to 2 decimal places
    total_gst_amount: Math.round(total_gst_amount * 100) / 100,
    total_amount: Math.round(total_amount * 100) / 100,
  };
};

/**
 * Update line items with calculated line amounts
 * @param lineItems - Array of line items
 * @returns Updated line items with calculated line_amount
 */
export const updateLineItemsWithCalculatedAmounts = (
  lineItems: PurchaseOrderLineItem[]
): PurchaseOrderLineItem[] => {
  return lineItems.map(item => ({
    ...item,
    line_amount: calculateLineAmount(item.quantity, item.unit_cost),
  }));
};

/**
 * Validate line item data
 * @param lineItem - Line item to validate
 * @returns Object with validation errors
 */
export const validateLineItem = (lineItem: PurchaseOrderLineItem, isClosing: boolean = false): {
  quantity?: string;
  unit_cost?: string;
  part_number?: string;
  part_description?: string;
} => {
  const errors: any = {};
  
  if (!lineItem.part_number?.trim()) {
    errors.part_number = 'Part Number is required';
  }
  
  if (!lineItem.part_description?.trim()) {
    errors.part_description = 'Part Description is required';
  }
  
  const quantity = parseFloat(String(lineItem.quantity));
  if (isNaN(quantity) || quantity <= 0) {
    errors.quantity = 'Quantity must be greater than 0';
  }
  
  if (isClosing) {
    const unitCost = parseFloat(String(lineItem.unit_cost));
    if (isNaN(unitCost) || unitCost <= 0) {
      errors.unit_cost = 'Unit Cost must be greater than 0';
    }
  }
  
  return errors;
};

/**
 * Validate entire purchase order
 * @param lineItems - Array of line items
 * @param vendor - Vendor information
 * @returns Object with validation errors
 */
export const validatePurchaseOrder = (
  lineItems: PurchaseOrderLineItem[],
  vendor?: any,
  isClosing: boolean = false
): {
  vendor?: string;
  lineItems?: Array<ReturnType<typeof validateLineItem>>;
} => {
  const errors: any = {};
  
  if (!vendor) {
    errors.vendor = 'Vendor is required';
  }
  
  const lineItemErrors = lineItems.map(item => validateLineItem(item, isClosing));
  const hasLineItemErrors = lineItemErrors.some(err => Object.keys(err).length > 0);
  
  if (hasLineItemErrors) {
    errors.lineItems = lineItemErrors;
  }
  
  return errors;
};

/**
 * Format currency for display
 * @param amount - Amount to format
 * @returns Formatted currency string
 */
export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(amount);
};

/**
 * Parse and validate numeric input
 * @param value - Input value to parse
 * @returns Parsed number or 0 if invalid
 */
export const parseNumericInput = (value: string | number): number => {
  const parsed = parseFloat(String(value));
  return isNaN(parsed) ? 0 : parsed;
}; 
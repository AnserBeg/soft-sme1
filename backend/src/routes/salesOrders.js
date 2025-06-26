// In the POST /salesorders route, update the fallback logic and add logging
// ... existing code ...
  // If product_name or product_description is not provided, use the first line item's values
  if (!product_name || !product_description) {
    const firstLineItem = line_items[0];
    if (firstLineItem) {
      if (!product_name) {
        product_name = firstLineItem.product_name;
        console.log('Fallback: Setting product_name from first line item:', product_name);
      }
      if (!product_description) {
        product_description = firstLineItem.product_description;
        console.log('Fallback: Setting product_description from first line item:', product_description);
      }
    }
  }
// ... existing code ...

// In the PUT /salesorders/:id route, update the fallback logic and add logging
// ... existing code ...
  // If product_name or product_description is not provided, use the first line item's values
  if (!product_name || !product_description) {
    const firstLineItem = line_items[0];
    if (firstLineItem) {
      if (!product_name) {
        product_name = firstLineItem.product_name;
        console.log('Fallback: Setting product_name from first line item:', product_name);
      }
      if (!product_description) {
        product_description = firstLineItem.product_description;
        console.log('Fallback: Setting product_description from first line item:', product_description);
      }
    }
  }
// ... existing code ... 
  return;
}

try {
  // Update status to 'Closed' and set bill_number if it's entered
  const updatedPOData = {
    ...purchaseOrder,
    vendor_id: vendor?.id,
    bill_date: billDate?.toISOString(),
    bill_number: billNumber,
    lineItems: lineItems.map(item => ({
      ...item,
      quantity: parseFloat(String(item.quantity)),
      unit_cost: parseFloat(String(item.unit_cost)),
      line_amount: parseFloat(String(item.line_amount))
    })),
    status: 'Closed',
    subtotal: subTotal,
    total_gst_amount: totalGSTAmount,
    total_amount: totalAmount,
    global_gst_rate: globalGstRate
  };

  const response = await api.put(`/api/purchase-history/${purchaseOrder.purchase_id}`, updatedPOData);

  if (response.status === 200) {
    // ... existing code ...
  }
} catch (error) {
  // ... existing code ...
} 
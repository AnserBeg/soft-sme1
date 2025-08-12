export interface PurchaseOrder {
  id: string;
  purchase_id: string;
  purchase_number: string;
  vendor_id: string;
  vendor_name: string;
  order_date: string;
  status: string;
  subtotal: number;
  total_gst_amount: number;
  total_amount: number;
  notes?: string;
  created_at: string;
  updated_at: string;
  bill_number?: string;
  gst_rate: number;
  lineItems: Array<{
    part_number: string;
    part_description: string;
    quantity: number;
    unit: string;
    unit_cost: number;
    line_amount: number;
    gst_rate?: number;
  }>;
  qbo_exported_at?: string | null;
  exported_to_qbo?: boolean;
  qbo_export_status?: string | null;
}

export interface PurchaseOrderLine {
  id: string;
  purchase_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  notes?: string;
} 
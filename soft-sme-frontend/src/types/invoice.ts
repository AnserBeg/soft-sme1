export interface InvoiceLineItem {
  invoice_line_item_id?: number;
  part_id?: number | null;
  part_number: string;
  part_description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  line_amount: number;
}

export interface Invoice {
  invoice_id: number;
  invoice_number: string;
  sequence_number?: string;
  customer_id: number;
  customer_name?: string;
  sales_order_id?: number | null;
  source_sales_order_number?: string | null;
  sales_order_number?: string | null;
  product_name?: string | null;
  product_description?: string | null;
  vin_number?: string | null;
  unit_number?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  mileage?: number | null;
  terms?: string | null;
  status: 'Paid' | 'Unpaid';
  invoice_date: string;
  due_date: string;
  payment_terms_in_days?: number | null;
  default_payment_terms_in_days?: number | null;
  subtotal: number;
  total_gst_amount: number;
  total_amount: number;
  notes?: string | null;
}

export interface InvoiceListResponse {
  invoices: Invoice[];
  summary: {
    totalReceivables: number;
    totalOverdue: number;
  };
  hasMore?: boolean;
}

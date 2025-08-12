export interface Product {
  id: number;
  product_id: number;
  product_name: string;
  product_description: string | null;
  unit?: string;
  last_unit_cost?: number;
  quantity_on_hand?: number;
  reorder_point?: number;
  created_at: string;
  updated_at: string;
} 
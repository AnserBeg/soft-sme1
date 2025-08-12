export interface Margin {
  product_id: number;
  cost_lower_bound: number;
  cost_upper_bound: number;
  margin_factor: number;
}

export interface MarginSchedule {
  id: string;
  margin_id: string;
  cost_lower_bound: number;
  cost_upper_bound: number;
  margin_factor: number;
  created_at: string;
  updated_at: string;
} 
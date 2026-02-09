export interface SalesPerson {
  sales_person_id: number;
  sales_person_name: string;
  email?: string | null;
  phone_number?: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

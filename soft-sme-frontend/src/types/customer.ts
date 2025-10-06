export interface Customer {
  id: string;
  customer_id: string;
  customer_name: string;
  email?: string;
  phone?: string;
  phone_number?: string;
  address?: string;
  street_address?: string;
  city?: string;
  state?: string;
  province?: string;
  country?: string;
  postal_code?: string;
  contact_person?: string;
  website?: string;
  general_notes?: string;
  created_at: string;
  updated_at: string;
}
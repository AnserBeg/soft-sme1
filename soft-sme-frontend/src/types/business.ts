export interface BusinessProfile {
  id: string;
  business_name: string;
  street_address: string;
  city: string;
  province: string;
  postal_code?: string;
  country: string;
  telephone_number: string;
  email: string;
  business_number: string;
  logo_url?: string;
  website?: string;
  geo_fence_enabled?: boolean;
  geo_fence_center_latitude?: number | string | null;
  geo_fence_center_longitude?: number | string | null;
  geo_fence_radius_meters?: number | string | null;
  created_at: string;
  updated_at: string;
}

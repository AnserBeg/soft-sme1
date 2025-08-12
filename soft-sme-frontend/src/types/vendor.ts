export interface Vendor {
    vendor_id: number;
    vendor_name: string;
    street_address: string | null;
    city: string | null;
    province: string | null;
    country: string | null;
    contact_person: string | null;
    telephone_number: string | null;
    email: string | null;
    website: string | null;
    postal_code?: string | null;
    created_at: string;
    updated_at: string;
} 
export type VehicleHistorySource = 'invoice' | 'sales_order';

export interface VehicleHistoryRecord {
  source: VehicleHistorySource;
  source_id: number;
  reference_number?: string | null;
  activity_date: string | null;
  record_date?: string | null;
  vin_number?: string | null;
  unit_number?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  mileage?: number | null;
  product_name?: string | null;
  product_description?: string | null;
}

export interface VehicleHistoryResponse {
  records: VehicleHistoryRecord[];
}

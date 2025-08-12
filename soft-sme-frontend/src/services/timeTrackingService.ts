import api from '../api/axios';

const toUtcIso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
const uuid = () => (crypto as any).randomUUID ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export interface Profile {
  id: number;
  name: string;
  email: string;
}

export interface SalesOrder {
  id: number;
  number: string;
  product_name?: string;
  default_hourly_rate?: number;
}

export interface TimeEntry {
  id: number;
  profile_id: number;
  profile_name: string;
  sales_order_id: number;
  sales_order_number: string;
  clock_in: string;
  clock_out: string | null;
  duration: number | null;
  unit_price: number;
}

export interface TimeEntryReport {
  id: number;
  date: string;
  profile_name: string;
  sales_order_number: string;
  clock_in: string;
  clock_out: string | null;
  duration: number | null;
  unit_price: number;
  total: number;
}

export interface LabourLineItem {
  id: number;
  sales_order_id: number;
  date: string;
  title: string;
  units: string;
  quantity: number;
  unit_price: number;
  total: number;
}

// Profile endpoints
export const getProfiles = async (): Promise<Profile[]> => {
  try {
    const response = await api.get('/api/time-tracking/profiles');
    localStorage.setItem('tt_profiles_cache', JSON.stringify(response.data));
    return response.data;
  } catch (err) {
    const cached = localStorage.getItem('tt_profiles_cache');
    return cached ? JSON.parse(cached) : [];
  }
};

export const createProfile = async (name: string, email: string): Promise<Profile> => {
  const response = await api.post('/api/time-tracking/profiles', { name, email });
  return response.data;
};

// Sales order endpoints
export const getSalesOrders = async (): Promise<SalesOrder[]> => {
  try {
    const response = await api.get('/api/time-tracking/sales-orders');
    localStorage.setItem('tt_sales_orders_cache', JSON.stringify(response.data));
    return response.data;
  } catch (err) {
    const cached = localStorage.getItem('tt_sales_orders_cache');
    return cached ? JSON.parse(cached) : [];
  }
};

export const updateSalesOrderRate = async (
  id: number,
  default_hourly_rate: number
): Promise<{ updated: SalesOrder; all: SalesOrder[] }> => {
  const response = await api.patch(`/api/time-tracking/sales-orders/${id}`, { default_hourly_rate });
  return response.data;
};

// Time entry endpoints
export const getTimeEntries = async (date: string, profileId?: number): Promise<TimeEntry[]> => {
  const params: any = { date };
  if (profileId) params.profile_id = profileId;
  const response = await api.get('/api/time-tracking/time-entries', { params });
  return response.data;
};

export const clockIn = async (profile_id: number, so_id: number): Promise<TimeEntry> => {
  try {
    const response = await api.post('/api/time-tracking/time-entries/clock-in', { profile_id, so_id });
    return response.data;
  } catch (err) {
    const evt = {
      event_id: uuid(),
      user_id: profile_id,
      device_id: localStorage.getItem('deviceId') || 'unknown-device',
      type: 'time_clock_in',
      timestamp_utc: toUtcIso(new Date()),
      payload_json: JSON.stringify({ profile_id, so_id }),
      created_at: toUtcIso(new Date()),
    };
    await (window as any)?.api?.timeEvents?.insert?.(evt);
    return {
      id: -Math.floor(Math.random() * 1e9),
      profile_id,
      profile_name: '',
      sales_order_id: so_id,
      sales_order_number: '',
      clock_in: new Date().toISOString(),
      clock_out: null,
      duration: null,
      unit_price: 0,
      __pending: true,
      __pending_event_id: evt.event_id,
    } as any;
  }
};

export const clockOut = async (id: number): Promise<TimeEntry> => {
  try {
    const response = await api.post(`/api/time-tracking/time-entries/${id}/clock-out`);
    return response.data;
  } catch (err) {
    const evt = {
      event_id: uuid(),
      device_id: localStorage.getItem('deviceId') || 'unknown-device',
      type: 'time_clock_out',
      timestamp_utc: toUtcIso(new Date()),
      payload_json: JSON.stringify({ id }),
      created_at: toUtcIso(new Date()),
    };
    await (window as any)?.api?.timeEvents?.insert?.(evt);
    return {
      id,
      clock_out: new Date().toISOString(),
      __pending: true,
      __pending_event_id: evt.event_id,
    } as any;
  }
};

export const updateTimeEntry = async (id: number, clock_in: string, clock_out: string) => {
  const response = await api.put(`/api/time-tracking/time-entries/${id}`, { clock_in, clock_out });
  return response.data;
};

// Report endpoints
export const getTimeEntryReport = async (
  from: string,
  to: string,
  profile?: number,
  so?: number
): Promise<TimeEntryReport[]> => {
  const response = await api.get('/api/time-tracking/reports/time-entries', {
    params: { from, to, profile, so }
  });
  return response.data;
};

export const exportTimeEntryReport = async (
  from: string,
  to: string,
  profile?: number,
  so?: number,
  format: 'csv' | 'pdf' = 'csv'
): Promise<Blob> => {
  const response = await api.get('/api/time-tracking/reports/time-entries/export', {
    params: { from, to, profile, so, format },
    responseType: 'blob'
  });
  return response.data;
};

// Labour line items endpoints
export const getLabourLineItems = async (salesOrderId: number): Promise<LabourLineItem[]> => {
  const response = await api.get(`/api/time-tracking/labour-line-items/${salesOrderId}`);
  return response.data;
};

// Get open (not clocked out) time entries for a profile
export const getOpenTimeEntries = async (profileId: number): Promise<TimeEntry[]> => {
  const response = await api.get('/api/time-tracking/time-entries/open', { params: { profile_id: profileId } });
  return response.data;
}; 
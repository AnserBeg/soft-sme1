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
  duration: number | string | null;
  unit_price: number;
}

export interface TimeEntryReport {
  id: number;
  date: string;
  profile_name: string;
  sales_order_number: string;
  clock_in: string;
  clock_out: string | null;
  duration: number | string | null;
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

export function parseDurationHours(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }

    const hhmmssMatch = trimmed.match(/^(-?)(\d+):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
    if (hhmmssMatch) {
      const sign = hhmmssMatch[1] === '-' ? -1 : 1;
      const hours = parseInt(hhmmssMatch[2], 10);
      const minutes = parseInt(hhmmssMatch[3], 10);
      const seconds = hhmmssMatch[4] ? parseInt(hhmmssMatch[4], 10) : 0;
      if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) {
        return null;
      }
      return sign * (hours + minutes / 60 + seconds / 3600);
    }

    const isoDurationMatch = trimmed.match(/^(-)?P?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
    if (isoDurationMatch) {
      const sign = isoDurationMatch[1] === '-' ? -1 : 1;
      const hours = isoDurationMatch[2] ? parseFloat(isoDurationMatch[2]) : 0;
      const minutes = isoDurationMatch[3] ? parseFloat(isoDurationMatch[3]) : 0;
      const seconds = isoDurationMatch[4] ? parseFloat(isoDurationMatch[4]) : 0;
      if ([hours, minutes, seconds].some(part => Number.isNaN(part))) {
        return null;
      }
      return sign * (hours + minutes / 60 + seconds / 3600);
    }
  }

  return null;
}

export function formatDurationDisplay(value: unknown, fractionDigits = 3): string {
  const parsed = parseDurationHours(value);
  return parsed !== null && !Number.isNaN(parsed) ? `${parsed.toFixed(fractionDigits)} hrs` : '-';
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

export const deleteTimeEntry = async (id: number): Promise<void> => {
  await api.delete(`/api/time-tracking/time-entries/${id}`);
};

export const createTimeEntry = async (profileId: number, salesOrderId: number, clockInISO: string, clockOutISO: string): Promise<TimeEntry> => {
  const response = await api.post('/api/time-tracking/time-entries/manual', {
    profile_id: profileId,
    sales_order_id: salesOrderId,
    clock_in: clockInISO,
    clock_out: clockOutISO
  });
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
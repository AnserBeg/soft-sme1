import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000';

export interface Profile {
  id: number;
  name: string;
  email: string;
}

export interface SalesOrder {
  id: number;
  number: string;
}

export interface TimeEntry {
  id: number;
  profile_id: number;
  so_id: number;
  clock_in: string;
  clock_out: string | null;
  duration: number;
  unit_price: number;
}

export interface LabourLineItem {
  id: number;
  so_id: number;
  date: string;
  title: string;
  units: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export const timeTrackingApi = {
  // Profile endpoints
  getProfiles: async (): Promise<Profile[]> => {
    const response = await axios.get(`${API_BASE_URL}/profiles`);
    return response.data;
  },

  createProfile: async (profile: Omit<Profile, 'id'>): Promise<Profile> => {
    const response = await axios.post(`${API_BASE_URL}/profiles`, profile);
    return response.data;
  },

  // Sales Order endpoints
  getOpenSalesOrders: async (): Promise<SalesOrder[]> => {
    const response = await axios.get(`${API_BASE_URL}/sales-orders?status=open`);
    return response.data;
  },

  updateSalesOrderRate: async (soId: number, rate: number): Promise<SalesOrder> => {
    const response = await axios.patch(`${API_BASE_URL}/sales-orders/${soId}`, {
      default_hourly_rate: rate,
    });
    return response.data;
  },

  // Time Entry endpoints
  clockIn: async (data: { profile_id: number; so_id: number }): Promise<TimeEntry> => {
    const response = await axios.post(`${API_BASE_URL}/time-entries/clock-in`, data);
    return response.data;
  },

  clockOut: async (timeEntryId: number): Promise<TimeEntry> => {
    const response = await axios.post(`${API_BASE_URL}/time-entries/${timeEntryId}/clock-out`);
    return response.data;
  },

  getTimeEntries: async (date: string): Promise<TimeEntry[]> => {
    const response = await axios.get(`${API_BASE_URL}/time-entries?date=${date}`);
    return response.data;
  },

  // Reports endpoints
  getTimeEntryReport: async (params: {
    from: string;
    to: string;
    profile?: number;
    so?: number;
  }): Promise<TimeEntry[]> => {
    const response = await axios.get(`${API_BASE_URL}/reports/time-entries`, { params });
    return response.data;
  },

  exportTimeEntryReport: async (params: {
    from: string;
    to: string;
    profile?: number;
    so?: number;
    format: 'csv' | 'pdf';
  }): Promise<Blob> => {
    const response = await axios.get(`${API_BASE_URL}/reports/time-entries/export`, {
      params,
      responseType: 'blob',
    });
    return response.data;
  },
}; 
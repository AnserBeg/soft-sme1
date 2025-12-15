import axios from 'axios';

// Allow env override while keeping the previous hard-coded fallback when unset
const ENV_BASE_URL =
  import.meta.env.VITE_BACKEND_URL?.trim() ?? import.meta.env.VITE_API_BASE_URL?.trim();
const DEFAULT_BASE_URL = '/api';

// Normalize base URL so it always includes the /api prefix and no trailing slash
const BASE_URL = (() => {
  const raw = ENV_BASE_URL && ENV_BASE_URL.length > 0 ? ENV_BASE_URL : DEFAULT_BASE_URL;
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
})();

// Create axios instance with optimized configuration
export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000, // Increased timeout for tunnel connections
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests automatically
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('sessionToken');
  console.log('API Request - Token found:', !!token, 'URL:', config.url);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    console.warn('API Request - No token found in localStorage');
  }

  // Multi-tenant: use stored user.company_id to scope tenant DB, but never send a stale tenant
  // hint on auth endpoints (login) because the stored user may belong to a different company.
  const url = config.url || '';
  const isAuthEndpoint = url.startsWith('/auth/');
  if (!isAuthEndpoint) {
    try {
      const userRaw = localStorage.getItem('userData');
      const user = userRaw ? JSON.parse(userRaw) : null;
      const companyId = user?.company_id;
      if (companyId !== undefined && companyId !== null && companyId !== '') {
        config.headers['x-tenant-id'] = String(companyId);
      }
    } catch {
      /* ignore */
    }
  } else {
    try {
      delete (config.headers as any)['x-tenant-id'];
      delete (config.headers as any)['X-Tenant-Id'];
    } catch {
      /* ignore */
    }
  }
  return config;
});

// Auth API
export const authAPI = {
  login: async (email: string, password: string) => {
    const response = await api.post('/auth/login', { email, password });
    return response.data;
  },
};

// Time Tracking API
export const timeTrackingAPI = {
  getTimeEntries: async (date: string) => {
    const response = await api.get(`/time-tracking/time-entries?date=${date}`);
    return response.data;
  },
  
  getActiveTimeEntries: async (profileId?: string) => {
    const today = new Date().toLocaleDateString('en-CA');
    // Try the profile-specific open endpoint first, then fall back to today's entries
    const fallbacks = [
      profileId ? `/time-tracking/time-entries/open?profile_id=${profileId}` : null,
      `/time-tracking/time-entries?date=${today}`
    ].filter(Boolean) as string[];

    // Try multiple fallbacks so we always surface open sessions after a relogin.
    for (const path of fallbacks) {
      try {
        const response = await api.get(path);
        const data = response.data;

        const entries = Array.isArray(data)
          ? data
          : Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data?.timeEntries)
              ? data.timeEntries
              : [];

        const openEntries = entries.filter((e: any) => !e.clock_out);
        if (openEntries.length > 0) {
          return openEntries;
        }
      } catch (error) {
        // continue to next fallback
      }
    }

    console.warn('Active entries not available from any endpoint, returning empty array');
    return [];
  },
  
  clockIn: async (profileId: string, soId: string) => {
    const response = await api.post('/time-tracking/time-entries/clock-in', {
      profile_id: profileId,
      so_id: soId,
    });
    return response.data;
  },
  
  clockOut: async (entryId: string, techStoryEntry?: string) => {
    const payload = techStoryEntry ? { tech_story_entry: techStoryEntry } : {};
    const response = await api.post(`/time-tracking/time-entries/${entryId}/clock-out`, payload);
    return response.data;
  },
  
  getProfiles: async () => {
    const response = await api.get('/time-tracking/mobile/profiles');
    return response.data;
  },
  
  getSalesOrders: async () => {
    const response = await api.get('/time-tracking/sales-orders');
    return response.data;
  },

  getSalesOrderTechStory: async (salesOrderId: string) => {
    const response = await api.get(`/time-tracking/sales-orders/${salesOrderId}/tech-story`);
    return response.data;
  },
};

export const attendanceAPI = {
  getGeofence: async () => {
    const response = await api.get('/attendance/geofence');
    return response.data;
  },
  getShifts: async (params?: { from?: string; to?: string }) => {
    const response = await api.get('/attendance', { params });
    return response.data;
  },
  getActiveShift: async (profileId: string) => {
    const response = await api.get('/attendance/active', { params: { profile_id: profileId } });
    return response.data;
  },
  clockIn: async (profileId: string, coords?: { latitude?: number; longitude?: number }) => {
    const response = await api.post('/attendance/clock-in', {
      profile_id: profileId,
      latitude: coords?.latitude,
      longitude: coords?.longitude,
    });
    return response.data;
  },
  clockOut: async (
    shiftId?: string,
    profileId?: string,
    coords?: { latitude?: number; longitude?: number }
  ) => {
    const response = await api.post('/attendance/clock-out', {
      shift_id: shiftId,
      profile_id: profileId,
      latitude: coords?.latitude,
      longitude: coords?.longitude,
    });
    return response.data;
  },
};

// Leave Management API
export const leaveManagementAPI = {
  submitRequest: async (data: {
    profile_id: number;
    request_type: 'vacation' | 'sick' | 'personal' | 'bereavement';
    start_date: string;
    end_date: string;
    reason?: string;
  }) => {
    const response = await api.post('/leave-management/request', data);
    return response.data;
  },
  
  getMyRequests: async () => {
    const response = await api.get('/leave-management/my-requests');
    return response.data;
  },
  
  getAllRequests: async () => {
    const response = await api.get('/leave-management/all-requests');
    return response.data;
  },
  
  getCalendar: async (startDate?: string, endDate?: string) => {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    
    const response = await api.get(`/leave-management/calendar?${params.toString()}`);
    return response.data;
  },
  
  approveRequest: async (requestId: number, adminNotes?: string, proposedStartDate?: string, proposedEndDate?: string) => {
    const response = await api.post(`/leave-management/approve/${requestId}`, {
      admin_notes: adminNotes,
      proposed_start_date: proposedStartDate,
      proposed_end_date: proposedEndDate
    });
    return response.data;
  },
  
  denyRequest: async (requestId: number, adminNotes?: string) => {
    const response = await api.post(`/leave-management/deny/${requestId}`, {
      admin_notes: adminNotes
    });
    return response.data;
  },
  
  proposeVacationDates: async (requestId: number, proposedStartDate: string, proposedEndDate: string, adminNotes?: string) => {
    const response = await api.post(`/leave-management/propose/${requestId}`, {
      proposed_start_date: proposedStartDate,
      proposed_end_date: proposedEndDate,
      admin_notes: adminNotes
    });
    return response.data;
  },
  
  acceptModifiedRequest: async (requestId: number) => {
    const response = await api.post(`/leave-management/accept-modified/${requestId}`);
    return response.data;
  },
  
  resendRequest: async (requestId: number, data?: {
    request_type?: 'vacation' | 'sick' | 'personal' | 'bereavement';
    start_date?: string;
    end_date?: string;
    reason?: string;
  }) => {
    const response = await api.post(`/leave-management/resend/${requestId}`, data);
    return response.data;
  }
};

export default api;

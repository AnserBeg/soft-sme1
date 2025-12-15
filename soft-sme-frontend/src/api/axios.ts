import axios from 'axios';
import { getApiConfig } from '../config/api';

const apiConfig = getApiConfig();
const TENANT_ID =
  (import.meta.env.VITE_TENANT_ID ?? import.meta.env.VITE_COMPANY_ID)?.toString().trim() || '';

const safeDispatch = (name: string, detail?: Record<string, unknown>) => {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    // Ignore dispatch failures (e.g., during SSR or restricted envs)
  }
};

const handleSessionExpiry = () => {
  localStorage.setItem('authRedirectMessage', 'Your session expired. Please sign in again.');
  safeDispatch('auth:expired');
  localStorage.removeItem('sessionToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  window.location.href = '/login';
};

let refreshPromise: Promise<string | null> | null = null;

const api = axios.create({
  baseURL: apiConfig.baseURL,
  timeout: apiConfig.timeout,
  withCredentials: true,
});

// Request interceptor to add auth token and device ID
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('sessionToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (TENANT_ID) {
      config.headers['x-tenant-id'] = TENANT_ID;
    }
    
    const deviceId = localStorage.getItem('deviceId');
    if (deviceId) {
      config.headers['x-device-id'] = deviceId;
    }

    try {
      const timeZone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
      if (timeZone) {
        config.headers['x-timezone'] = timeZone;
      }
    } catch {
      // Ignore timezone resolution errors and skip header when unavailable
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle auth errors and token refresh
api.interceptors.response.use(
  (response) => {
    try {
      (window as any).__backendUnavailableSince = undefined;
      safeDispatch('backend:available');
      safeDispatch('connectivity:online');
      // Kick a background sync if hookup exists
      const trigger = (window as any).__triggerSync;
      if (typeof trigger === 'function') {
        setTimeout(() => {
          try { trigger(); } catch { /* noop */ }
        }, 0);
      }
    } catch {/* noop */}
    return response;
  },
  async (error) => {
    // Mark backend availability flag for UI/sync heuristics
    try {
      const status = error?.response?.status;
      const networkDown = !error.response && (error.code === 'ECONNABORTED' || error.message?.includes('Network Error'));
      if ((typeof status === 'number' && status >= 500) || networkDown) {
        (window as any).__backendUnavailableSince = (window as any).__backendUnavailableSince || Date.now();
        safeDispatch('backend:unavailable', { status, networkDown });
        safeDispatch('connectivity:offline', { reason: 'backend' });
      }
      if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
        safeDispatch('connectivity:offline', { reason: 'network' });
      }
    } catch { /* noop */ }
    const originalRequest = error.config;

    // If refresh itself is rejected with 401, stop the loop and force logout
    if (error.response?.status === 401 && originalRequest?.url?.includes('/api/auth/refresh')) {
      handleSessionExpiry();
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          if (!refreshPromise) {
            refreshPromise = api
              .post('/api/auth/refresh', { refreshToken })
              .then((response) => {
                const { sessionToken, refreshToken: newRefreshToken } = response.data;
                localStorage.setItem('sessionToken', sessionToken);
                localStorage.setItem('refreshToken', newRefreshToken);
                api.defaults.headers.common['Authorization'] = `Bearer ${sessionToken}`;
                return sessionToken;
              })
              .catch((refreshError) => {
                handleSessionExpiry();
                throw refreshError;
              })
              .finally(() => {
                refreshPromise = null;
              });
          }

          await refreshPromise;
          return api(originalRequest);
        } catch (refreshError) {
          return Promise.reject(refreshError);
        }
      } else {
        // No refresh token, logout user
        handleSessionExpiry();
      }
    }
    // Surface meaningful errors to the UI
    const message =
      error?.response?.data?.message ||
      error?.message ||
      'Request failed. Please check your connection and try again.';
    safeDispatch('app:error', { message });
    return Promise.reject(error);
  }
);

export default api;

import axios from 'axios';
import { getApiConfig } from '../config/api';

const apiConfig = getApiConfig();

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
      }
    } catch { /* noop */ }
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const response = await api.post('/api/auth/refresh', { refreshToken });
          const { sessionToken, refreshToken: newRefreshToken } = response.data;

          localStorage.setItem('sessionToken', sessionToken);
          localStorage.setItem('refreshToken', newRefreshToken);
          api.defaults.headers.common['Authorization'] = `Bearer ${sessionToken}`;

          return api(originalRequest);
        } catch (refreshError) {
          // Refresh failed, logout user
          localStorage.removeItem('sessionToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          window.location.href = '/login';
          return Promise.reject(refreshError);
        }
      } else {
        // No refresh token, logout user
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api; 
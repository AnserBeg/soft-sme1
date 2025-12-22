import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/axios';

interface User {
  id: string;
  username: string;
  email: string;
  company_id: string;
  access_role: string;
}

interface Session {
  id: number;
  deviceInfo: {
    deviceId: string;
    deviceType: string;
    browser: string;
    os: string;
    timezone?: string;
  };
  ipAddress: string;
  userAgent: string;
  locationInfo?: {
    ip: string;
    country?: string;
    region?: string;
    city?: string;
  };
  isActive: boolean;
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (sessionToken: string, refreshToken: string, userData: User) => void;
  logout: () => void;
  logoutFromAllDevices: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
  getUserSessions: () => Promise<Session[]>;
  deactivateSession: (sessionId: number) => Promise<boolean>;
  currentDeviceId: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const normalizeRole = (role?: string | null) => (role ?? '').trim().toLowerCase();

const isMobileTimeTracker = (role?: string | null) => {
  const normalized = normalizeRole(role);
  return normalized === 'mobile time tracker' || normalized === 'mobile time tracking';
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>('');

  // Generate or retrieve device ID
  useEffect(() => {
    let deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem('deviceId', deviceId);
    }
    setCurrentDeviceId(deviceId);
  }, []);

  // Note: Axios interceptors are now handled in src/api/axios.ts

  useEffect(() => {
    // Check for tokens and user data in localStorage on mount
    const sessionToken = localStorage.getItem('sessionToken');
    const refreshToken = localStorage.getItem('refreshToken');
    const userData = localStorage.getItem('user');
    
    if (sessionToken && refreshToken && userData) {
      try {
        const parsedUser = JSON.parse(userData);
        if (isMobileTimeTracker(parsedUser?.access_role)) {
          localStorage.removeItem('sessionToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          localStorage.setItem(
            'authRedirectMessage',
            'Mobile time tracking accounts must sign in using the Clockwise Mobile app.'
          );
          return;
        }
        setUser(parsedUser);
        setIsAuthenticated(true);
        api.defaults.headers.common['Authorization'] = `Bearer ${sessionToken}`;
        
        // Set device ID header for future requests
        api.defaults.headers.common['x-device-id'] = currentDeviceId;
      } catch (error) {
        console.error('Error parsing user data:', error);
        logout();
      }
    }
  }, [currentDeviceId]);

  const login = (sessionToken: string, refreshToken: string, userData: User) => {
    if (isMobileTimeTracker(userData?.access_role)) {
      localStorage.removeItem('sessionToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      localStorage.setItem(
        'authRedirectMessage',
        'Mobile time tracking accounts must sign in using the Clockwise Mobile app.'
      );
      setUser(null);
      setIsAuthenticated(false);
      return;
    }
    localStorage.setItem('sessionToken', sessionToken);
    localStorage.setItem('refreshToken', refreshToken);
    localStorage.setItem('user', JSON.stringify(userData));
    api.defaults.headers.common['Authorization'] = `Bearer ${sessionToken}`;
    const deviceId = localStorage.getItem('deviceId');
    if (deviceId) {
      api.defaults.headers.common['x-device-id'] = deviceId;
    }
    setUser(userData);
    setIsAuthenticated(true);
  };

  const logout = () => {
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    delete api.defaults.headers.common['Authorization'];
    setUser(null);
    setIsAuthenticated(false);
  };

  const logoutFromAllDevices = async () => {
    try {
      await api.post('/api/auth/logout-all');
      logout();
    } catch (error) {
      console.error('Error logging out from all devices:', error);
      // Still logout locally even if server request fails
      logout();
    }
  };

  const refreshSession = async (): Promise<boolean> => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        return false;
      }

      const response = await api.post('/api/auth/refresh', { refreshToken });
      const { sessionToken, refreshToken: newRefreshToken } = response.data;

      localStorage.setItem('sessionToken', sessionToken);
      localStorage.setItem('refreshToken', newRefreshToken);
      api.defaults.headers.common['Authorization'] = `Bearer ${sessionToken}`;

      return true;
    } catch (error) {
      console.error('Error refreshing session:', error);
      logout();
      return false;
    }
  };

  const getUserSessions = async (): Promise<Session[]> => {
    try {
      const response = await api.get('/api/auth/sessions');
      return response.data;
    } catch (error) {
      console.error('Error fetching user sessions:', error);
      return [];
    }
  };

  const deactivateSession = async (sessionId: number): Promise<boolean> => {
    try {
      await api.delete(`/api/auth/sessions/${sessionId}`);
      return true;
    } catch (error) {
      console.error('Error deactivating session:', error);
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      login, 
      logout, 
      logoutFromAllDevices,
      refreshSession,
      getUserSessions,
      deactivateSession,
      currentDeviceId
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}; 

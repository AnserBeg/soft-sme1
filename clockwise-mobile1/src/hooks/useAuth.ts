import { useState, useEffect, createContext, useContext } from 'react';
import { authAPI } from '@/services/api';
import { useToast } from '@/hooks/use-toast';

interface User {
  id: string;
  email: string;
  access_role: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const useAuthState = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    // Check for existing session on app start
    const token = localStorage.getItem('sessionToken');
    const userData = localStorage.getItem('userData');
    
    if (token && userData) {
      try {
        const parsedUser = JSON.parse(userData);
        setUser(parsedUser);
      } catch (error) {
        // Clear invalid data
        localStorage.removeItem('sessionToken');
        localStorage.removeItem('userData');
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const response = await authAPI.login(email, password);
      
      if (response.sessionToken && response.user) {
        // Check if user has appropriate role
        const allowedRoles = ['Mobile Time Tracker', 'Time Tracking', 'Admin'];
        if (!allowedRoles.includes(response.user.access_role)) {
          toast({
            title: "Access Denied",
            description: "You don't have permission to use this app.",
            variant: "destructive",
          });
          return false;
        }

        localStorage.setItem('sessionToken', response.sessionToken);
        localStorage.setItem('userData', JSON.stringify(response.user));
        setUser(response.user);
        
        toast({
          title: "Welcome back!",
          description: `Successfully logged in as ${response.user.email}`,
        });
        
        return true;
      }
      return false;
    } catch (error: any) {
      const message = error.response?.data?.message || 'Login failed. Please try again.';
      toast({
        title: "Login Failed",
        description: message,
        variant: "destructive",
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('userData');
    setUser(null);
    toast({
      title: "Logged out",
      description: "You have been successfully logged out.",
    });
  };

  return {
    user,
    isLoading,
    login,
    logout,
    isAuthenticated: !!user,
  };
};
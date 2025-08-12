import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface PrivateRouteProps {
  children: React.ReactNode;
  requiredAccessRoles?: string[];
}

const PrivateRoute: React.FC<PrivateRouteProps> = ({ children, requiredAccessRoles }) => {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  if (requiredAccessRoles && user) {
    const hasRequiredRole = requiredAccessRoles.includes(user.access_role);
    if (!hasRequiredRole) {
      return <Navigate to="/dashboard" />;
    }
  }

  return <>{children}</>;
};

export default PrivateRoute; 
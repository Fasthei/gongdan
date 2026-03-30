import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  children: React.ReactNode;
  roles?: string[];
}

export function PrivateRoute({ children, roles }: Props) {
  const { user, isAuthenticated, isAuthReady } = useAuth();
  if (!isAuthReady) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  return <>{children}</>;
}

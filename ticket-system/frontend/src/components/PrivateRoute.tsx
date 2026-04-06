import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';

interface Props {
  children: React.ReactNode;
  roles?: string[];
}

export function PrivateRoute({ children, roles }: Props) {
  const { user, isAuthenticated, isAuthReady } = useAuth();
  const { t } = useTranslation();
  if (!isAuthReady) return <div style={{ padding: 24, textAlign: 'center' }}>{t('common.authInitializing')}</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  return <>{children}</>;
}

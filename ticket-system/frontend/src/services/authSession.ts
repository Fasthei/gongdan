export interface SessionUser {
  id: string;
  role: 'CUSTOMER' | 'OPERATOR' | 'ENGINEER' | 'ADMIN';
  username?: string;
  name?: string;
  customerCode?: string;
  tier?: 'NORMAL' | 'KEY' | 'EXCLUSIVE';
  level?: string;
}

export function getStoredUser(): SessionUser | null {
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function clearAuthStorage() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
}

export function getLoginPathByUser(user: SessionUser | null): string {
  if (!user) return '/login';
  return user.role === 'CUSTOMER' ? '/login' : '/staff/login';
}


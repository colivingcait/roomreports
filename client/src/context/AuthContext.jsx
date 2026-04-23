import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const VIEW_AS_KEY = 'roomreport:view-as-role';
// Only Owners / PMs are allowed to preview other roles. A cleaner or
// handyperson never sees this UI and can't put themselves into a
// different effective role.
const VIEW_AS_ELIGIBLE = ['OWNER', 'PM'];
const VIEW_AS_CHOICES = ['OWNER', 'PM', 'CLEANER', 'HANDYPERSON'];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [viewAsRole, setViewAsRoleState] = useState(() => {
    try { return localStorage.getItem(VIEW_AS_KEY) || null; }
    catch { return null; }
  });

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setOrganization(data.user.organization);
      } else {
        setUser(null);
        setOrganization(null);
      }
    } catch {
      setUser(null);
      setOrganization(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const setViewAsRole = useCallback((role) => {
    if (!role || !VIEW_AS_CHOICES.includes(role)) {
      try { localStorage.removeItem(VIEW_AS_KEY); } catch { /* ignore */ }
      setViewAsRoleState(null);
      return;
    }
    try { localStorage.setItem(VIEW_AS_KEY, role); } catch { /* ignore */ }
    setViewAsRoleState(role);
  }, []);

  const clearViewAs = useCallback(() => {
    try { localStorage.removeItem(VIEW_AS_KEY); } catch { /* ignore */ }
    setViewAsRoleState(null);
  }, []);

  const login = async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    clearViewAs();
    await fetchMe();
    return data;
  };

  const signup = async (payload) => {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    clearViewAs();
    await fetchMe();
    return data;
  };

  const logout = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    clearViewAs();
    setUser(null);
    setOrganization(null);
  };

  const canViewAs = !!user && VIEW_AS_ELIGIBLE.includes(user.role);
  const activeViewAs = canViewAs && viewAsRole && viewAsRole !== user?.role ? viewAsRole : null;
  const effectiveRole = activeViewAs || user?.role || null;

  return (
    <AuthContext.Provider
      value={{
        user,
        organization,
        isLoading,
        login,
        signup,
        logout,
        viewAsRole: activeViewAs,
        setViewAsRole,
        clearViewAs,
        effectiveRole,
        canViewAs,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Gate a set of routes to specific roles. If the user's *effective*
// role (real role, or the "view as" override when active) isn't
// allowed, bounce them to the dashboard — which will then render the
// correct role-specific view.
//
// This hides forbidden pages from scoped roles (Cleaner / Handyperson)
// AND from Owners / PMs who are previewing with View As, which is the
// whole point of View As.
export default function RoleRoute({ allow }) {
  const { effectiveRole, isLoading } = useAuth();
  if (isLoading) return null;
  if (!effectiveRole) return <Navigate to="/login" replace />;
  if (!allow.includes(effectiveRole)) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

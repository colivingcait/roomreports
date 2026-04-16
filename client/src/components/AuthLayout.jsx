import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AuthLayout() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#FAF8F5' }}>
        <p style={{ color: '#4A4543', fontSize: '1.1rem' }}>Loading...</p>
      </div>
    );
  }

  if (user) {
    const home = user.role === 'RESIDENT' ? '/resident' : '/dashboard';
    return <Navigate to={home} replace />;
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <h1>RoomReport</h1>
          <p>Property inspections made simple</p>
        </div>
        <Outlet />
      </div>
    </div>
  );
}

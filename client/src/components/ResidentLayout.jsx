import { Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ResidentLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="resident-layout">
      <header className="resident-header">
        <span className="resident-brand">RoomReport</span>
        <button className="btn-text" onClick={logout}>Sign out</button>
      </header>
      <main className="resident-main">
        <Outlet />
      </main>
    </div>
  );
}

import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AppLayout() {
  const { user, organization, logout } = useAuth();

  return (
    <div className="app-layout">
      <nav className="app-nav">
        <div className="app-nav-left">
          <span className="app-nav-brand">RoomReport</span>
          <NavLink to="/dashboard" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Dashboard</NavLink>
          <NavLink to="/properties" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Properties</NavLink>
          <NavLink to="/inspections" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>Inspections</NavLink>
        </div>
        <div className="app-nav-right">
          <span className="nav-org">{organization?.name}</span>
          <span className="nav-user">{user?.name}</span>
          <button className="btn-text" onClick={logout}>Sign out</button>
        </div>
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

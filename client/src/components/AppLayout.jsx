import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import SearchBar from './SearchBar';
import OfflineBanner from './OfflineBanner';

const COLLAPSE_KEY = 'roomreport:sidebar-collapsed';

// SVG icons as inline components
const icons = {
  dashboard: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  maintenance: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>,
  properties: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 9.5L12 3l9 6.5"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>,
  reports: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>,
  more: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>,
  search: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
  logout: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
};

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', roles: ['OWNER', 'PM'] },
  { path: '/maintenance', label: 'Maintenance', icon: 'maintenance', roles: ['OWNER', 'PM'] },
  { path: '/properties', label: 'Properties', icon: 'properties', roles: ['OWNER', 'PM'] },
  { path: '/reports', label: 'Reports', icon: 'reports', roles: ['OWNER', 'PM'] },
  { path: '/more', label: 'More', icon: 'more', roles: ['OWNER', 'PM'] },
];

export default function AppLayout() {
  const { user, organization, logout } = useAuth();
  const navigate = useNavigate();
  const [showSearch, setShowSearch] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; }
    catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); }
    catch { /* ignore */ }
  }, [collapsed]);

  const filteredNav = NAV_ITEMS.filter((item) => item.roles.includes(user?.role));

  const initials = user?.name?.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?';
  const isBeta = !!organization?.isBeta;

  return (
    <div className={`shell ${collapsed ? 'shell-collapsed' : ''}`}>
      {/* Desktop Sidebar */}
      <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="sidebar-top">
          <div
            className="sidebar-brand"
            onClick={() => navigate('/dashboard')}
            title="Dashboard"
          >
            <span className="sidebar-brand-text">RoomReport</span>
            {!collapsed && isBeta && <span className="beta-badge">Beta</span>}
          </div>

          {!collapsed && (
            <div className="sidebar-search" onClick={() => setShowSearch(true)}>
              {icons.search}
              <span>Search</span>
            </div>
          )}

          <nav className="sidebar-nav">
            {filteredNav.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                {icons[item.icon]}
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{initials}</div>
            {!collapsed && (
              <div className="sidebar-user-info">
                <span className="sidebar-user-name">{user?.name}</span>
                <span className="sidebar-user-org">{organization?.name}</span>
              </div>
            )}
          </div>
          <button
            className="sidebar-collapse-btn"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: collapsed ? 'rotate(180deg)' : 'none' }}
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>Collapse</span>
          </button>
          <button className="sidebar-logout" onClick={logout} title="Sign out">
            {icons.logout}
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="mobile-header">
        <span className="mobile-brand">
          RoomReport
          {isBeta && <span className="beta-badge">Beta</span>}
        </span>
        <div className="mobile-header-actions">
          <button className="mobile-header-btn" onClick={() => setShowSearch(true)}>
            {icons.search}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="shell-main">
        <OfflineBanner />
        <Outlet />
      </main>

      {/* Mobile Bottom Tabs */}
      <nav className="bottom-tabs">
        {filteredNav.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `bottom-tab ${isActive ? 'active' : ''}`}
          >
            {icons[item.icon]}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Search Overlay */}
      {showSearch && (
        <div className="search-overlay">
          <div className="search-overlay-backdrop" onClick={() => setShowSearch(false)} />
          <SearchBar onClose={() => setShowSearch(false)} />
        </div>
      )}
    </div>
  );
}

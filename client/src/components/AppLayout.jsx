import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import SearchBar from './SearchBar';
import OfflineBanner from './OfflineBanner';
import NewMaintenance from './NewMaintenance';
import NotificationBell from './NotificationBell';
import { ROLE_LABELS } from '../../../shared/index.js';

const COLLAPSE_KEY = 'roomreport:sidebar-collapsed';

const icons = {
  dashboard: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  maintenance: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>,
  properties: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 9.5L12 3l9 6.5"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>,
  reports: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>,
  financials: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  more: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>,
  report: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12" y2="16"/></svg>,
  search: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
  logout: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
};

// Role → ordered nav items. The "Report Issue" entry is an action button
// (not a route) — it opens the New Maintenance modal.
const ROLE_NAV = {
  OWNER: [
    { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { path: '/maintenance', label: 'Maintenance', icon: 'maintenance' },
    { path: '/properties', label: 'Properties', icon: 'properties' },
    { path: '/financials', label: 'Financials', icon: 'financials' },
    { path: '/reports', label: 'Reports', icon: 'reports' },
    { path: '/more', label: 'More', icon: 'more' },
  ],
  PM: [
    { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { path: '/maintenance', label: 'Maintenance', icon: 'maintenance' },
    { path: '/properties', label: 'Properties', icon: 'properties' },
    { path: '/financials', label: 'Financials', icon: 'financials' },
    { path: '/reports', label: 'Reports', icon: 'reports' },
    { path: '/more', label: 'More', icon: 'more' },
  ],
  HANDYPERSON: [
    { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { path: '/maintenance', label: 'Maintenance', icon: 'maintenance' },
    { action: 'report', label: 'Report Issue', icon: 'report' },
  ],
  CLEANER: [
    { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { action: 'report', label: 'Report Issue', icon: 'report' },
  ],
};

const VIEW_AS_OPTIONS = [
  { value: 'OWNER', label: 'Owner view' },
  { value: 'PM', label: 'Property Manager' },
  { value: 'CLEANER', label: 'Cleaner' },
  { value: 'HANDYPERSON', label: 'Handyperson' },
];

export default function AppLayout() {
  const {
    user,
    organization,
    logout,
    effectiveRole,
    viewAsRole,
    clearViewAs,
  } = useAuth();
  const navigate = useNavigate();
  const [showSearch, setShowSearch] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; }
    catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); }
    catch { /* ignore */ }
  }, [collapsed]);

  const roleNav = ROLE_NAV[effectiveRole] || ROLE_NAV.OWNER;
  const reportInNav = roleNav.some((n) => n.action === 'report');

  const initials = user?.name?.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?';
  const isBeta = !!organization?.isBeta;
  const viewAsLabel = viewAsRole ? (ROLE_LABELS[viewAsRole] || viewAsRole) : null;

  // On mobile, search is reached via the mobile-header icon, so we
  // render it the same way for all roles. Scoped roles never see the
  // main-search surface.
  const showSearchAffordance = effectiveRole === 'OWNER' || effectiveRole === 'PM';

  const handleNavAction = (action) => {
    if (action === 'report') setShowReport(true);
  };

  return (
    <div className={`shell ${collapsed ? 'shell-collapsed' : ''}`}>
      <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="sidebar-top">
          <div className="sidebar-brand-row">
            <div
              className="sidebar-brand"
              onClick={() => navigate('/dashboard')}
              title="Dashboard"
            >
              <span className="sidebar-brand-text">RoomReport</span>
              {!collapsed && isBeta && <span className="beta-badge">Beta</span>}
            </div>
            {!collapsed && <NotificationBell />}
          </div>

          {!collapsed && showSearchAffordance && (
            <div className="sidebar-search" onClick={() => setShowSearch(true)}>
              {icons.search}
              <span>Search</span>
            </div>
          )}

          <nav className="sidebar-nav">
            {roleNav.map((item) => {
              if (item.action) {
                return (
                  <button
                    key={item.action}
                    type="button"
                    onClick={() => handleNavAction(item.action)}
                    className="sidebar-link sidebar-link-action"
                    title={collapsed ? item.label : undefined}
                  >
                    {icons[item.icon]}
                    <span>{item.label}</span>
                  </button>
                );
              }
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                  title={collapsed ? item.label : undefined}
                >
                  {icons[item.icon]}
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
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

      <header className="mobile-header">
        <span className="mobile-brand">
          RoomReport
          {isBeta && <span className="beta-badge">Beta</span>}
        </span>
        <div className="mobile-header-actions">
          <NotificationBell compact />
          {showSearchAffordance && (
            <button className="mobile-header-btn" onClick={() => setShowSearch(true)}>
              {icons.search}
            </button>
          )}
        </div>
      </header>

      <main className="shell-main">
        {viewAsRole && (
          <div className="view-as-banner">
            <span>
              Viewing as <strong>{viewAsLabel}</strong> — this is a preview, no data has changed.
            </span>
            <button
              type="button"
              className="view-as-banner-exit"
              onClick={() => { clearViewAs(); }}
            >
              Exit view-as
            </button>
          </div>
        )}
        <OfflineBanner />
        <Outlet />
      </main>

      <nav className="bottom-tabs">
        {roleNav.map((item) => {
          if (item.action) {
            return (
              <button
                key={item.action}
                type="button"
                onClick={() => handleNavAction(item.action)}
                className="bottom-tab"
              >
                {icons[item.icon]}
                <span>{item.label}</span>
              </button>
            );
          }
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `bottom-tab ${isActive ? 'active' : ''}`}
            >
              {icons[item.icon]}
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {showSearch && (
        <div className="search-overlay">
          <div className="search-overlay-backdrop" onClick={() => setShowSearch(false)} />
          <SearchBar onClose={() => setShowSearch(false)} />
        </div>
      )}

      {reportInNav && (
        <NewMaintenance
          open={showReport}
          onClose={() => setShowReport(false)}
          onCreated={() => setShowReport(false)}
        />
      )}
    </div>
  );
}

export { VIEW_AS_OPTIONS };

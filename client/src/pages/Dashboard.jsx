import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import StartInspection from '../components/StartInspection';

const TYPE_LABELS = {
  COMMON_AREA: 'Common Area', ROOM_TURN: 'Room Turn', QUARTERLY: 'Quarterly',
  RESIDENT_SELF_CHECK: 'Self-Check', MOVE_IN_OUT: 'Move-In/Out',
};

const MAINT_STATUS_COLORS = {
  OPEN: '#C4703F', ASSIGNED: '#6B8F71', IN_PROGRESS: '#C9A84C', RESOLVED: '#B5B1AF',
};
const MAINT_STATUS_LABELS = { OPEN: 'Open', ASSIGNED: 'Assigned', IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved' };

const HEALTH_LABELS = { healthy: 'Healthy', watch: 'Watch', attention: 'Needs Attention' };
const HEALTH_COLORS = { healthy: '#6B8F71', watch: '#C9A84C', attention: '#C4703F' };

function timeAgo(date) {
  if (!date) return 'Never';
  const d = new Date(date);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showStart, setShowStart] = useState(false);
  const [notification, setNotification] = useState(location.state?.notification || '');

  useEffect(() => {
    fetch('/api/dashboard', { credentials: 'include' })
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (notification) {
      const t = setTimeout(() => setNotification(''), 5000);
      return () => clearTimeout(t);
    }
  }, [notification]);

  if (loading) return <div className="page-loading">Loading dashboard...</div>;
  if (!data) return null;

  const { pendingReview = [], maintenance = {}, propertyHealth = [] } = data;
  const statusCounts = maintenance.statusCounts || {};

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-subtitle">Welcome back, {user?.name}</p>
        </div>
        <button className="btn-primary-sm" onClick={() => setShowStart(true)}>
          + New Inspection
        </button>
      </div>

      {notification && (
        <div className="notification-bar">{notification}</div>
      )}

      {/* ─── 1. PENDING REVIEW ─── */}
      <section className="dash-section dash-pending">
        <div className="dash-section-header">
          <h2>
            Pending Review
            {pendingReview.length > 0 && <span className="dash-count-badge">{pendingReview.length}</span>}
          </h2>
        </div>

        {pendingReview.length === 0 ? (
          <div className="dash-caught-up">
            <span className="dash-caught-up-icon">&#10003;</span>
            <span>All caught up</span>
          </div>
        ) : (
          <div className="pending-grid">
            {pendingReview.map((p) => (
              <div key={p.id} className="pending-card" onClick={() => navigate(`/inspections/${p.id}/review`)}>
                <div className="pending-card-top">
                  <span className="dash-type-badge">{TYPE_LABELS[p.type] || p.type}</span>
                  {p.flagCount > 0 && (
                    <span className="pending-flag-count">&#9873; {p.flagCount} issue{p.flagCount !== 1 ? 's' : ''}</span>
                  )}
                </div>
                <h3 className="pending-card-title">
                  {p.propertyName}
                  {p.roomLabel && <span className="pending-card-room"> / {p.roomLabel}</span>}
                </h3>
                <div className="pending-card-meta">
                  <span>{p.inspectorName} ({p.inspectorRole})</span>
                  <span className="dot" />
                  <span>{timeAgo(p.completedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ─── 2. MAINTENANCE OVERVIEW ─── */}
      <section className="dash-section">
        <div className="dash-section-header">
          <h2>Maintenance This Month</h2>
          <button className="btn-text-sm" onClick={() => navigate('/maintenance')}>
            View All &rarr;
          </button>
        </div>

        <div className="maint-stats-grid">
          {['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'].map((s) => (
            <button
              key={s}
              className="maint-stat-card"
              onClick={() => navigate(`/maintenance?status=${s}`)}
              style={{ borderLeftColor: MAINT_STATUS_COLORS[s] }}
            >
              <span className="maint-stat-count" style={{ color: MAINT_STATUS_COLORS[s] }}>
                {statusCounts[s] || 0}
              </span>
              <span className="maint-stat-label">{MAINT_STATUS_LABELS[s]}</span>
            </button>
          ))}
        </div>

        {maintenance.recentOpen?.length > 0 && (
          <div className="dash-maint-list" style={{ marginTop: '1rem' }}>
            {maintenance.recentOpen.map((m) => (
              <div key={m.id} className="dash-maint-row" onClick={() => navigate('/maintenance')}>
                <div className="dash-maint-left">
                  <span className="dash-maint-desc">{m.description}</span>
                  <span className="dash-maint-meta">
                    {m.propertyName}{m.roomLabel ? ` / ${m.roomLabel}` : ''} &middot; {m.zone}
                  </span>
                </div>
                <div className="dash-maint-right">
                  {m.priority && (
                    <span className={`dash-priority dash-priority-${m.priority.toLowerCase()}`}>
                      {m.priority}
                    </span>
                  )}
                  <span
                    className="insp-status-badge"
                    style={{ color: MAINT_STATUS_COLORS[m.status], borderColor: MAINT_STATUS_COLORS[m.status] }}
                  >
                    {MAINT_STATUS_LABELS[m.status]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ─── 3. PROPERTY HEALTH ─── */}
      <section className="dash-section">
        <div className="dash-section-header">
          <h2>Property Health</h2>
          <button className="btn-text-sm" onClick={() => navigate('/properties')}>View All &rarr;</button>
        </div>

        {propertyHealth.length === 0 ? (
          <p className="empty-text" style={{ padding: '0.5rem 0' }}>No properties yet</p>
        ) : (
          <div className="health-list">
            {propertyHealth.map((p) => (
              <div key={p.id} className="health-row" onClick={() => navigate(`/properties/${p.id}`)}>
                <div className="health-indicator" style={{ background: HEALTH_COLORS[p.health] }} />
                <div className="health-info">
                  <div className="health-name">{p.name}</div>
                  <div className="health-meta">
                    {p.openMaintenanceCount > 0
                      ? `${p.openMaintenanceCount} open maintenance`
                      : 'No open issues'}
                    {p.urgentCount > 0 && (
                      <span className="health-urgent"> &middot; {p.urgentCount} urgent</span>
                    )}
                    {p.pendingReviewCount > 0 && (
                      <span className="health-pending"> &middot; {p.pendingReviewCount} pending review</span>
                    )}
                  </div>
                </div>
                <span className="health-label" style={{ color: HEALTH_COLORS[p.health] }}>
                  {HEALTH_LABELS[p.health]}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <StartInspection open={showStart} onClose={() => setShowStart(false)} />
    </div>
  );
}

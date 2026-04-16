import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import StartInspection from '../components/StartInspection';

const TYPE_LABELS = {
  COMMON_AREA: 'Common Area',
  ROOM_TURN: 'Room Turn',
  QUARTERLY: 'Quarterly',
  RESIDENT_SELF_CHECK: 'Self-Check',
  MOVE_IN_OUT: 'Move-In/Out',
};

const STATUS_COLORS = { DRAFT: '#C4703F', SUBMITTED: '#6B8F71', REVIEWED: '#8A8583' };
const MAINT_STATUS_COLORS = { OPEN: '#C4703F', ASSIGNED: '#6B8F71', IN_PROGRESS: '#C9A84C', RESOLVED: '#B5B1AF' };

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
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showStart, setShowStart] = useState(false);

  useEffect(() => {
    fetch('/api/dashboard', { credentials: 'include' })
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-loading">Loading dashboard...</div>;
  if (!data) return null;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Welcome back, {user?.name}</h1>
          <p className="page-subtitle">Here&apos;s your overview</p>
        </div>
        <button className="btn-primary-sm" onClick={() => setShowStart(true)}>
          + New Inspection
        </button>
      </div>

      {/* ─── Properties Overview ────────────────────────── */}
      <section className="dash-section">
        <div className="dash-section-header">
          <h2>Properties</h2>
          <button className="btn-text-sm" onClick={() => navigate('/properties')}>View All</button>
        </div>

        {data.properties.length === 0 ? (
          <div className="empty-state" style={{ padding: '1.5rem' }}>
            <p>No properties yet</p>
            <button className="btn-primary-sm" onClick={() => navigate('/properties')}>Add Property</button>
          </div>
        ) : (
          <div className="dash-property-grid">
            {data.properties.map((p) => (
              <div key={p.id} className="dash-property-card" onClick={() => navigate(`/properties/${p.id}`)}>
                <div className="dash-prop-top">
                  <h3>{p.name}</h3>
                  {p.openMaintenanceCount > 0 && (
                    <span className="dash-maint-badge">{p.openMaintenanceCount}</span>
                  )}
                </div>
                <div className="dash-prop-meta">
                  <span>{p.roomCount} room{p.roomCount !== 1 ? 's' : ''}</span>
                  <span className="dot" />
                  <span>Inspected {timeAgo(p.lastInspectionDate)}</span>
                </div>
                <button
                  className="dash-inspect-btn"
                  onClick={(e) => { e.stopPropagation(); setShowStart(true); }}
                >
                  Inspect
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="dash-grid-2">
        {/* ─── Recent Inspections ──────────────────────── */}
        <section className="dash-section">
          <div className="dash-section-header">
            <h2>Recent Inspections</h2>
            <button className="btn-text-sm" onClick={() => navigate('/inspections')}>View All</button>
          </div>

          {data.recentInspections.length === 0 ? (
            <p className="empty-text" style={{ padding: '1rem 0' }}>No inspections yet</p>
          ) : (
            <div className="dash-insp-list">
              {data.recentInspections.map((insp) => (
                <div key={insp.id} className="dash-insp-row" onClick={() => navigate(`/inspections/${insp.id}`)}>
                  <div className="dash-insp-left">
                    <span className="dash-type-badge">{TYPE_LABELS[insp.type] || insp.type}</span>
                    <div className="dash-insp-info">
                      <span className="dash-insp-prop">{insp.propertyName}{insp.roomLabel ? ` — ${insp.roomLabel}` : ''}</span>
                      <span className="dash-insp-inspector">{insp.inspectorName} ({insp.inspectorRole})</span>
                    </div>
                  </div>
                  <div className="dash-insp-right">
                    {insp.flagCount > 0 && (
                      <span className="dash-flag-count">&#9873; {insp.flagCount}</span>
                    )}
                    <span
                      className="insp-status-badge"
                      style={{ color: STATUS_COLORS[insp.status], borderColor: STATUS_COLORS[insp.status] }}
                    >
                      {insp.status}
                    </span>
                    <span className="dash-insp-date">{timeAgo(insp.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─── Open Maintenance ────────────────────────── */}
        <section className="dash-section">
          <div className="dash-section-header">
            <h2>Open Maintenance</h2>
            <button className="btn-text-sm" onClick={() => navigate('/maintenance')}>
              View All ({data.totalOpenMaintenance})
            </button>
          </div>

          {data.openMaintenance.length === 0 ? (
            <p className="empty-text" style={{ padding: '1rem 0' }}>No open items</p>
          ) : (
            <div className="dash-maint-list">
              {data.openMaintenance.map((m) => (
                <div key={m.id} className="dash-maint-row" onClick={() => navigate('/maintenance')}>
                  <div className="dash-maint-left">
                    <span className="dash-maint-desc">{m.description}</span>
                    <span className="dash-maint-meta">
                      {m.propertyName}{m.roomLabel ? ` — ${m.roomLabel}` : ''} &middot; {m.zone}
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
                      {m.status.replace('_', ' ')}
                    </span>
                    <span className="dash-maint-date">{timeAgo(m.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <StartInspection open={showStart} onClose={() => setShowStart(false)} />
    </div>
  );
}

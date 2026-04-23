import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import StartInspection from '../components/StartInspection';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';
import CleanerDashboard from './CleanerDashboard';
import HandypersonDashboard from './HandypersonDashboard';
import { VIEW_AS_OPTIONS } from '../components/AppLayout';

const WIDGET_STORE_KEY = 'roomreport:dashboard-widgets';
const DEFAULT_WIDGETS = {
  pendingReview: true,
  maintenanceMonth: true,
  propertyHealth: true,
  needsAttention: true,
  recentActivity: true,
};
const WIDGET_LABELS = {
  pendingReview: 'Pending Review',
  maintenanceMonth: 'Maintenance This Month',
  propertyHealth: 'Property Health',
  needsAttention: 'Needs Attention',
  recentActivity: 'Recent Activity',
};

const TYPE_LABELS = {
  COMMON_AREA: 'Common Area', COMMON_AREA_QUICK: 'Common Area Quick Check',
  ROOM_TURN: 'Room Turn', QUARTERLY: 'Room Inspection',
  RESIDENT_SELF_CHECK: 'Self-Check', MOVE_IN_OUT: 'Move-In',
};
const TYPE_COLORS = {
  QUARTERLY: { bg: '#E8F0E9', color: '#3B6D11' },
  ROOM_TURN: { bg: '#FAEEDA', color: '#854F0B' },
  COMMON_AREA: { bg: '#E3EDF7', color: '#2B5F8A' },
  COMMON_AREA_QUICK: { bg: '#E3EDF7', color: '#2B5F8A' },
  RESIDENT_SELF_CHECK: { bg: '#F5E8F0', color: '#8A2B6D' },
  MOVE_IN_OUT: { bg: '#F0E8E3', color: '#6D3B11' },
};

function daysAgo(date) {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date)) / (1000 * 60 * 60 * 24));
}

function timeLabel(date) {
  if (!date) return 'Never';
  const d = daysAgo(date);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Dashboard() {
  const { effectiveRole, canViewAs, viewAsRole, setViewAsRole, user } = useAuth();

  // Route to a role-specific dashboard when the effective role is scoped.
  if (effectiveRole === 'CLEANER') return <CleanerDashboard />;
  if (effectiveRole === 'HANDYPERSON') return <HandypersonDashboard />;

  return (
    <OwnerDashboard
      canViewAs={canViewAs}
      viewAsRole={viewAsRole}
      setViewAsRole={setViewAsRole}
      realRole={user?.role}
    />
  );
}

function OwnerDashboard({ canViewAs, viewAsRole, setViewAsRole, realRole }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showStart, setShowStart] = useState(false);
  const [notification, setNotification] = useState(location.state?.notification || '');
  const [showWidgetSettings, setShowWidgetSettings] = useState(false);
  const [widgets, setWidgets] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(WIDGET_STORE_KEY) || 'null');
      return stored ? { ...DEFAULT_WIDGETS, ...stored } : DEFAULT_WIDGETS;
    } catch {
      return DEFAULT_WIDGETS;
    }
  });

  // Only honor the toggles on desktop — on mobile everything shows stacked.
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
  );
  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleWidget = (key) => {
    const next = { ...widgets, [key]: !widgets[key] };
    setWidgets(next);
    try { localStorage.setItem(WIDGET_STORE_KEY, JSON.stringify(next)); }
    catch { /* ignore */ }
  };
  const isWidgetOn = (key) => (isDesktop ? widgets[key] !== false : true);

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

  const {
    pendingReview = [],
    recentInspectionActivity = [],
    maintenance = {},
    propertyHealth = [],
    overdueRooms = [],
  } = data;
  const sc = maintenance.statusCounts || {};

  const startQuarterly = (propertyId, roomId) => {
    fetch('/api/inspections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type: 'QUARTERLY', propertyId, roomId }),
    })
      .then((r) => r.json())
      .then((d) => { if (d.inspection) navigate(`/inspections/${d.inspection.id}`); });
  };

  // ── Top metrics ──
  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  });

  const openMaint =
    (sc.OPEN || 0) + (sc.ASSIGNED || 0) + (sc.IN_PROGRESS || 0);
  const activeViolations = (propertyHealth || []).reduce(
    (acc, p) => acc + (p.activeViolationCount || 0), 0,
  );
  const avgResolutionDays = data?.maintenance?.avgResolutionDays ?? data?.avgResolutionDays ?? null;

  const pendingTone =
    pendingReview.length > 0 ? 'db-metric-value-terracotta' : 'db-metric-value-good';
  const openTone =
    openMaint > 5 ? 'db-metric-value-danger'
    : openMaint > 0 ? 'db-metric-value-terracotta'
    : 'db-metric-value-good';
  const violTone =
    activeViolations > 3 ? 'db-metric-value-danger'
    : activeViolations > 0 ? 'db-metric-value-terracotta'
    : 'db-metric-value-good';
  const avgTone =
    avgResolutionDays == null ? ''
    : avgResolutionDays > 5 ? 'db-metric-value-danger'
    : avgResolutionDays > 3 ? 'db-metric-value-terracotta'
    : 'db-metric-value-good';

  return (
    <div className="db-page page-container">
      <div className="db-top page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">{todayLabel}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          {canViewAs && (
            <select
              className="view-as-picker"
              value={viewAsRole || realRole || 'OWNER'}
              onChange={(e) => {
                const v = e.target.value;
                if (!v || v === realRole) {
                  setViewAsRole(null);
                } else {
                  setViewAsRole(v);
                }
              }}
              title="Preview the app as another role"
            >
              {VIEW_AS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  View as: {opt.label}
                </option>
              ))}
            </select>
          )}
          <button className="btn-primary-sm" onClick={() => setShowStart(true)}>+ New Inspection</button>
          {isDesktop && (
            <button
              className="btn-secondary-sm db-widget-gear"
              onClick={() => setShowWidgetSettings(true)}
              title="Customize widgets"
              aria-label="Customize widgets"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {notification && <div className="notification-bar">{notification}</div>}

      {/* Four metric cards across the top */}
      <div className="db-metrics">
        <div className="db-metric">
          <div className="db-metric-label">Pending review</div>
          <div className={`db-metric-value ${pendingTone}`}>{pendingReview.length}</div>
        </div>
        <div className="db-metric">
          <div className="db-metric-label">Open maintenance</div>
          <div className={`db-metric-value ${openTone}`}>{openMaint}</div>
        </div>
        <div className="db-metric">
          <div className="db-metric-label">Active violations</div>
          <div className={`db-metric-value ${violTone}`}>{activeViolations}</div>
        </div>
        <div className="db-metric">
          <div className="db-metric-label">Avg resolution time</div>
          <div className={`db-metric-value ${avgTone}`}>
            {avgResolutionDays != null ? `${avgResolutionDays.toFixed(1)}d` : '—'}
          </div>
        </div>
      </div>

      <div className="db-grid">

        {/* ── TOP LEFT: PENDING REVIEW ── */}
        {isWidgetOn('pendingReview') && (
        <div className="db-card">
          <div className="db-card-head">
            <div className="db-card-title db-terracotta">
              PENDING REVIEW
              {pendingReview.length > 0 && <span className="db-badge db-badge-terracotta">{pendingReview.length}</span>}
            </div>
            {pendingReview.length > 0 && (
              <button className="db-link" onClick={() => navigate('/inspections?status=SUBMITTED')}>View all &rarr;</button>
            )}
          </div>
          <div className="db-card-body">
            {pendingReview.length === 0 ? (
              <div className="db-empty">✓ All caught up</div>
            ) : (
              pendingReview.slice(0, 4).map((p) => {
                const tc = TYPE_COLORS[p.type] || { bg: '#F5F2EF', color: '#4A4543' };
                const onClick = () => {
                  if (p.isGroup) {
                    navigate(`/quarterly-review/${p.propertyId}/${p.dateKey}`);
                  } else {
                    navigate(`/inspections/${p.id}/review`);
                  }
                };
                const subtitle = p.isGroup
                  ? `${p.roomCount} rooms${p.flagCount > 0 ? ` \u00b7 ${p.flagCount} flags` : ''}`
                  : timeLabel(p.completedAt);
                return (
                  <div key={p.id} className="db-row" onClick={onClick}>
                    <div className="db-row-left">
                      <span className="db-type-pill" style={{ background: tc.bg, color: tc.color }}>
                        {TYPE_LABELS[p.type] || p.type}
                      </span>
                      <div>
                        <div className="db-row-title">
                          {p.propertyName}{!p.isGroup && p.roomLabel ? ` \u2192 ${p.roomLabel}` : ''}
                        </div>
                        <div className="db-row-sub">{subtitle}</div>
                      </div>
                    </div>
                    {p.flagCount > 0 && !p.isGroup && (
                      <span className="db-flag">&para; {p.flagCount}</span>
                    )}
                    {p.isGroup && (
                      <span className="db-flag">{timeLabel(p.completedAt)}</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
        )}

        {/* ── TOP RIGHT: MAINTENANCE THIS MONTH ── */}
        {isWidgetOn('maintenanceMonth') && (
        <div className="db-card">
          <div className="db-card-head">
            <div className="db-card-title db-sage">MAINTENANCE THIS MONTH</div>
            <button className="db-link" onClick={() => navigate('/maintenance')}>View board &rarr;</button>
          </div>
          <div className="db-card-body">
            <div className="db-stat-grid">
              <button className="db-stat db-stat-open" onClick={() => navigate('/maintenance?status=OPEN')}>
                <span className="db-stat-num">{sc.OPEN || 0}</span>
                <span className="db-stat-label">OPEN</span>
              </button>
              <button className="db-stat db-stat-assigned" onClick={() => navigate('/maintenance?status=ASSIGNED')}>
                <span className="db-stat-num">{sc.ASSIGNED || 0}</span>
                <span className="db-stat-label">ASSIGNED</span>
              </button>
              <button className="db-stat db-stat-progress" onClick={() => navigate('/maintenance?status=IN_PROGRESS')}>
                <span className="db-stat-num">{sc.IN_PROGRESS || 0}</span>
                <span className="db-stat-label">IN PROGRESS</span>
              </button>
              <button className="db-stat db-stat-resolved" onClick={() => navigate('/maintenance?status=RESOLVED')}>
                <span className="db-stat-num">{sc.RESOLVED || 0}</span>
                <span className="db-stat-label">RESOLVED</span>
              </button>
            </div>
          </div>
        </div>
        )}

        {/* ── BOTTOM LEFT: PROPERTY HEALTH ── */}
        {isWidgetOn('propertyHealth') && (
        <div className="db-card">
          <div className="db-card-head">
            <div className="db-card-title db-sage">PROPERTY HEALTH</div>
          </div>
          <div className="db-card-body">
            {propertyHealth.length === 0 ? (
              <div className="db-empty">No properties yet</div>
            ) : (
              propertyHealth.map((p) => {
                const dotColor = p.health === 'red' ? '#C0392B' : p.health === 'yellow' ? '#D4A017' : '#6B8F71';
                const d = daysAgo(p.lastInspectionDate);
                return (
                  <div key={p.id} className="db-row" onClick={() => navigate(`/properties/${p.id}/overview`)}>
                    <div className="db-row-left">
                      <span className="db-health-dot" style={{ background: dotColor }} />
                      <div>
                        <div className="db-row-title">{p.name}</div>
                        <div className="db-row-sub">
                          {p.openMaintenanceCount} open issue{p.openMaintenanceCount !== 1 ? 's' : ''}
                          {' \u00b7 '}
                          Inspected {d === null ? 'never' : d === 0 ? 'today' : `${d}d ago`}
                        </div>
                      </div>
                    </div>
                    <span className="db-health-count" style={{ color: dotColor }}>{p.openMaintenanceCount}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
        )}

        {/* ── BOTTOM RIGHT: NEEDS ATTENTION ── */}
        {isWidgetOn('needsAttention') && (
        <div className="db-card">
          <div className="db-card-head">
            <div className="db-card-title db-terracotta">NEEDS ATTENTION</div>
          </div>
          <div className="db-card-body">
            {overdueRooms.length === 0 ? (
              <div className="db-empty">{'\u2713'} All rooms on schedule</div>
            ) : (
              overdueRooms.slice(0, 5).map((r) => (
                <div key={r.roomId} className="db-row">
                  <div className="db-row-left">
                    <div>
                      <div className="db-row-title">{r.propertyName} &rarr; {r.roomLabel}</div>
                      <div className="db-row-sub" style={{ color: r.daysSince === null ? '#C0392B' : '#C4703F' }}>
                        {r.daysSince === null ? 'Never inspected' : `Last inspected ${r.daysSince} days ago`}
                      </div>
                    </div>
                  </div>
                  <button
                    className="db-inspect-btn"
                    onClick={(e) => { e.stopPropagation(); startQuarterly(r.propertyId, r.roomId); }}
                  >
                    Inspect
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        )}

      </div>

      {/* ── Recent Inspection Activity (Submitted + Reviewed) ── */}
      {isWidgetOn('recentActivity') && (
      <div className="db-card db-card-wide">
        <div className="db-card-head">
          <div className="db-card-title db-sage">RECENT INSPECTION ACTIVITY</div>
          <button className="db-link" onClick={() => navigate('/inspections')}>View all &rarr;</button>
        </div>
        <div className="db-card-body">
          {recentInspectionActivity.length === 0 ? (
            <div className="db-empty">No inspections submitted yet</div>
          ) : (
            recentInspectionActivity.map((a) => {
              const tc = TYPE_COLORS[a.type] || { bg: '#F5F2EF', color: '#4A4543' };
              const onClick = () => {
                if (a.isGroup) {
                  navigate(`/quarterly-review/${a.propertyId}/${a.dateKey}`);
                } else {
                  navigate(`/inspections/${a.id}/review`);
                }
              };
              const subtitle = a.isGroup
                ? `${a.roomCount} room${a.roomCount !== 1 ? 's' : ''} \u00b7 ${timeLabel(a.completedAt)}`
                : `${a.roomLabel ? a.roomLabel + ' \u00b7 ' : ''}${timeLabel(a.completedAt)}`;
              return (
                <div key={a.id} className="db-row" onClick={onClick}>
                  <div className="db-row-left">
                    <span className="db-type-pill" style={{ background: tc.bg, color: tc.color }}>
                      {TYPE_LABELS[a.type] || a.type}
                    </span>
                    <div>
                      <div className="db-row-title">{a.propertyName}</div>
                      <div className="db-row-sub">{subtitle}</div>
                    </div>
                  </div>
                  <span
                    className="insp-status-badge"
                    style={{ color: a.status === 'REVIEWED' ? '#8A8583' : '#6B8F71', borderColor: a.status === 'REVIEWED' ? '#8A8583' : '#6B8F71' }}
                  >
                    {a.status}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
      )}

      <StartInspection open={showStart} onClose={() => setShowStart(false)} />

      <Modal
        open={showWidgetSettings}
        onClose={() => setShowWidgetSettings(false)}
        title="Customize dashboard widgets"
      >
        <div className="modal-form">
          <p className="empty-text" style={{ marginTop: 0 }}>
            Toggle widgets on or off. Your preferences are saved on this device.
            Mobile always shows all widgets stacked.
          </p>
          <div className="widget-toggle-list">
            {Object.keys(WIDGET_LABELS).map((key) => (
              <label key={key} className="widget-toggle-row">
                <span>{WIDGET_LABELS[key]}</span>
                <input
                  type="checkbox"
                  checked={widgets[key] !== false}
                  onChange={() => toggleWidget(key)}
                />
              </label>
            ))}
          </div>
          <div className="modal-actions">
            <button className="btn-primary" onClick={() => setShowWidgetSettings(false)}>Done</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

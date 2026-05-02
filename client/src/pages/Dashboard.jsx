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
  actionItems: true,
  portfolioPulse: true,
  propertiesAtAGlance: true,
  recentActivity: true,
  insights: true,
};
const WIDGET_LABELS = {
  actionItems: 'Action items',
  portfolioPulse: 'Portfolio pulse',
  propertiesAtAGlance: 'Properties at a glance',
  recentActivity: 'Recent activity',
  insights: 'Insights',
};

function daysAgo(date) {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date)) / (1000 * 60 * 60 * 24));
}

function timeAgo(date) {
  if (!date) return '';
  const ms = Date.now() - new Date(date).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtMoneyShort(n) {
  if (n == null || isNaN(n)) return '$0';
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function TrendArrow({ delta, lowerIsBetter = false }) {
  if (delta == null || Math.abs(delta) < 0.05) return null;
  const isUp = delta > 0;
  const isGood = lowerIsBetter ? !isUp : isUp;
  return (
    <span className={`db-trend ${isGood ? 'db-trend-good' : 'db-trend-bad'}`}>
      {isUp ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
    </span>
  );
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
  const [financial, setFinancial] = useState(null);
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
    try { localStorage.setItem(WIDGET_STORE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const isWidgetOn = (key) => (isDesktop ? widgets[key] !== false : true);

  useEffect(() => {
    fetch('/api/dashboard', { credentials: 'include' })
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
    fetch('/api/financials/dashboard?month=all', { credentials: 'include' })
      .then((r) => r.json())
      .then(setFinancial)
      .catch(() => setFinancial({ hasData: false }));
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
    actionItems = [],
    propertiesAtAGlance = [],
    recentActivity = [],
    portfolioInsights = [],
    maintenance = {},
  } = data;
  const sc = maintenance.statusCounts || {};
  const openTickets = (sc.OPEN || 0) + (sc.ASSIGNED || 0) + (sc.IN_PROGRESS || 0);

  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  });

  // Pull the latest-month financial signals from the financial dashboard.
  const finTotals = financial?.totals || null;
  const finTrends = financial?.trends || null;
  const turnoversThisMonth = finTotals?.turnovers ?? null;
  const hostEarnings = finTotals?.hostEarnings ?? null;
  const occupancy = finTotals?.occupancy ?? null;
  const hasFinancialData = financial?.hasData;

  return (
    <div className="db-page page-container">
      {/* Header */}
      <div className="db-top">
        <div>
          <h1 className="db-title">Dashboard</h1>
          <p className="db-date">{todayLabel}</p>
        </div>
        <div className="db-top-actions">
          {canViewAs && (
            <select
              className="view-as-picker"
              value={viewAsRole || realRole || 'OWNER'}
              onChange={(e) => {
                const v = e.target.value;
                if (!v || v === realRole) setViewAsRole(null);
                else setViewAsRole(v);
              }}
              title="Preview the app as another role"
            >
              {VIEW_AS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>View as: {opt.label}</option>
              ))}
            </select>
          )}
          <button className="btn-primary-sm" onClick={() => setShowStart(true)}>+ New inspection</button>
          {isDesktop && (
            <button
              className="btn-secondary-sm db-widget-gear"
              onClick={() => setShowWidgetSettings(true)}
              aria-label="Customize widgets"
              title="Customize widgets"
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

      {/* Action items */}
      {isWidgetOn('actionItems') && (
        actionItems.length === 0 ? (
          <div className="db-caught-up">No action items — all caught up <span className="db-check">✓</span></div>
        ) : (
          <div className="db-card">
            <div className="db-card-head">
              <h3 className="db-card-title">Action items</h3>
            </div>
            <div className="db-action-list">
              {actionItems.map((it, i) => (
                <button
                  key={i}
                  type="button"
                  className="db-action-row"
                  onClick={() => navigate(it.link)}
                >
                  <span className={`db-dot db-dot-${it.severity}`} />
                  <span className="db-action-main">
                    <span className="db-action-msg">{it.message}</span>
                    {it.context && <span className="db-action-ctx">{it.context}</span>}
                  </span>
                  <span className="db-action-link">{it.linkLabel || 'View'} →</span>
                </button>
              ))}
            </div>
          </div>
        )
      )}

      {/* Portfolio pulse — 4 metric cards */}
      {isWidgetOn('portfolioPulse') && (
        <div className="db-pulse">
          <div className="db-card db-pulse-card">
            <div className="db-pulse-label">Host earnings</div>
            <div className="db-pulse-value">
              {hasFinancialData
                ? fmtMoneyShort(hostEarnings)
                : <span className="db-dim">—</span>}
            </div>
            {hasFinancialData
              ? <TrendArrow delta={finTrends?.hostEarnings} />
              : (
                <button className="db-link" onClick={() => navigate('/financials')}>
                  Upload PadSplit data →
                </button>
              )}
          </div>
          <div className="db-card db-pulse-card">
            <div className="db-pulse-label">Occupancy</div>
            <div className="db-pulse-value">
              {hasFinancialData && occupancy != null
                ? `${occupancy.toFixed(1)}%`
                : <span className="db-dim">—</span>}
            </div>
            {hasFinancialData
              ? <TrendArrow delta={finTrends?.occupancy} />
              : (
                <button className="db-link" onClick={() => navigate('/financials')}>
                  Upload PadSplit data →
                </button>
              )}
          </div>
          <div className="db-card db-pulse-card">
            <div className="db-pulse-label">Open tickets</div>
            <div className={`db-pulse-value ${openTickets > 5 ? 'db-pulse-bad' : ''}`}>
              {openTickets}
            </div>
            <button className="db-link" onClick={() => navigate('/maintenance')}>
              View board →
            </button>
          </div>
          <div className="db-card db-pulse-card">
            <div className="db-pulse-label">Turnovers</div>
            <div className="db-pulse-value">
              {turnoversThisMonth != null ? turnoversThisMonth : '0'}
            </div>
            {hasFinancialData && <TrendArrow delta={finTrends?.turnovers} lowerIsBetter />}
          </div>
        </div>
      )}

      {/* Two-column row */}
      <div className="db-twocol">
        {isWidgetOn('propertiesAtAGlance') && (
          <div className="db-card">
            <div className="db-card-head">
              <h3 className="db-card-title">Properties at a glance</h3>
            </div>
            {propertiesAtAGlance.length === 0 ? (
              <p className="db-empty">No properties yet.</p>
            ) : (
              <ul className="db-prop-list">
                {propertiesAtAGlance.map((p) => (
                  <li
                    key={p.id}
                    className="db-prop-row"
                    onClick={() => navigate(`/properties/${p.id}/overview`)}
                  >
                    <span className={`db-dot db-dot-${p.dot === 'red' ? 'red' : p.dot === 'amber' ? 'orange' : 'green'}`} />
                    <span className="db-prop-name">{p.name}</span>
                    <span className="db-prop-summary">{p.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {isWidgetOn('recentActivity') && (
          <div className="db-card">
            <div className="db-card-head">
              <h3 className="db-card-title">Recent activity</h3>
              <button className="db-link" onClick={() => navigate('/notifications')}>View all →</button>
            </div>
            {recentActivity.length === 0 ? (
              <p className="db-empty">No recent activity.</p>
            ) : (
              <ul className="db-activity-list">
                {recentActivity.map((e, i) => (
                  <li
                    key={i}
                    className="db-activity-row"
                    onClick={() => e.link && navigate(e.link)}
                  >
                    <span className={`db-dot db-dot-${e.dot === 'red' ? 'red' : e.dot === 'amber' ? 'amber' : 'sage'}`} />
                    <span className="db-activity-desc">{e.description}</span>
                    <span className="db-activity-time">{timeAgo(e.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Insights */}
      {isWidgetOn('insights') && portfolioInsights.length > 0 && (
        <div className="db-card">
          <div className="db-card-head">
            <h3 className="db-card-title">Insights</h3>
            {/* "Show all" links to the first property's insights tab if any. */}
            {propertiesAtAGlance.length > 0 && (
              <button
                className="db-link"
                onClick={() => navigate(`/properties/${propertiesAtAGlance[0].id}/overview`)}
              >Show all →</button>
            )}
          </div>
          <div className="db-insight-list">
            {portfolioInsights.slice(0, 3).map((ins, i) => (
              <button
                key={i}
                type="button"
                className={`db-insight db-insight-${ins.kind}`}
                onClick={() => ins.link && navigate(ins.link)}
              >
                <span className="db-insight-headline">{ins.headline}</span>
                <span className="db-insight-detail">{ins.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <StartInspection open={showStart} onClose={() => setShowStart(false)} />

      <Modal
        open={showWidgetSettings}
        onClose={() => setShowWidgetSettings(false)}
        title="Customize widgets"
      >
        <div className="modal-form">
          {Object.keys(WIDGET_LABELS).map((key) => (
            <label key={key} className="db-widget-toggle">
              <input
                type="checkbox"
                checked={widgets[key] !== false}
                onChange={() => toggleWidget(key)}
              />
              <span>{WIDGET_LABELS[key]}</span>
            </label>
          ))}
          <p className="db-dim" style={{ marginTop: '0.5rem', fontSize: '12px' }}>
            On mobile every widget is shown by default.
          </p>
        </div>
      </Modal>
    </div>
  );
}

// ─── Legacy helpers kept for the financial sparkline/card preview
// (no longer rendered on the new dashboard, but other surfaces import
// these). They're harmless if unused.

function fmtMoneyShortLegacy(n) {
  if (n == null || isNaN(n)) return '$0';
  return Number(n).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  });
}

function fmtMonth(s) {
  if (!s) return '';
  const [y, m] = s.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export { fmtMoneyShortLegacy, fmtMonth };

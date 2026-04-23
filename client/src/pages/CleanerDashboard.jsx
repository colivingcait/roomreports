import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import StartInspection from '../components/StartInspection';
import NewMaintenance from '../components/NewMaintenance';

const api = (path) =>
  fetch(path, { credentials: 'include' })
    .then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Request failed');
      return data;
    });

function daysAgo(date) {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date)) / (1000 * 60 * 60 * 24));
}

function lastInspectedLabel(date) {
  const d = daysAgo(date);
  if (d === null) return 'Never inspected';
  if (d === 0) return 'Inspected today';
  if (d === 1) return 'Inspected yesterday';
  return `Inspected ${d}d ago`;
}

export default function CleanerDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState([]);
  const [pendingReview, setPendingReview] = useState([]);
  const [showStart, setShowStart] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [startDefault, setStartDefault] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [propData, dashData] = await Promise.all([
        api('/api/properties'),
        api('/api/dashboard').catch(() => ({ pendingReview: [] })),
      ]);
      setProperties(propData.properties || []);
      setPendingReview(dashData.pendingReview || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startForProperty = (propertyId) => {
    setStartDefault(propertyId);
    setShowStart(true);
  };

  if (loading) return <div className="page-loading">Loading dashboard...</div>;

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  });

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Hi {user?.name?.split(' ')[0] || 'there'} 👋</h1>
          <p className="page-subtitle">{today}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <button className="btn-secondary-sm" onClick={() => setShowReport(true)}>+ Report Issue</button>
          <button className="btn-primary-sm" onClick={() => { setStartDefault(null); setShowStart(true); }}>
            + New Inspection
          </button>
        </div>
      </div>

      <div className="role-dash-section">
        <h2 className="role-dash-heading">Your properties</h2>
        {properties.length === 0 ? (
          <div className="empty-state">
            <p>You haven&apos;t been assigned to any properties yet.</p>
            <p style={{ fontSize: '0.85rem', color: '#8A8583' }}>
              Ask your Property Manager to assign you from the Team page.
            </p>
          </div>
        ) : (
          <div className="role-dash-grid">
            {properties.map((p) => (
              <div key={p.id} className="role-dash-card">
                <div className="role-dash-card-head">
                  <h3>{p.name}</h3>
                  <span className="role-dash-sub">{p.address}</span>
                </div>
                <p className="role-dash-muted">{lastInspectedLabel(p.lastInspectionDate)}</p>
                <button
                  className="btn-primary-sm role-dash-action"
                  onClick={() => startForProperty(p.id)}
                >
                  Start Inspection
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {pendingReview.length > 0 && (
        <div className="role-dash-section">
          <h2 className="role-dash-heading">Inspections awaiting review</h2>
          <div className="role-dash-list">
            {pendingReview.slice(0, 5).map((p) => (
              <div key={p.id} className="role-dash-row">
                <div>
                  <div className="role-dash-row-title">
                    {p.propertyName}{p.roomLabel ? ` → ${p.roomLabel}` : ''}
                  </div>
                  <div className="role-dash-row-sub">
                    Submitted · waiting for manager review
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <StartInspection
        open={showStart}
        onClose={() => setShowStart(false)}
        defaultPropertyId={startDefault}
      />

      <NewMaintenance
        open={showReport}
        onClose={() => setShowReport(false)}
        onCreated={() => { setShowReport(false); load(); }}
      />

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '2rem' }}>
        <button className="btn-text" onClick={() => navigate('/dashboard')}>Refresh</button>
      </div>
    </div>
  );
}

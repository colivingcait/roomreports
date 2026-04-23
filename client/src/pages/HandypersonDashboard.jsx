import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import NewMaintenance from '../components/NewMaintenance';

const api = (path) =>
  fetch(path, { credentials: 'include' })
    .then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Request failed');
      return data;
    });

const STATUS_COLORS = {
  OPEN: { bg: '#FEE3E0', color: '#A02420' },
  ASSIGNED: { bg: '#E3EDF7', color: '#2B5F8A' },
  IN_PROGRESS: { bg: '#FAEEDA', color: '#854F0B' },
  RESOLVED: { bg: '#E8F0E9', color: '#3B6D11' },
};

export default function HandypersonDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [myItems, setMyItems] = useState([]);
  const [properties, setProperties] = useState([]);
  const [showReport, setShowReport] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [maintData, propData] = await Promise.all([
        api(`/api/maintenance?assignedUserId=${encodeURIComponent(user?.id || '')}`),
        api('/api/properties'),
      ]);
      const items = (maintData.items || []).filter((i) => i.status !== 'RESOLVED');
      setMyItems(items);
      setProperties(propData.properties || []);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { if (user?.id) load(); }, [load, user?.id]);

  if (loading) return <div className="page-loading">Loading dashboard...</div>;

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  });

  const byStatus = { OPEN: [], ASSIGNED: [], IN_PROGRESS: [] };
  for (const item of myItems) {
    if (byStatus[item.status]) byStatus[item.status].push(item);
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Hi {user?.name?.split(' ')[0] || 'there'} 🔧</h1>
          <p className="page-subtitle">{today}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <button className="btn-secondary-sm" onClick={() => setShowReport(true)}>+ Report Issue</button>
          <button className="btn-primary-sm" onClick={() => navigate('/maintenance')}>
            Open Maintenance Board
          </button>
        </div>
      </div>

      <div className="role-dash-section">
        <h2 className="role-dash-heading">Your tickets</h2>
        {myItems.length === 0 ? (
          <div className="empty-state">
            <p>✓ You have no active tickets.</p>
            <p style={{ fontSize: '0.85rem', color: '#8A8583' }}>
              New work will show up here when a manager assigns you.
            </p>
          </div>
        ) : (
          <div className="role-dash-grid">
            {myItems.map((item) => {
              const tone = STATUS_COLORS[item.status] || { bg: '#F5F2EF', color: '#4A4543' };
              return (
                <div key={item.id} className="role-dash-card role-dash-card-link"
                  onClick={() => navigate(`/maintenance?open=${item.id}`)}
                >
                  <div className="role-dash-card-head">
                    <span
                      className="db-type-pill"
                      style={{ background: tone.bg, color: tone.color }}
                    >
                      {item.status.replace('_', ' ')}
                    </span>
                    <span className="role-dash-sub">{item.flagCategory}</span>
                  </div>
                  <h3 className="role-dash-card-title">{item.description}</h3>
                  <p className="role-dash-muted">
                    {item.property?.name}
                    {item.room?.label ? ` · ${item.room.label}` : ''}
                  </p>
                  {item.priority && (
                    <p className="role-dash-muted">Priority: {item.priority}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {properties.length > 0 && (
        <div className="role-dash-section">
          <h2 className="role-dash-heading">Your properties</h2>
          <div className="role-dash-list">
            {properties.map((p) => (
              <div
                key={p.id}
                className="role-dash-row role-dash-row-link"
                onClick={() => navigate(`/maintenance?propertyId=${p.id}`)}
              >
                <div>
                  <div className="role-dash-row-title">{p.name}</div>
                  <div className="role-dash-row-sub">{p.address}</div>
                </div>
                <span className="role-dash-row-chev">→</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <NewMaintenance
        open={showReport}
        onClose={() => setShowReport(false)}
        onCreated={() => { setShowReport(false); load(); }}
      />
    </div>
  );
}

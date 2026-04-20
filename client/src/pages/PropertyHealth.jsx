import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      return d;
    });

const GRADE_COLORS = {
  A: '#3B6D11',
  B: '#6B8F71',
  C: '#BA7517',
  D: '#C4703F',
  F: '#C0392B',
};

const INSPECTION_TYPE_LABELS = {
  QUARTERLY: 'Room Inspection',
  COMMON_AREA: 'Common Area',
  COMMON_AREA_QUICK: 'Quick Check',
  ROOM_TURN: 'Room Turn',
  RESIDENT_SELF_CHECK: 'Self-Check',
  MOVE_IN_OUT: 'Move-In / Out',
};

function GradeBadge({ grade }) {
  return (
    <span
      className="grade-badge"
      style={{ color: GRADE_COLORS[grade] || '#8A8583', borderColor: GRADE_COLORS[grade] || '#D4D0CE' }}
    >
      {grade || '—'}
    </span>
  );
}

function timeAgo(date) {
  if (!date) return 'Never';
  const d = new Date(date);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function PropertyHealth() {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('grade'); // grade | name | open | violations
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    setError('');
    api('/api/properties?withHealth=true')
      .then((d) => setProperties(d.properties || []))
      .catch((err) => setError(err.message || 'Failed to load properties'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const sorted = [...properties].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'open') return (b.health?.openMaintenanceCount || 0) - (a.health?.openMaintenanceCount || 0);
    if (sortBy === 'violations') return (b.health?.activeViolationCount || 0) - (a.health?.activeViolationCount || 0);
    return (b.health?.score || 0) - (a.health?.score || 0);
  });

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!name.trim() || !address.trim()) {
      setAddError('Name and address are required');
      return;
    }
    setSaving(true);
    setAddError('');
    try {
      await api('/api/properties', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), address: address.trim() }),
      });
      setShowAdd(false);
      setName('');
      setAddress('');
      load();
    } catch (err) {
      setAddError(err.message || 'Failed to create property');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page-loading">Loading properties...</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Properties</h1>
          <p className="page-subtitle">
            {properties.length} {properties.length === 1 ? 'property' : 'properties'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select
            className="filter-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="grade">Sort: Health grade</option>
            <option value="name">Sort: Name</option>
            <option value="open">Sort: Open maintenance</option>
            <option value="violations">Sort: Active violations</option>
          </select>
          <button className="btn-primary-sm" onClick={() => setShowAdd(true)}>+ Add Property</button>
        </div>
      </div>

      {error && <div className="auth-error">{error}</div>}

      {sorted.length === 0 ? (
        <div className="empty-state">
          <p>No properties yet.</p>
          <button className="btn-primary-sm" onClick={() => setShowAdd(true)}>Add your first property</button>
        </div>
      ) : (
        <div className="health-grid">
          {sorted.map((p) => {
            const h = p.health || {};
            const last = h.lastInspection;
            const activeViol = h.activeViolationCount || 0;
            return (
              <div
                key={p.id}
                className="health-card"
                onClick={() => navigate(`/properties/${p.id}/overview`)}
              >
                <div className="health-card-head">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h3 className="health-card-name">{p.name}</h3>
                    <p className="health-card-address">{p.address}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {activeViol >= 3 && (
                      <span
                        className="po-room-escalation"
                        title={`${activeViol} active violations`}
                      >
                        &#9888; {activeViol}
                      </span>
                    )}
                    <GradeBadge grade={h.grade} />
                  </div>
                </div>
                <div className="health-card-stats">
                  <div>
                    <span className="health-card-stat-label">Open maintenance</span>
                    <span className="health-card-stat-value">{h.openMaintenanceCount || 0}</span>
                  </div>
                  <div>
                    <span className="health-card-stat-label">Active violations</span>
                    <span
                      className="health-card-stat-value"
                      style={activeViol > 0 ? { color: '#C4703F' } : undefined}
                    >
                      {activeViol}
                    </span>
                  </div>
                  <div>
                    <span className="health-card-stat-label">Overdue inspections</span>
                    <span className="health-card-stat-value">{h.overdueInspectionCount || 0}</span>
                  </div>
                  <div>
                    <span className="health-card-stat-label">Avg resolution</span>
                    <span className="health-card-stat-value">
                      {h.avgResolutionDays != null ? `${h.avgResolutionDays.toFixed(1)}d` : '—'}
                    </span>
                  </div>
                </div>
                <div className="health-card-foot">
                  <span>
                    {last
                      ? `${INSPECTION_TYPE_LABELS[last.type] || last.type} · ${timeAgo(last.date)}`
                      : 'Never inspected'}
                  </span>
                  <span>{p._count?.rooms || 0} rooms</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={showAdd}
        onClose={() => { if (!saving) { setShowAdd(false); setAddError(''); } }}
        title="Add Property"
      >
        <form className="modal-form" onSubmit={handleAdd}>
          <label>
            Name
            <input
              type="text"
              className="maint-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Meadowchase"
              autoFocus
            />
          </label>
          <label>
            Address
            <input
              type="text"
              className="maint-input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, city, state"
            />
          </label>
          {addError && <div className="auth-error">{addError}</div>}
          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { setShowAdd(false); setAddError(''); }}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={saving || !name.trim() || !address.trim()}
            >
              {saving ? 'Adding...' : 'Add Property'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

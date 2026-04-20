import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const api = (path) =>
  fetch(path, { credentials: 'include' }).then(async (r) => {
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

function GradeBadge({ grade }) {
  return (
    <span
      className="grade-badge"
      style={{ color: GRADE_COLORS[grade] || '#8A8580', borderColor: GRADE_COLORS[grade] || '#E8E4DF' }}
    >
      {grade || '—'}
    </span>
  );
}

export default function PropertyHealth() {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('grade'); // grade | name | open
  const navigate = useNavigate();

  useEffect(() => {
    api('/api/properties?withHealth=true')
      .then((d) => setProperties(d.properties || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sorted = [...properties].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'open') return (b.health?.openMaintenanceCount || 0) - (a.health?.openMaintenanceCount || 0);
    return (b.health?.score || 0) - (a.health?.score || 0);
  });

  if (loading) return <div className="page-loading">Loading properties...</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Property Health</h1>
          <p className="page-subtitle">{properties.length} {properties.length === 1 ? 'property' : 'properties'}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <select className="filter-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="grade">Sort: Health grade</option>
            <option value="name">Sort: Name</option>
            <option value="open">Sort: Open maintenance</option>
          </select>
          <button className="btn-primary-sm" onClick={() => navigate('/properties')}>Manage Properties</button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="empty-state"><p>No properties yet. Add one to get started.</p></div>
      ) : (
        <div className="health-grid">
          {sorted.map((p) => (
            <div key={p.id} className="health-card" onClick={() => navigate(`/properties/${p.id}/overview`)}>
              <div className="health-card-head">
                <div>
                  <h3 className="health-card-name">{p.name}</h3>
                  <p className="health-card-address">{p.address}</p>
                </div>
                <GradeBadge grade={p.health?.grade} />
              </div>
              <div className="health-card-stats">
                <div>
                  <span className="health-card-stat-label">Health score</span>
                  <span className="health-card-stat-value">{p.health?.score ?? '—'}</span>
                </div>
                <div>
                  <span className="health-card-stat-label">Open maintenance</span>
                  <span className="health-card-stat-value">{p.health?.openMaintenanceCount ?? 0}</span>
                </div>
                <div>
                  <span className="health-card-stat-label">Overdue inspections</span>
                  <span className="health-card-stat-value">{p.health?.overdueInspectionCount ?? 0}</span>
                </div>
                <div>
                  <span className="health-card-stat-label">Avg resolution</span>
                  <span className="health-card-stat-value">
                    {p.health?.avgResolutionDays != null ? `${p.health.avgResolutionDays.toFixed(1)}d` : '—'}
                  </span>
                </div>
              </div>
              <div className="health-card-foot">
                <span>{p._count?.rooms || 0} rooms</span>
                <span className="health-card-link">Open overview &rarr;</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

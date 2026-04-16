import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import StartInspection from '../components/StartInspection';

const STATUS_COLORS = { DRAFT: '#C4703F', SUBMITTED: '#6B8F71', REVIEWED: '#8A8583' };

export default function Inspections() {
  const navigate = useNavigate();
  const location = useLocation();
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showStart, setShowStart] = useState(false);
  const [notification] = useState(location.state?.notification || '');

  useEffect(() => {
    fetch('/api/inspections', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setInspections(d.inspections || []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-loading">Loading inspections...</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Inspections</h1>
          <p className="page-subtitle">{inspections.length} inspection{inspections.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary-sm" onClick={() => setShowStart(true)}>
          + New Inspection
        </button>
      </div>

      {notification && (
        <div style={{
          background: '#F0F7F1', border: '1px solid #6B8F71', borderRadius: 8,
          padding: '0.75rem 1rem', marginBottom: '1rem', color: '#4A4543', fontSize: '0.9rem'
        }}>
          {notification}
        </div>
      )}

      {inspections.length === 0 ? (
        <div className="empty-state">
          <p>No inspections yet</p>
          <button className="btn-primary-sm" onClick={() => setShowStart(true)}>Start your first inspection</button>
        </div>
      ) : (
        <div className="insp-list">
          {inspections.map((insp) => (
            <div key={insp.id} className="insp-list-card" onClick={() => navigate(`/inspections/${insp.id}`)}>
              <div className="insp-list-left">
                <h3>{insp.property?.name || 'Unknown'}</h3>
                <p className="insp-list-meta">
                  {insp.type.replace(/_/g, ' ')}
                  {insp.room ? ` — ${insp.room.label}` : ''}
                </p>
                <p className="insp-list-date">
                  {new Date(insp.createdAt).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
                  })}
                </p>
              </div>
              <div className="insp-list-right">
                <span className="insp-status-badge" style={{ color: STATUS_COLORS[insp.status], borderColor: STATUS_COLORS[insp.status] }}>
                  {insp.status}
                </span>
                <span className="insp-list-count">{insp._count?.items || 0} items</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <StartInspection open={showStart} onClose={() => setShowStart(false)} />
    </div>
  );
}

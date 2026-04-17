import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const TYPE_LABELS = {
  COMMON_AREA: 'Common Area', ROOM_TURN: 'Room Turn', QUARTERLY: 'Quarterly',
  RESIDENT_SELF_CHECK: 'Self-Check', MOVE_IN_OUT: 'Move-In/Out',
};

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

export default function InspectionReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState('');

  const fetchInspection = useCallback(async () => {
    try {
      const data = await api(`/api/inspections/${id}`);
      setInspection(data.inspection);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchInspection(); }, [fetchInspection]);

  const handleApprove = async () => {
    setApproving(true);
    setError('');
    try {
      const data = await api(`/api/inspections/${id}/review`, { method: 'PUT' });
      navigate('/dashboard', {
        state: {
          notification: `Approved — ${data.maintenanceItemsCreated} maintenance ticket${data.maintenanceItemsCreated !== 1 ? 's' : ''} created`,
        },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setApproving(false);
    }
  };

  if (loading) return <div className="page-loading">Loading inspection...</div>;
  if (!inspection) {
    return (
      <div className="page-container">
        <div className="auth-error">{error || 'Inspection not found'}</div>
      </div>
    );
  }

  const flaggedItems = (inspection.items || []).filter((i) => i.flagCategory || i.isMaintenance);
  const maintenanceCount = flaggedItems.filter((i) => i.isMaintenance).length;

  // Group by zone
  const zones = [];
  const zoneMap = {};
  for (const item of flaggedItems) {
    if (!zoneMap[item.zone]) {
      zoneMap[item.zone] = [];
      zones.push(item.zone);
    }
    zoneMap[item.zone].push(item);
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <button className="btn-text-sm" onClick={() => navigate('/dashboard')}>&larr; Dashboard</button>
          <h1 style={{ marginTop: '0.25rem' }}>Review Inspection</h1>
          <p className="page-subtitle">
            {TYPE_LABELS[inspection.type] || inspection.type}
            {' — '}
            {inspection.property?.name}
            {inspection.room ? ` / ${inspection.room.label}` : ''}
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="review-summary">
        <div className="review-summary-row">
          <span className="review-label">Inspector</span>
          <span className="review-value">
            {inspection.inspector?.name} ({inspection.inspector?.role})
          </span>
        </div>
        <div className="review-summary-row">
          <span className="review-label">Submitted</span>
          <span className="review-value">
            {inspection.completedAt
              ? new Date(inspection.completedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
              : '—'}
          </span>
        </div>
        <div className="review-summary-row">
          <span className="review-label">Issues</span>
          <span className="review-value">
            <span className="review-flag-count">&#9873; {flaggedItems.length} flagged</span>
            {maintenanceCount > 0 && (
              <span className="review-maint-count"> &middot; {maintenanceCount} marked for maintenance</span>
            )}
          </span>
        </div>
      </div>

      {/* Flagged items */}
      {flaggedItems.length === 0 ? (
        <div className="empty-state">
          <p>No issues flagged in this inspection</p>
          <p style={{ fontSize: '0.85rem', marginTop: '0.5rem', color: '#B5B1AF' }}>
            Approve to mark this inspection as reviewed.
          </p>
        </div>
      ) : (
        <>
          <h3 className="review-section-title">Flagged Items ({flaggedItems.length})</h3>
          <div className="review-items">
            {zones.map((zone) => (
              <div key={zone} className="review-zone">
                <h4 className="review-zone-name">{zone}</h4>
                {zoneMap[zone].map((item) => (
                  <div key={item.id} className="review-item">
                    <div className="review-item-head">
                      <div className="review-item-text">{item.text}</div>
                      <div className="review-item-badges">
                        {item.status && (
                          <span className="review-status-badge" style={{ color: '#C53030', borderColor: '#F5C6C6' }}>
                            {item.status}
                          </span>
                        )}
                        {item.flagCategory && (
                          <span className="review-cat-badge">{item.flagCategory}</span>
                        )}
                        {item.isMaintenance && (
                          <span className="review-maint-badge">Maintenance</span>
                        )}
                      </div>
                    </div>
                    {item.note && (
                      <div className="review-item-note">
                        <span className="review-note-label">Note:</span> {item.note}
                      </div>
                    )}
                    {item.photos?.length > 0 && (
                      <div className="review-photos">
                        {item.photos.map((p) => (
                          <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="review-photo-thumb">
                            <img src={p.url} alt="" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {error && <div className="auth-error" style={{ marginTop: '1rem' }}>{error}</div>}

      {/* Approve button */}
      <div className="review-footer">
        <button
          className="btn-finish"
          onClick={handleApprove}
          disabled={approving}
        >
          {approving ? 'Approving...' : 'Approve Report'}
        </button>
        {maintenanceCount > 0 && (
          <p className="review-footer-note">
            {maintenanceCount} maintenance ticket{maintenanceCount !== 1 ? 's' : ''} will be created on approval.
          </p>
        )}
      </div>
    </div>
  );
}

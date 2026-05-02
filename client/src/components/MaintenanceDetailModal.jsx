import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal';

const api = (path) =>
  fetch(path, { credentials: 'include' }).then(async (r) => {
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d;
  });

const STATUS_LABELS = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  DEFERRED: 'Deferred',
};
const STATUS_COLORS = {
  OPEN: '#C0392B',
  ASSIGNED: '#BA7517',
  IN_PROGRESS: '#3B6D8A',
  RESOLVED: '#2F7A48',
  DEFERRED: '#8A8580',
};
const PRIORITY_COLORS = {
  High: '#C0392B',
  Medium: '#BA7517',
  Low: '#8A8580',
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function MaintenanceDetailModal({ ticketId, onClose }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState('');

  useEffect(() => {
    if (!ticketId) return;
    setLoading(true);
    api(`/api/maintenance/${ticketId}`)
      .then((d) => setData(d.item || d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [ticketId]);

  const goEdit = () => {
    navigate('/maintenance');
    onClose();
  };

  return (
    <Modal open={!!ticketId} onClose={onClose} title="Maintenance ticket">
      {loading ? (
        <div className="page-loading" style={{ padding: '2rem' }}>Loading…</div>
      ) : error ? (
        <div className="auth-error" style={{ margin: '1rem' }}>{error}</div>
      ) : !data ? null : (
        <div className="md-modal">
          <div className="md-modal-header">
            <h3 className="md-modal-title">{data.description || 'Maintenance ticket'}</h3>
            <div className="md-modal-badges">
              <span
                className="md-modal-badge"
                style={{ color: STATUS_COLORS[data.status] || '#8A8580', borderColor: STATUS_COLORS[data.status] || '#8A8580' }}
              >
                {STATUS_LABELS[data.status] || data.status}
              </span>
              {data.priority && (
                <span
                  className="md-modal-badge"
                  style={{ color: PRIORITY_COLORS[data.priority] || '#8A8580', borderColor: PRIORITY_COLORS[data.priority] || '#8A8580' }}
                >
                  {data.priority}
                </span>
              )}
            </div>
          </div>

          <div className="md-modal-meta">
            {data.flagCategory && <span className="md-modal-meta-row">Category: {data.flagCategory}</span>}
            <span className="md-modal-meta-row">
              {data.property?.name || 'Property'}
              {data.room?.label ? ` · ${data.room.label}` : ''}
            </span>
            <span className="md-modal-meta-row">
              Reported {fmtDate(data.createdAt)}
              {data.reportedByName ? ` by ${data.reportedByName}` : ''}
            </span>
            {data.resolvedAt && (
              <span className="md-modal-meta-row">Resolved {fmtDate(data.resolvedAt)}</span>
            )}
          </div>

          {data.note && (
            <div className="md-modal-section">
              <div className="md-modal-label">Notes</div>
              <p className="md-modal-text">{data.note}</p>
            </div>
          )}

          {(() => {
            // Photos can live on the ticket itself OR (more commonly)
            // on the InspectionItem the ticket was created from.
            // Merge by URL so we don't show duplicates.
            const seen = new Set();
            const all = [];
            for (const p of (data.photos || [])) {
              if (!p?.url || seen.has(p.url)) continue;
              seen.add(p.url); all.push(p);
            }
            for (const p of (data.inspectionItem?.photos || [])) {
              if (!p?.url || seen.has(p.url)) continue;
              seen.add(p.url); all.push(p);
            }
            if (all.length === 0) return null;
            return (
              <div className="md-modal-section">
                <div className="md-modal-label">Photos ({all.length})</div>
                <div className="md-modal-photos">
                  {all.map((p) => (
                    <button
                      key={p.id || p.url}
                      type="button"
                      className="md-modal-photo"
                      onClick={() => setLightboxUrl(p.url)}
                    >
                      <img src={p.url} alt="" />
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="md-modal-actions">
            <button type="button" className="btn-primary-sm" onClick={goEdit}>
              Edit on board →
            </button>
          </div>
        </div>
      )}

      {lightboxUrl && (
        <div className="lightbox-overlay" onClick={() => setLightboxUrl('')}>
          <button className="lightbox-close" onClick={() => setLightboxUrl('')}>×</button>
          <img src={lightboxUrl} alt="" className="lightbox-image" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </Modal>
  );
}

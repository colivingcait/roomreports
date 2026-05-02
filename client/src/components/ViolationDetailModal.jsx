import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './Modal';

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

const TYPE_LABELS = {
  COMMON_AREA: 'Common Area', COMMON_AREA_QUICK: 'Common Area Quick Check',
  ROOM_TURN: 'Room Turn', QUARTERLY: 'Room Inspection',
  RESIDENT_SELF_CHECK: 'Self-Check', MOVE_IN_OUT: 'Move-In',
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ViolationDetailModal({ violationId, onClose }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState('');

  useEffect(() => {
    if (!violationId) return;
    setLoading(true);
    api(`/api/violations/${violationId}`)
      .then((d) => setData(d.violation))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [violationId]);

  const goToInspection = () => {
    if (!data?.sourceInspection) return;
    if (data.sourceInspection.type === 'QUARTERLY') {
      const dateKey = new Date(data.sourceInspection.createdAt).toISOString().slice(0, 10);
      navigate(`/quarterly-review/${data.property?.id}/${dateKey}`);
    } else {
      navigate(`/inspections/${data.sourceInspection.id}/review`);
    }
    onClose();
  };

  const goToFollowUp = () => {
    if (!data?.followUp) return;
    navigate('/maintenance');
    onClose();
  };

  return (
    <Modal open={!!violationId} onClose={onClose} title="Violation detail">
      {loading ? (
        <div className="page-loading" style={{ padding: '2rem' }}>Loading…</div>
      ) : error ? (
        <div className="auth-error" style={{ margin: '1rem' }}>{error}</div>
      ) : !data ? null : (
        <div className="vdm">
          <div className="vdm-header">
            <h3 className="vdm-type">{data.category || 'Lease violation'}</h3>
            <div className="vdm-meta">
              {data.room?.label || 'Property-level'}
              {data.property?.name && ` · ${data.property.name}`}
              {' · '}{fmtDate(data.createdAt)}
            </div>
          </div>

          {data.description && (
            <div className="vdm-section">
              <div className="vdm-label">Description</div>
              <p className="vdm-text">{data.description}</p>
            </div>
          )}

          {data.note && (
            <div className="vdm-section">
              <div className="vdm-label">Inspector note</div>
              <p className="vdm-text">{data.note}</p>
            </div>
          )}

          {data.sourceItem?.note && data.sourceItem.note !== data.note && (
            <div className="vdm-section">
              <div className="vdm-label">Item note</div>
              <p className="vdm-text">{data.sourceItem.note}</p>
            </div>
          )}

          {data.sourceItem?.photos?.length > 0 && (
            <div className="vdm-section">
              <div className="vdm-label">Photos ({data.sourceItem.photos.length})</div>
              <div className="vdm-photos">
                {data.sourceItem.photos.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="vdm-photo"
                    onClick={() => setLightboxUrl(p.url)}
                  >
                    <img src={p.url} alt="" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {data.sourceInspection && (
            <div className="vdm-section">
              <div className="vdm-label">Source inspection</div>
              <button type="button" className="vdm-link" onClick={goToInspection}>
                {TYPE_LABELS[data.sourceInspection.type] || data.sourceInspection.type}
                {data.sourceInspection.inspectorName && ` by ${data.sourceInspection.inspectorName}`}
                {' on '}{fmtDate(data.sourceInspection.completedAt || data.sourceInspection.createdAt)}
                {' →'}
              </button>
            </div>
          )}

          <div className="vdm-section">
            <div className="vdm-label">Follow-up ticket</div>
            {data.followUp ? (
              <button type="button" className="vdm-link" onClick={goToFollowUp}>
                {data.followUp.description}
                {' · '}{data.followUp.status}
                {' →'}
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary-sm"
                onClick={() => {
                  // Hand off to the maintenance board where the user can
                  // create a follow-up ticket. A dedicated "create from
                  // violation" flow could be wired later.
                  navigate('/maintenance');
                  onClose();
                }}
              >
                + Create follow-up ticket
              </button>
            )}
          </div>

          {data.resolvedAt && (
            <div className="vdm-resolved">
              Resolved {fmtDate(data.resolvedAt)}
            </div>
          )}
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

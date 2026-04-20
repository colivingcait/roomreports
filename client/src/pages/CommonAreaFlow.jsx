import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAutoSave } from '../hooks/useAutoSave';
import { ChecklistItem } from '../components/InspectionItems';
import Modal from '../components/Modal';

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

export default function CommonAreaFlow() {
  const { inspectionId } = useParams();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { saveItem, saveStatus } = useAutoSave(inspectionId);
  const [submitting, setSubmitting] = useState(false);
  const [showPartialModal, setShowPartialModal] = useState(false);
  const [partialReason, setPartialReason] = useState('');

  const fetchInspection = useCallback(async () => {
    try {
      const data = await api(`/api/inspections/${inspectionId}`);
      setInspection(data.inspection);
      setItems(data.inspection.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [inspectionId]);

  useEffect(() => { fetchInspection(); }, [fetchInspection]);

  const handleItemUpdate = useCallback((updated) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }, []);

  const doSubmit = async (partial) => {
    setSubmitting(true);
    setError('');
    try {
      const body = partial ? { partial: true, partialReason } : {};
      await api(`/api/inspections/${inspectionId}/submit`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const typeLabel = inspection?.type === 'ROOM_TURN' ? 'Room turn' : 'Common area';
      const noFlags = visibleItems.every((i) => i.status !== 'Fail');
      const roomLabel = inspection?.room ? ` \u2014 ${inspection.room.label}` : '';
      const notification = inspection?.type === 'ROOM_TURN' && noFlags
        ? `Room Ready \u2713 ${inspection?.property?.name}${roomLabel}`
        : `${typeLabel} inspection submitted for ${inspection?.property?.name}${roomLabel}`;
      navigate('/dashboard', { state: { notification } });
    } catch (err) {
      setError(err.message);
      setShowPartialModal(false);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitClick = () => {
    const incomplete = visibleItems.filter((i) => !i.status);
    if (incomplete.length > 0) {
      setShowPartialModal(true);
    } else {
      doSubmit(false);
    }
  };

  if (loading) return <div className="page-loading">Loading inspection...</div>;
  if (!inspection) return <div className="page-container"><div className="auth-error">{error || 'Not found'}</div></div>;

  const visibleItems = items.filter((i) => !i.zone.startsWith('_'));

  const zones = [];
  const zoneMap = {};
  for (const item of visibleItems) {
    if (!zoneMap[item.zone]) { zoneMap[item.zone] = []; zones.push(item.zone); }
    zoneMap[item.zone].push(item);
  }

  const total = visibleItems.length;
  const done = visibleItems.filter((i) => i.status).length;
  const flags = visibleItems.filter((i) => i.status === 'Fail').length;
  const progress = total > 0 ? (done / total) * 100 : 0;
  const incomplete = visibleItems.filter((i) => !i.status);

  return (
    <div className="q-room-page">
      <div className="q-room-header">
        <div className="q-room-header-top">
          <button className="btn-text" onClick={() => navigate('/dashboard')}>Save &amp; exit</button>
          <div className="save-indicator">
            {saveStatus === 'saving' && <span className="save-saving">Saving...</span>}
            {saveStatus === 'saved' && <span className="save-saved">Saved &#10003;</span>}
            {saveStatus === 'offline' && <span className="save-offline">Saved locally</span>}
          </div>
        </div>
        <div className="q-room-header-info">
          <h1>
            {inspection.property?.name}
            {inspection.room ? ` \u2014 ${inspection.room.label}` : ''}
          </h1>
          <span className="q-room-header-meta">
            {inspection.type === 'ROOM_TURN' ? 'Room Turn' : 'Common Area'} Inspection &middot; {done}/{total}
          </span>
        </div>
        <div className="progress-bar-container"><div className="progress-bar" style={{ width: `${progress}%` }} /></div>
      </div>

      <div className="q-room-body">
        {error && <div className="auth-error" style={{ margin: '0 0 1rem' }}>{error}</div>}

        {zones.map((zone) => (
          <div key={zone} className="q-zone">
            <h3 className="q-zone-title">{zone}</h3>
            {zoneMap[zone].map((item) => (
              <ChecklistItem
                key={item.id}
                item={item}
                inspectionId={inspectionId}
                saveItem={saveItem}
                onItemUpdate={handleItemUpdate}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="q-room-footer">
        <button className="btn-text" onClick={() => navigate('/dashboard')}>Save &amp; exit</button>
        <button
          className="q-submit-btn"
          onClick={onSubmitClick}
          disabled={submitting}
        >
          {submitting ? 'Submitting...' : `Submit Inspection${flags > 0 ? ` (${flags} flag${flags !== 1 ? 's' : ''})` : ''}`}
        </button>
      </div>

      <Modal
        open={showPartialModal}
        onClose={() => { setShowPartialModal(false); setPartialReason(''); }}
        title="Partial Submission"
      >
        <div className="modal-form">
          <p style={{ fontSize: '0.9rem', color: '#2C2C2C', marginBottom: '0.5rem' }}>
            {incomplete.length} item{incomplete.length !== 1 ? 's' : ''} not completed.
          </p>
          <label>
            Reason for partial submission
            <textarea
              className="detail-textarea"
              value={partialReason}
              onChange={(e) => setPartialReason(e.target.value)}
              placeholder="e.g. Could not access back porch — gate locked"
              rows={3}
            />
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button className="btn-secondary" onClick={() => { setShowPartialModal(false); setPartialReason(''); }}>
              Go back
            </button>
            <button
              className="btn-primary"
              style={{ width: 'auto' }}
              onClick={() => doSubmit(true)}
              disabled={submitting || !partialReason.trim()}
            >
              {submitting ? 'Submitting...' : 'Submit anyway'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

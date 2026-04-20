import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAutoSave } from '../hooks/useAutoSave';
import { queuePhoto } from '../lib/offlineStore';
import OfflineBanner from '../components/OfflineBanner';
import MoveInOutComparison from '../components/MoveInOutComparison';
import Modal from '../components/Modal';

import { FLAG_CATEGORIES } from '../../../shared/index.js';
const PASS_FAIL_TYPES = ['COMMON_AREA', 'ROOM_TURN'];
const GOOD_STATUSES = ['Pass', 'Good', 'Clean', 'Yes'];
const BAD_STATUSES = ['Fail', 'Poor', 'Dirty', 'No', 'Missing'];

function statusColor(status) {
  if (!status) return '';
  if (GOOD_STATUSES.includes(status)) return 'status-good';
  if (BAD_STATUSES.includes(status)) return 'status-bad';
  return 'status-mid';
}

// ─── Photo Capture ──────────────────────────────────────

function PhotoCapture({ inspectionId, itemId, photos, onPhotoAdded, onPhotoRemoved }) {
  const fileRef = useRef();
  const [uploading, setUploading] = useState(false);

  const handleCapture = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      if (!navigator.onLine) {
        // Queue photo for later upload
        await queuePhoto(inspectionId, itemId, file, file.name);
        const localUrl = URL.createObjectURL(file);
        onPhotoAdded({ id: `local-${Date.now()}`, url: localUrl, local: true });
      } else {
        const form = new FormData();
        form.append('photo', file);
        const res = await fetch(`/api/inspections/${inspectionId}/items/${itemId}/photos`, {
          method: 'POST',
          credentials: 'include',
          body: form,
        });
        const data = await res.json();
        if (res.ok) onPhotoAdded(data.photo);
      }
    } catch {
      // Network error — queue for offline
      await queuePhoto(inspectionId, itemId, file, file.name);
      const localUrl = URL.createObjectURL(file);
      onPhotoAdded({ id: `local-${Date.now()}`, url: localUrl, local: true });
    }
    finally { setUploading(false); fileRef.current.value = ''; }
  };

  const handleDelete = async (photoId) => {
    try {
      await fetch(`/api/inspections/${inspectionId}/items/${itemId}/photos/${photoId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      onPhotoRemoved(photoId);
    } catch { /* ignore */ }
  };

  return (
    <div className="photo-capture">
      <div className="photo-grid">
        {photos.map((p) => (
          <div key={p.id} className="photo-thumb">
            <img src={p.url} alt="" />
            <button className="photo-remove" onClick={() => handleDelete(p.id)}>&times;</button>
          </div>
        ))}
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleCapture} style={{ display: 'none' }} />
      <button type="button" className="btn-photo" onClick={() => fileRef.current.click()} disabled={uploading}>
        {uploading ? 'Uploading...' : '+ Add Photo'}
      </button>
    </div>
  );
}

// ─── Inspection Item ────────────────────────────────────

function InspectionItem({ item, inspectionId, inspectionType, saveItem, onItemUpdate, requirePhoto }) {
  const [expanded, setExpanded] = useState(false);
  const isPassFail = PASS_FAIL_TYPES.includes(inspectionType);
  const isBad = BAD_STATUSES.includes(item.status);

  const update = (changes) => {
    const updated = { ...item, ...changes };
    onItemUpdate(updated);
    saveItem(item.id, changes);
    // Auto-expand on flag/bad status
    if (changes.status && BAD_STATUSES.includes(changes.status)) {
      setExpanded(true);
    }
  };

  const toggleMaintenance = () => {
    update({ isMaintenance: !item.isMaintenance });
  };

  const photoMissing = requirePhoto && item.status && (!item.photos || item.photos.length === 0);

  return (
    <div className={`insp-item ${item.status ? 'insp-item-done' : ''} ${isBad ? 'insp-item-flagged' : ''} ${photoMissing ? 'insp-item-photo-missing' : ''}`}>
      <div className="insp-item-main">
        <div className="insp-item-text">
          {item.text}
          {requirePhoto && (
            <span className={`photo-required-badge ${item.photos?.length > 0 ? 'has-photo' : ''}`} title="Photo recommended">
              {item.photos?.length > 0 ? 'Photo \u2713' : 'Photo'}
            </span>
          )}
        </div>

        {isPassFail ? (
          <div className="insp-item-actions">
            <button
              className={`tap-btn tap-pass ${item.status === 'Pass' ? 'active' : ''}`}
              onClick={() => update({ status: 'Pass', flagCategory: null, isMaintenance: false })}
            >
              &#10003;
            </button>
            <button
              className={`tap-btn tap-flag ${item.status === 'Fail' ? 'active' : ''}`}
              onClick={() => {
                update({ status: 'Fail' });
                setExpanded(true);
              }}
            >
              &#9873;
            </button>
            {item.status && (
              <button className="expand-btn" onClick={() => setExpanded(!expanded)}>
                {expanded ? '▾' : '▸'}
              </button>
            )}
          </div>
        ) : (
          <div className="insp-item-actions">
            <select
              className={`insp-select ${statusColor(item.status)}`}
              value={item.status || ''}
              onChange={(e) => {
                const val = e.target.value;
                if (BAD_STATUSES.includes(val)) {
                  update({ status: val });
                } else {
                  update({ status: val, flagCategory: null, isMaintenance: false });
                }
              }}
            >
              <option value="">Select...</option>
              {item.options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            {item.status && (
              <button className="expand-btn" onClick={() => setExpanded(!expanded)}>
                {expanded ? '▾' : '▸'}
              </button>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="insp-item-detail">
          <label className="detail-label">
            Flag Category
            <select
              className="form-select detail-select"
              value={item.flagCategory || ''}
              onChange={(e) => update({ flagCategory: e.target.value || null })}
            >
              <option value="">None</option>
              {FLAG_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          <label className="detail-label">
            Notes
            <textarea
              className="detail-textarea"
              value={item.note || ''}
              onChange={(e) => update({ note: e.target.value || null })}
              placeholder="Add details..."
              rows={2}
            />
          </label>

          <PhotoCapture
            inspectionId={inspectionId}
            itemId={item.id}
            photos={item.photos || []}
            onPhotoAdded={(photo) => {
              onItemUpdate({ ...item, photos: [...(item.photos || []), photo] });
            }}
            onPhotoRemoved={(photoId) => {
              onItemUpdate({ ...item, photos: (item.photos || []).filter((p) => p.id !== photoId) });
            }}
          />

          <button
            className={`btn-maintenance ${item.isMaintenance ? 'active' : ''}`}
            onClick={toggleMaintenance}
          >
            {item.isMaintenance ? '✓ Maintenance Ticket' : 'Mark as Maintenance'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Zone Section ───────────────────────────────────────

function ZoneSection({ zone, items, inspectionId, inspectionType, saveItem, onItemUpdate, requirePhoto }) {
  const [collapsed, setCollapsed] = useState(false);
  const completed = items.filter((i) => i.status).length;
  const total = items.length;

  return (
    <div className="zone-section">
      <button className="zone-header" onClick={() => setCollapsed(!collapsed)}>
        <div className="zone-header-left">
          <span className={`chevron ${collapsed ? '' : 'open'}`}>&#9654;</span>
          <h3>{zone}</h3>
        </div>
        <span className="zone-count">{completed}/{total}</span>
      </button>
      {!collapsed && (
        <div className="zone-items">
          {items.map((item) => (
            <InspectionItem
              key={item.id}
              item={item}
              inspectionId={inspectionId}
              inspectionType={inspectionType}
              saveItem={saveItem}
              onItemUpdate={onItemUpdate}
              requirePhoto={requirePhoto}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────

export default function InspectionFlow() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { saveItem, saveStatus } = useAutoSave(id);
  const [inspection, setInspection] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showCompare, setShowCompare] = useState(false);
  const [showPartialModal, setShowPartialModal] = useState(false);
  const [partialReason, setPartialReason] = useState('');

  const fetchInspection = useCallback(async () => {
    try {
      const res = await fetch(`/api/inspections/${id}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Redirect to dedicated flows
      if (data.inspection?.type === 'QUARTERLY' && data.inspection?.status === 'DRAFT') {
        navigate(`/quarterly/${data.inspection.propertyId}`, { replace: true });
        return;
      }
      if (data.inspection?.type === 'COMMON_AREA' && data.inspection?.status === 'DRAFT') {
        navigate(`/common-area/${data.inspection.id}`, { replace: true });
        return;
      }
      if (data.inspection?.type === 'ROOM_TURN' && data.inspection?.status === 'DRAFT') {
        navigate(`/room-turn/${data.inspection.id}`, { replace: true });
        return;
      }

      setInspection(data.inspection);
      setItems(data.inspection.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { fetchInspection(); }, [fetchInspection]);

  const handleItemUpdate = useCallback((updatedItem) => {
    setItems((prev) => prev.map((i) => (i.id === updatedItem.id ? updatedItem : i)));
  }, []);

  const doSubmit = async (partial) => {
    setSubmitting(true);
    setError('');
    try {
      const body = partial ? { partial: true, partialReason } : {};
      const res = await fetch(`/api/inspections/${id}/submit`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      navigate('/inspections', { state: { notification: data.notification } });
    } catch (err) {
      setError(err.message);
      setShowPartialModal(false);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitClick = () => {
    const incomplete = items.filter((i) => !i.zone.startsWith('_') && !i.status);
    if (incomplete.length > 0) setShowPartialModal(true);
    else doSubmit(false);
  };

  if (loading) return <div className="page-loading">Loading inspection...</div>;
  if (error && !inspection) return <div className="page-container"><div className="auth-error">{error}</div></div>;
  if (!inspection) return null;

  // Extract direction from _Direction meta item (for MOVE_IN_OUT)
  const directionItem = items.find((i) => i.zone === '_Direction');
  const direction = directionItem?.status || null;

  // Extract send-back reason (if PM sent it back for revision)
  const sendBackItem = items.find((i) => i.zone === '_SendBackReason');
  const sendBackReason = sendBackItem?.note || null;

  // Filter out metadata items from display
  const visibleItems = items.filter((i) => !i.zone.startsWith('_'));

  // Group items by zone (excluding metadata)
  const zones = [];
  const zoneMap = {};
  for (const item of visibleItems) {
    if (!zoneMap[item.zone]) {
      zoneMap[item.zone] = [];
      zones.push(item.zone);
    }
    zoneMap[item.zone].push(item);
  }

  const totalItems = visibleItems.length;
  const completedItems = visibleItems.filter((i) => i.status).length;
  const flaggedItems = visibleItems.filter((i) => i.flagCategory).length;
  const maintenanceItems = visibleItems.filter((i) => i.isMaintenance).length;
  const remaining = totalItems - completedItems;
  const progress = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;
  const isSubmitted = inspection.status !== 'DRAFT';
  const isMoveInOut = inspection.type === 'MOVE_IN_OUT';

  return (
    <div className="insp-page">
      {/* Sticky header */}
      <div className="insp-header">
        <div className="insp-header-top">
          <button className="btn-text" onClick={() => navigate('/inspections')}>&larr; Back</button>
          <div className="save-indicator">
            {saveStatus === 'saving' && <span className="save-saving">Saving...</span>}
            {saveStatus === 'saved' && <span className="save-saved">Saved &#10003;</span>}
            {saveStatus === 'offline' && <span className="save-offline">Saved locally</span>}
            {saveStatus === 'error' && <span className="save-error">Save failed</span>}
          </div>
        </div>
        <div className="insp-title">
          <h1>{inspection.property?.name}</h1>
          <span className="insp-meta">
            {direction ? `${direction.toUpperCase()}` : inspection.type.replace(/_/g, ' ')}
            {inspection.room ? ` — ${inspection.room.label}` : ''}
          </span>
        </div>
        <div className="progress-bar-container">
          <div className="progress-bar" style={{ width: `${progress}%` }} />
        </div>
        <div className="insp-stats">
          <span>{completedItems}/{totalItems} done</span>
          {flaggedItems > 0 && <span className="stat-flag">&#9873; {flaggedItems} flagged</span>}
          {maintenanceItems > 0 && <span className="stat-maint">&#128295; {maintenanceItems} maintenance</span>}
        </div>
      </div>

      {/* Zone sections */}
      <OfflineBanner />
      <div className="insp-body">
        {!isSubmitted && sendBackReason && (
          <div className="sendback-banner">
            <span className="sendback-banner-icon">&#9888;</span>
            <div className="sendback-banner-content">
              <div className="sendback-banner-title">Sent back for revision</div>
              <div className="sendback-banner-reason">{sendBackReason}</div>
            </div>
          </div>
        )}

        {isSubmitted && (
          <div className="insp-submitted-banner">
            This inspection has been {inspection.status.toLowerCase()}.
          </div>
        )}

        {/* Move-Out comparison toggle */}
        {isMoveInOut && direction === 'Move-Out' && inspection.room && (
          <div className="compare-toggle-row">
            <button
              className={`compare-toggle ${showCompare ? 'active' : ''}`}
              onClick={() => setShowCompare(!showCompare)}
            >
              {showCompare ? 'Hide' : 'Show'} Move-In Comparison
            </button>
          </div>
        )}

        {showCompare && inspection.room && (
          <MoveInOutComparison roomId={inspection.room.id} />
        )}

        {/* Required photo notice for MOVE_IN_OUT */}
        {isMoveInOut && !isSubmitted && (
          <div className="insp-notice">
            <strong>Move-In inspection:</strong> A photo is strongly recommended on every item to document condition for security deposit disputes.
          </div>
        )}

        {error && <div className="auth-error" style={{ margin: '1rem 0' }}>{error}</div>}

        {zones.map((zone) => (
          <ZoneSection
            key={zone}
            zone={zone}
            items={zoneMap[zone]}
            inspectionId={id}
            inspectionType={inspection.type}
            saveItem={saveItem}
            onItemUpdate={handleItemUpdate}
            requirePhoto={isMoveInOut}
          />
        ))}
      </div>

      {/* Bottom bar */}
      {!isSubmitted && (
        <div className="insp-footer">
          <div className="insp-footer-info">
            {remaining > 0 ? `${remaining} item${remaining !== 1 ? 's' : ''} remaining` : 'All items completed'}
          </div>
          <div className="insp-footer-actions">
            <button
              className="btn-finish"
              onClick={onSubmitClick}
              disabled={submitting}
            >
              {submitting ? 'Submitting...' : 'Submit Inspection'}
            </button>
          </div>
        </div>
      )}

      <Modal
        open={showPartialModal}
        onClose={() => { setShowPartialModal(false); setPartialReason(''); }}
        title="Partial Submission"
      >
        <div className="modal-form">
          <p style={{ fontSize: '0.9rem', color: '#4A4543', marginBottom: '0.5rem' }}>
            {remaining} item{remaining !== 1 ? 's' : ''} not completed.
          </p>
          <label>
            Reason for partial submission
            <textarea
              className="detail-textarea"
              value={partialReason}
              onChange={(e) => setPartialReason(e.target.value)}
              placeholder="e.g. Could not access the closet — resident not home"
              rows={3}
            />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button
              className="btn-secondary"
              onClick={() => { setShowPartialModal(false); setPartialReason(''); }}
            >
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

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAutoSave } from '../hooks/useAutoSave';

const FLAG_CATEGORIES = ['Maintenance', 'Pest', 'Safety', 'Cleanliness', 'Lease Violation', 'Other'];
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
      const form = new FormData();
      form.append('photo', file);
      const res = await fetch(`/api/inspections/${inspectionId}/items/${itemId}/photos`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const data = await res.json();
      if (res.ok) onPhotoAdded(data.photo);
    } catch { /* ignore */ }
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

function InspectionItem({ item, inspectionId, inspectionType, saveItem, onItemUpdate }) {
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

  return (
    <div className={`insp-item ${item.status ? 'insp-item-done' : ''} ${isBad ? 'insp-item-flagged' : ''}`}>
      <div className="insp-item-main">
        <div className="insp-item-text">{item.text}</div>

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

function ZoneSection({ zone, items, inspectionId, inspectionType, saveItem, onItemUpdate }) {
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

  const fetchInspection = useCallback(async () => {
    try {
      const res = await fetch(`/api/inspections/${id}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInspection(data.inspection);
      setItems(data.inspection.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchInspection(); }, [fetchInspection]);

  const handleItemUpdate = useCallback((updatedItem) => {
    setItems((prev) => prev.map((i) => (i.id === updatedItem.id ? updatedItem : i)));
  }, []);

  const handleSubmit = async (force = false) => {
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/inspections/${id}/submit`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        if (!force) throw new Error(data.error);
        // If forcing, still show error
        throw new Error(data.error);
      }
      navigate('/inspections', { state: { notification: data.notification } });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="page-loading">Loading inspection...</div>;
  if (error && !inspection) return <div className="page-container"><div className="auth-error">{error}</div></div>;
  if (!inspection) return null;

  // Group items by zone
  const zones = [];
  const zoneMap = {};
  for (const item of items) {
    if (!zoneMap[item.zone]) {
      zoneMap[item.zone] = [];
      zones.push(item.zone);
    }
    zoneMap[item.zone].push(item);
  }

  const totalItems = items.length;
  const completedItems = items.filter((i) => i.status).length;
  const flaggedItems = items.filter((i) => i.flagCategory).length;
  const maintenanceItems = items.filter((i) => i.isMaintenance).length;
  const remaining = totalItems - completedItems;
  const progress = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;
  const isSubmitted = inspection.status !== 'DRAFT';

  return (
    <div className="insp-page">
      {/* Sticky header */}
      <div className="insp-header">
        <div className="insp-header-top">
          <button className="btn-text" onClick={() => navigate('/inspections')}>&larr; Back</button>
          <div className="save-indicator">
            {saveStatus === 'saving' && <span className="save-saving">Saving...</span>}
            {saveStatus === 'saved' && <span className="save-saved">Saved &#10003;</span>}
            {saveStatus === 'error' && <span className="save-error">Save failed</span>}
          </div>
        </div>
        <div className="insp-title">
          <h1>{inspection.property?.name}</h1>
          <span className="insp-meta">
            {inspection.type.replace(/_/g, ' ')}
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
      <div className="insp-body">
        {isSubmitted && (
          <div className="insp-submitted-banner">
            This inspection has been {inspection.status.toLowerCase()}.
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
            {remaining > 0 && completedItems > 0 && (
              <button className="btn-text" onClick={() => handleSubmit(true)} disabled={submitting}>
                Finish Anyway
              </button>
            )}
            <button
              className="btn-finish"
              onClick={() => handleSubmit()}
              disabled={submitting || remaining > 0}
            >
              {submitting ? 'Submitting...' : 'Finish Inspection'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

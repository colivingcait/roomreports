import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAutoSave } from '../hooks/useAutoSave';
import { queuePhoto } from '../lib/offlineStore';

const FLAG_CATEGORIES = [
  'Electrical', 'Plumbing', 'HVAC', 'Locks & Security', 'Appliances',
  'Pest Control', 'Exterior & Landscaping', 'Cleaning', 'Furniture & Fixtures',
  'Safety', 'Internet & Tech', 'Surfaces', 'General',
];

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

// Sort by numeric portion of room label (Room 1, Room 2, ...). Fallback to alphabetical.
function sortRooms(inspections) {
  return [...inspections].sort((a, b) => {
    const la = a.roomLabel || '';
    const lb = b.roomLabel || '';
    const na = parseInt(la.match(/\d+/)?.[0], 10);
    const nb = parseInt(lb.match(/\d+/)?.[0], 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return la.localeCompare(lb);
  });
}

// ─── Flag Detail Drawer ─────────────────────────────────

function FlagDrawer({ item, inspectionId, onUpdate }) {
  const fileRef = useRef();
  const [uploading, setUploading] = useState(false);

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      if (!navigator.onLine) {
        await queuePhoto(inspectionId, item.id, file, file.name);
        onUpdate({ ...item, photos: [...(item.photos || []), { id: `local-${Date.now()}`, url: URL.createObjectURL(file), local: true }] });
      } else {
        const form = new FormData();
        form.append('photo', file);
        const res = await fetch(`/api/inspections/${inspectionId}/items/${item.id}/photos`, { method: 'POST', credentials: 'include', body: form });
        if (res.ok) { const d = await res.json(); onUpdate({ ...item, photos: [...(item.photos || []), d.photo] }); }
      }
    } catch { /* ignore */ }
    finally { setUploading(false); fileRef.current.value = ''; }
  };

  return (
    <div className="q-flag-drawer">
      <div className="q-flag-left">
        <label className="q-flag-label">
          Category
          <select
            className="q-flag-select"
            value={item.flagCategory || ''}
            onChange={(e) => onUpdate({ ...item, flagCategory: e.target.value || null })}
          >
            <option value="">Select...</option>
            {FLAG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="q-flag-label">
          What&apos;s the issue?
          <textarea
            className="q-flag-note"
            value={item.note || ''}
            onChange={(e) => onUpdate({ ...item, note: e.target.value || null })}
            placeholder="Describe the issue..."
            rows={2}
          />
        </label>
      </div>
      <div className="q-flag-right">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: 'none' }} />
        <button className="q-flag-box" onClick={() => fileRef.current.click()} disabled={uploading}>
          <span className="q-flag-box-icon">{uploading ? '...' : '\uD83D\uDCF7'}</span>
          <span>Photo</span>
          {(item.photos?.length > 0) && <span className="q-flag-badge">{item.photos.length}</span>}
        </button>
        <button
          className={`q-flag-box q-flag-maint ${item.isMaintenance ? 'active' : ''}`}
          onClick={() => onUpdate({ ...item, isMaintenance: !item.isMaintenance })}
        >
          <span className="q-flag-box-icon">{'\uD83D\uDD27'}</span>
          <span>Maintenance</span>
        </button>
      </div>
    </div>
  );
}

// ─── Checklist Item ─────────────────────────────────────

function ChecklistItem({ item, inspectionId, saveItem, onItemUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const isPassed = item.status === 'Pass';
  const isFailed = item.status === 'Fail';

  const update = (changes) => {
    const updated = { ...item, ...changes };
    onItemUpdate(updated);
    const { photos, ...saveable } = changes;
    if (Object.keys(saveable).length) saveItem(item.id, saveable);
  };

  const handlePass = () => {
    update({ status: 'Pass', flagCategory: null, isMaintenance: false, note: null });
    setExpanded(false);
  };

  const handleFail = () => {
    update({ status: 'Fail' });
    setExpanded(true);
  };

  return (
    <div className={`q-item ${isPassed ? 'q-item-pass' : ''} ${isFailed ? 'q-item-fail' : ''}`}>
      <div className="q-item-row">
        <div className="q-item-text">{item.text}</div>
        <div className="q-item-buttons">
          <button className={`q-btn q-btn-pass ${isPassed ? 'active' : ''}`} onClick={handlePass}>
            &#10003;
          </button>
          <button className={`q-btn q-btn-fail ${isFailed ? 'active' : ''}`} onClick={handleFail}>
            &#10005;
          </button>
        </div>
      </div>
      {isFailed && expanded && (
        <FlagDrawer
          item={item}
          inspectionId={inspectionId}
          onUpdate={(updated) => {
            onItemUpdate(updated);
            const { photos, ...saveable } = updated;
            saveItem(item.id, { flagCategory: saveable.flagCategory, note: saveable.note, isMaintenance: saveable.isMaintenance });
          }}
        />
      )}
      {isFailed && !expanded && (
        <button className="q-expand-toggle" onClick={() => setExpanded(true)}>
          {item.flagCategory || 'Add details'} &#9656;
        </button>
      )}
    </div>
  );
}

// ─── Room Checklist ─────────────────────────────────────

function RoomChecklist({ inspection, onBack, onDone, propertyName }) {
  const [items, setItems] = useState(inspection.items || []);
  const { saveItem, saveStatus } = useAutoSave(inspection.id);

  const handleItemUpdate = useCallback((updated) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }, []);

  const zones = [];
  const zoneMap = {};
  for (const item of items) {
    if (!zoneMap[item.zone]) { zoneMap[item.zone] = []; zones.push(item.zone); }
    zoneMap[item.zone].push(item);
  }

  const total = items.length;
  const done = items.filter((i) => i.status).length;
  const flags = items.filter((i) => i.status === 'Fail').length;
  const progress = total > 0 ? (done / total) * 100 : 0;
  const allDone = done === total;

  return (
    <div className="q-room-page">
      <div className="q-room-header">
        <div className="q-room-header-top">
          <button className="btn-text" onClick={onBack}>&larr; Back to rooms</button>
          <div className="save-indicator">
            {saveStatus === 'saving' && <span className="save-saving">Saving...</span>}
            {saveStatus === 'saved' && <span className="save-saved">Saved &#10003;</span>}
            {saveStatus === 'offline' && <span className="save-offline">Saved locally</span>}
          </div>
        </div>
        <div className="q-room-header-info">
          <h1>{inspection.roomLabel}</h1>
          <span className="q-room-header-meta">{propertyName} &middot; Quarterly &middot; {done}/{total}</span>
        </div>
        <div className="progress-bar-container"><div className="progress-bar" style={{ width: `${progress}%` }} /></div>
      </div>

      <div className="q-room-body">
        {zones.map((zone) => (
          <div key={zone} className="q-zone">
            <h3 className="q-zone-title">{zone}</h3>
            {zoneMap[zone].map((item) => (
              <ChecklistItem
                key={item.id}
                item={item}
                inspectionId={inspection.id}
                saveItem={saveItem}
                onItemUpdate={handleItemUpdate}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="q-room-footer">
        <button className="btn-text" onClick={onBack}>&larr; Back to rooms</button>
        <button
          className="q-done-btn"
          onClick={() => onDone(items)}
          disabled={!allDone}
        >
          {allDone ? `Done with room${flags > 0 ? ` (${flags} flag${flags !== 1 ? 's' : ''})` : ''}` : `${total - done} items remaining`}
        </button>
      </div>
    </div>
  );
}

// ─── Main Quarterly Flow ────────────────────────────────

export default function QuarterlyFlow() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const propertyId = searchParams.get('propertyId');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [roomStatuses, setRoomStatuses] = useState({});
  const [nextRoomId, setNextRoomId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchBatch = useCallback(async () => {
    try {
      const d = await api('/api/inspections/quarterly-batch', {
        method: 'POST',
        body: JSON.stringify({ propertyId }),
      });
      // Sort rooms numerically
      d.inspections = sortRooms(d.inspections);
      setData(d);
      // Initialize room statuses
      const statuses = {};
      for (const insp of d.inspections) {
        const total = insp.items.length;
        const done = insp.items.filter((i) => i.status).length;
        const flags = insp.items.filter((i) => i.status === 'Fail').length;
        statuses[insp.roomId] = { total, done, flags, inspectionId: insp.id };
      }
      setRoomStatuses(statuses);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { if (propertyId) fetchBatch(); }, [propertyId, fetchBatch]);

  const handleRoomDone = (roomId, items) => {
    const total = items.length;
    const done = items.filter((i) => i.status).length;
    const flags = items.filter((i) => i.status === 'Fail').length;
    const updated = {
      ...roomStatuses,
      [roomId]: { ...roomStatuses[roomId], done, flags, total },
    };
    setRoomStatuses(updated);

    // Find the next uncompleted room (in sorted order) to highlight
    const idx = data.inspections.findIndex((i) => i.roomId === roomId);
    const nextInsp = data.inspections.slice(idx + 1).concat(data.inspections.slice(0, idx))
      .find((i) => {
        const s = updated[i.roomId];
        return !s || s.done < s.total;
      });
    setNextRoomId(nextInsp?.roomId || null);

    setActiveRoomId(null);
  };

  const handleSubmitAll = async () => {
    setSubmitting(true);
    setError('');
    try {
      for (const insp of data.inspections) {
        if (insp.status === 'DRAFT') {
          await api(`/api/inspections/${insp.id}/submit`, { method: 'POST' });
        }
      }
      navigate('/dashboard', { state: { notification: `Quarterly inspection submitted for ${data.propertyName}` } });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="page-loading">Loading quarterly inspection...</div>;
  if (error && !data) return <div className="page-container"><div className="auth-error">{error}</div></div>;
  if (!data) return null;

  // If a room is active, show its checklist
  if (activeRoomId) {
    const insp = data.inspections.find((i) => i.roomId === activeRoomId);
    if (insp) {
      return (
        <RoomChecklist
          inspection={insp}
          propertyName={data.propertyName}
          onBack={() => setActiveRoomId(null)}
          onDone={(items) => handleRoomDone(activeRoomId, items)}
        />
      );
    }
  }

  // Room grid
  const totalRooms = data.inspections.length;
  const completedRooms = Object.values(roomStatuses).filter((s) => s.done === s.total).length;
  const allRoomsDone = completedRooms === totalRooms;

  const roomStatusBadge = (roomId) => {
    const s = roomStatuses[roomId];
    if (!s || s.done === 0) return { label: 'Start', color: '#8A8583', bg: '#F0EDEB' };
    if (s.done < s.total) return { label: `${s.done}/${s.total}`, color: '#854F0B', bg: '#FAEEDA' };
    if (s.flags > 0) return { label: `Done \u00b7 ${s.flags} flag${s.flags !== 1 ? 's' : ''}`, color: '#C0392B', bg: '#FCEBEB' };
    return { label: 'Done \u2713', color: '#3B6D11', bg: '#E8F0E9' };
  };

  return (
    <div className="q-flow-page">
      <div className="q-flow-header">
        <button className="btn-text" onClick={() => navigate('/dashboard')}>&larr; Dashboard</button>
        <h1>Quarterly Inspection</h1>
        <p className="q-flow-subtitle">{data.propertyName} &middot; {completedRooms}/{totalRooms} rooms completed</p>
        <div className="progress-bar-container"><div className="progress-bar" style={{ width: `${totalRooms > 0 ? (completedRooms / totalRooms) * 100 : 0}%` }} /></div>
      </div>

      {error && <div className="auth-error" style={{ margin: '1rem 0' }}>{error}</div>}

      <div className="q-room-grid">
        {data.inspections.map((insp) => {
          const badge = roomStatusBadge(insp.roomId);
          const room = { id: insp.roomId, label: insp.roomLabel, items: insp.items };
          const s = roomStatuses[insp.roomId] || { done: 0, total: insp.items.length };
          return (
            <div
              key={insp.roomId}
              className={`q-room-card ${nextRoomId === insp.roomId ? 'q-room-card-next' : ''}`}
              onClick={() => { setActiveRoomId(insp.roomId); setNextRoomId(null); }}
            >
              <div className="q-room-card-bar" style={{ background: s.done === s.total && s.total > 0 ? '#6B8F71' : s.done > 0 ? '#C9A84C' : '#E8E4E1' }} />
              <div className="q-room-card-body">
                <div className="q-room-card-top">
                  <h3>{insp.roomLabel}</h3>
                  <span className="q-room-badge" style={{ color: badge.color, background: badge.bg }}>
                    {badge.label}
                  </span>
                </div>
                <div className="q-room-card-meta">
                  {insp.items.length} items
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="q-flow-footer">
        <button className="btn-text" onClick={() => navigate('/dashboard')}>Save &amp; exit</button>
        <button
          className="q-submit-btn"
          onClick={handleSubmitAll}
          disabled={!allRoomsDone || submitting}
        >
          {submitting ? 'Submitting...' : allRoomsDone ? 'Submit Inspection' : `${totalRooms - completedRooms} room${totalRooms - completedRooms !== 1 ? 's' : ''} remaining`}
        </button>
      </div>
    </div>
  );
}

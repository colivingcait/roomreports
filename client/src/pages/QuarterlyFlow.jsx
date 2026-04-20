import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAutoSave } from '../hooks/useAutoSave';
import { ChecklistItem } from '../components/InspectionItems';
import Modal from '../components/Modal';

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

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

// ─── Room Checklist ─────────────────────────────────────

function RoomChecklist({ inspectionId, roomLabel, onBack, onDone, propertyName, onItemsSynced }) {
  const [items, setItems] = useState([]);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const { saveItem, saveStatus } = useAutoSave(inspectionId);
  const itemsRef = useRef([]);
  const onItemsSyncedRef = useRef(onItemsSynced);
  onItemsSyncedRef.current = onItemsSynced;

  useEffect(() => {
    setLoadingRoom(true);
    fetch(`/api/inspections/${inspectionId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.inspection?.items) {
          setItems(d.inspection.items);
          itemsRef.current = d.inspection.items;
        }
      })
      .finally(() => setLoadingRoom(false));
  }, [inspectionId]);

  useEffect(() => { itemsRef.current = items; }, [items]);

  // Browser back / component unmount: sync latest items to parent so room grid reflects progress.
  useEffect(() => {
    return () => { onItemsSyncedRef.current(itemsRef.current); };
  }, []);

  const handleItemUpdate = useCallback((updated) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }, []);

  const handleBack = () => { onItemsSynced(items); onBack(); };
  const handleDone = () => { onItemsSynced(items); onDone(items); };

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
  const allDone = done === total;

  if (loadingRoom) return <div className="page-loading">Loading room...</div>;

  return (
    <div className="q-room-page">
      <div className="q-room-header">
        <div className="q-room-header-top">
          <button className="btn-text" onClick={handleBack}>&larr; Back to rooms</button>
          <div className="save-indicator">
            {saveStatus === 'saving' && <span className="save-saving">Saving...</span>}
            {saveStatus === 'saved' && <span className="save-saved">Saved &#10003;</span>}
            {saveStatus === 'offline' && <span className="save-offline">Saved locally</span>}
          </div>
        </div>
        <div className="q-room-header-info">
          <h1>{roomLabel}</h1>
          <span className="q-room-header-meta">{propertyName} &middot; Room Inspection &middot; {done}/{total}</span>
        </div>
        <div className="progress-bar-container"><div className="progress-bar" style={{ width: `${progress}%` }} /></div>
      </div>

      <div className="q-room-body">
        {zones.map((zone) => (
          <div key={zone} className="q-zone">
            <h3 className="q-zone-title">{zone}</h3>
            {zoneMap[zone].map((item) => (
              <ChecklistItem key={item.id} item={item} inspectionId={inspectionId} saveItem={saveItem} onItemUpdate={handleItemUpdate} />
            ))}
          </div>
        ))}
      </div>

      <div className="q-room-footer">
        <button className="btn-text" onClick={handleBack}>&larr; Back to rooms</button>
        <button className="q-done-btn" onClick={handleDone} disabled={!allDone}>
          {allDone ? `Done with room${flags > 0 ? ` (${flags} flag${flags !== 1 ? 's' : ''})` : ''}` : `${total - done} items remaining`}
        </button>
      </div>
    </div>
  );
}

// ─── Main Quarterly Flow ────────────────────────────────

export default function QuarterlyFlow() {
  const navigate = useNavigate();
  const { propertyId, roomId: activeRoomId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [roomStatuses, setRoomStatuses] = useState({});
  const [nextRoomId, setNextRoomId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showPartialModal, setShowPartialModal] = useState(false);
  const [partialReason, setPartialReason] = useState('');

  const fetchBatch = useCallback(async () => {
    try {
      const d = await api('/api/inspections/quarterly-batch', {
        method: 'POST',
        body: JSON.stringify({ propertyId }),
      });
      d.inspections = sortRooms(d.inspections);
      setData(d);
      const statuses = {};
      for (const insp of d.inspections) {
        const visible = insp.items.filter((i) => !i.zone?.startsWith('_'));
        statuses[insp.roomId] = {
          total: visible.length,
          done: visible.filter((i) => i.status).length,
          flags: visible.filter((i) => i.status === 'Fail').length,
          inspectionId: insp.id,
        };
      }
      setRoomStatuses(statuses);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { if (propertyId) fetchBatch(); }, [propertyId, fetchBatch]);

  const handleItemsSynced = (roomId, freshItems) => {
    setData((prev) => {
      if (!prev) return prev;
      return { ...prev, inspections: prev.inspections.map((insp) => insp.roomId === roomId ? { ...insp, items: freshItems } : insp) };
    });
    const visible = freshItems.filter((i) => !i.zone?.startsWith('_'));
    setRoomStatuses((prev) => ({
      ...prev,
      [roomId]: { ...prev[roomId], total: visible.length, done: visible.filter((i) => i.status).length, flags: visible.filter((i) => i.status === 'Fail').length },
    }));
  };

  const handleRoomDone = (doneRoomId, items) => {
    handleItemsSynced(doneRoomId, items);
    // Find next uncompleted room
    const visible = items.filter((i) => !i.zone?.startsWith('_'));
    const updatedStatuses = { ...roomStatuses, [doneRoomId]: { ...roomStatuses[doneRoomId], done: visible.filter((i) => i.status).length, total: visible.length, flags: visible.filter((i) => i.status === 'Fail').length } };
    const idx = data.inspections.findIndex((i) => i.roomId === doneRoomId);
    const nextInsp = data.inspections.slice(idx + 1).concat(data.inspections.slice(0, idx))
      .find((i) => { const s = updatedStatuses[i.roomId]; return !s || s.done < s.total; });
    setNextRoomId(nextInsp?.roomId || null);
    navigate(`/quarterly/${propertyId}`, { replace: true });
  };

  const handleBackToRooms = () => navigate(`/quarterly/${propertyId}`);

  const getIncompleteRooms = () => {
    return data.inspections.filter((insp) => {
      const vis = insp.items.filter((i) => !i.zone.startsWith('_'));
      return vis.filter((i) => i.status).length < vis.length;
    }).map((insp) => ({
      id: insp.roomId,
      label: insp.roomLabel,
      done: insp.items.filter((i) => !i.zone.startsWith('_') && i.status).length,
      total: insp.items.filter((i) => !i.zone.startsWith('_')).length,
    }));
  };

  const onSubmitClick = () => {
    if (getIncompleteRooms().length > 0) setShowPartialModal(true);
    else doSubmit(false);
  };

  const doSubmit = async (partial) => {
    setSubmitting(true);
    setError('');
    try {
      for (const insp of data.inspections) {
        if (insp.status !== 'DRAFT') continue;
        const vis = insp.items.filter((i) => !i.zone.startsWith('_'));
        const isIncomplete = vis.filter((i) => i.status).length < vis.length;
        const body = partial && isIncomplete ? { partial: true, partialReason } : {};
        await api(`/api/inspections/${insp.id}/submit`, { method: 'POST', body: JSON.stringify(body) });
      }
      navigate('/dashboard', { state: { notification: `Room inspection submitted for ${data.propertyName}` } });
    } catch (err) {
      setError(err.message);
      setShowPartialModal(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="page-loading">Loading room inspection...</div>;
  if (error && !data) return <div className="page-container"><div className="auth-error">{error}</div></div>;
  if (!data) return null;

  if (activeRoomId) {
    const insp = data.inspections.find((i) => i.roomId === activeRoomId);
    if (insp) {
      return (
        <RoomChecklist
          inspectionId={insp.id} roomLabel={insp.roomLabel} propertyName={data.propertyName}
          onBack={handleBackToRooms} onDone={(items) => handleRoomDone(activeRoomId, items)}
          onItemsSynced={(freshItems) => handleItemsSynced(activeRoomId, freshItems)}
        />
      );
    }
  }

  const totalRooms = data.inspections.length;
  const completedRooms = Object.values(roomStatuses).filter((s) => s.done === s.total).length;

  const roomStatusBadge = (rid) => {
    const s = roomStatuses[rid];
    if (!s || s.done === 0) return { label: 'Start', color: '#8A8583', bg: '#F0EDEB' };
    if (s.done < s.total) return { label: `${s.done}/${s.total}`, color: '#854F0B', bg: '#FAEEDA' };
    if (s.flags > 0) return { label: `Done \u00b7 ${s.flags} flag${s.flags !== 1 ? 's' : ''}`, color: '#C0392B', bg: '#FCEBEB' };
    return { label: 'Done \u2713', color: '#3B6D11', bg: '#E8F0E9' };
  };

  return (
    <div className="q-flow-page">
      <div className="q-flow-header">
        <button className="btn-text" onClick={() => navigate('/dashboard')}>Save &amp; exit</button>
        <h1>Room Inspection</h1>
        <p className="q-flow-subtitle">{data.propertyName} &middot; {completedRooms}/{totalRooms} rooms completed</p>
        <div className="progress-bar-container"><div className="progress-bar" style={{ width: `${totalRooms > 0 ? (completedRooms / totalRooms) * 100 : 0}%` }} /></div>
      </div>

      {error && <div className="auth-error" style={{ margin: '1rem 0' }}>{error}</div>}

      <div className="q-room-grid">
        {data.inspections.map((insp) => {
          const badge = roomStatusBadge(insp.roomId);
          const s = roomStatuses[insp.roomId] || { done: 0, total: insp.items.length };
          return (
            <div key={insp.roomId} className={`q-room-card ${nextRoomId === insp.roomId ? 'q-room-card-next' : ''}`}
              onClick={() => { setNextRoomId(null); navigate(`/quarterly/${propertyId}/${insp.roomId}`); }}>
              <div className="q-room-card-bar" style={{ background: s.done === s.total && s.total > 0 ? '#6B8F71' : s.done > 0 ? '#C9A84C' : '#E8E4E1' }} />
              <div className="q-room-card-body">
                <div className="q-room-card-top">
                  <h3>{insp.roomLabel}</h3>
                  <span className="q-room-badge" style={{ color: badge.color, background: badge.bg }}>{badge.label}</span>
                </div>
                <div className="q-room-card-meta">{insp.items.length} items</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="q-flow-footer">
        <button className="btn-text" onClick={() => navigate('/dashboard')}>Save &amp; exit</button>
        <button className="q-submit-btn" onClick={onSubmitClick} disabled={submitting}>
          {submitting ? 'Submitting...' : 'Submit Inspection'}
        </button>
      </div>

      <Modal open={showPartialModal} onClose={() => { setShowPartialModal(false); setPartialReason(''); }} title="Partial Submission">
        <div className="modal-form">
          <p style={{ fontSize: '0.9rem', color: '#4A4543', marginBottom: '0.5rem' }}>The following rooms are not complete:</p>
          <ul className="partial-room-list">
            {getIncompleteRooms().map((r) => <li key={r.id}><strong>{r.label}</strong> ({r.done}/{r.total} items)</li>)}
          </ul>
          <label>
            Reason for partial submission
            <textarea className="detail-textarea" value={partialReason} onChange={(e) => setPartialReason(e.target.value)} placeholder="e.g. Room 3 locked — resident not home" rows={3} />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button className="btn-secondary" onClick={() => { setShowPartialModal(false); setPartialReason(''); }}>Go back</button>
            <button className="btn-primary" style={{ width: 'auto' }} onClick={() => doSubmit(true)} disabled={submitting || !partialReason.trim()}>
              {submitting ? 'Submitting...' : 'Submit anyway'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

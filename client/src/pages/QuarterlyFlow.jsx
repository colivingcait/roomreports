import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAutoSave } from '../hooks/useAutoSave';
import { ChecklistItem } from '../components/InspectionItems';

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

const MAINTENANCE_ZONES = ['Room Condition', 'Safety', 'Features'];
const COMPLIANCE_ZONES = ['Compliance'];
const MISC_ZONES = ['Misc'];

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

function visibleItems(items) {
  return items.filter((i) => !i.zone?.startsWith('_'));
}

function roomState(items) {
  const vis = visibleItems(items);
  const total = vis.length;
  const done = vis.filter((i) => i.status).length;
  if (total === 0) return 'not-started';
  if (done === 0) return 'not-started';
  if (done < total) return 'in-progress';
  return 'complete';
}

// ─── Progress Stepper ──────────────────────────────────

function ProgressStepper({ active }) {
  const steps = [
    { key: 'maintenance', label: 'Maintenance' },
    { key: 'compliance', label: 'Compliance' },
    { key: 'misc', label: 'Misc' },
  ];
  const activeIdx = steps.findIndex((s) => s.key === active);

  return (
    <div className="q-stepper">
      {steps.map((s, i) => {
        const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'upcoming';
        return (
          <div key={s.key} className={`q-stepper-step q-stepper-${state}`}>
            <div className="q-stepper-dot">{i < activeIdx ? '\u2713' : i + 1}</div>
            <div className="q-stepper-label">{s.label}</div>
            {i < steps.length - 1 && <div className="q-stepper-line" />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Maintenance Screen ────────────────────────────────

function MaintenanceScreen({ items, inspectionId, saveItem, onItemUpdate, onNext }) {
  const zoneItems = visibleItems(items).filter((i) => MAINTENANCE_ZONES.includes(i.zone));
  const zones = [];
  const zoneMap = {};
  for (const it of zoneItems) {
    if (!zoneMap[it.zone]) { zoneMap[it.zone] = []; zones.push(it.zone); }
    zoneMap[it.zone].push(it);
  }

  const done = zoneItems.filter((i) => i.status).length;
  const total = zoneItems.length;

  return (
    <>
      <div className="q-screen-body">
        <div className="q-screen-intro">
          <h2 className="q-screen-title">Maintenance Items</h2>
          <p className="q-screen-sub">Mark each item pass or fail. Flag anything needing attention.</p>
          {total > 0 && <div className="q-screen-count">{done} of {total} checked</div>}
        </div>
        {zones.map((zone) => (
          <div key={zone} className="q-zone">
            <h3 className="q-zone-title">{zone}</h3>
            {zoneMap[zone].map((item) => (
              <ChecklistItem
                key={item.id}
                item={item}
                inspectionId={inspectionId}
                saveItem={saveItem}
                onItemUpdate={onItemUpdate}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="q-screen-footer">
        <button className="q-next-btn" onClick={onNext}>
          Next: Compliance &rarr;
        </button>
      </div>
    </>
  );
}

// ─── Room Inspection (multi-screen) ────────────────────

function RoomInspection({ inspectionId, roomLabel, propertyName, onBack, onItemsSynced }) {
  const [items, setItems] = useState([]);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [screen, setScreen] = useState('maintenance');
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

  useEffect(() => {
    return () => { onItemsSyncedRef.current(itemsRef.current); };
  }, []);

  const handleItemUpdate = useCallback((updated) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }, []);

  const handleBack = () => { onItemsSynced(items); onBack(); };

  if (loadingRoom) return <div className="page-loading">Loading room...</div>;

  return (
    <div className="q-room-page">
      <div className="q-room-header">
        <div className="q-room-header-top">
          <button className="btn-text" onClick={handleBack}>&larr; Rooms</button>
          <div className="save-indicator">
            {saveStatus === 'saving' && <span className="save-saving">Saving...</span>}
            {saveStatus === 'saved' && <span className="save-saved">Saved &#10003;</span>}
            {saveStatus === 'offline' && <span className="save-offline">Saved locally</span>}
          </div>
        </div>
        <div className="q-room-header-info">
          <h1>{roomLabel}</h1>
          <span className="q-room-header-meta">{propertyName}</span>
        </div>
        <ProgressStepper active={screen} />
      </div>

      {screen === 'maintenance' && (
        <MaintenanceScreen
          items={items}
          inspectionId={inspectionId}
          saveItem={saveItem}
          onItemUpdate={handleItemUpdate}
          onNext={() => setScreen('compliance')}
        />
      )}
    </div>
  );
}

// ─── Room Selector Grid ────────────────────────────────

function RoomCard({ inspection, onClick }) {
  const state = roomState(inspection.items);
  const vis = visibleItems(inspection.items);
  const done = vis.filter((i) => i.status).length;
  const total = vis.length;

  return (
    <button className={`q-grid-card q-grid-card-${state}`} onClick={onClick}>
      <div className="q-grid-card-label">{inspection.roomLabel}</div>
      <div className="q-grid-card-state">
        {state === 'complete' && <span className="q-grid-card-check">&#10003;</span>}
        {state === 'in-progress' && <span className="q-grid-card-progress">{done}/{total}</span>}
        {state === 'not-started' && <span className="q-grid-card-start">Start</span>}
      </div>
    </button>
  );
}

// ─── Main Page ─────────────────────────────────────────

export default function QuarterlyFlow() {
  const navigate = useNavigate();
  const { propertyId, roomId: activeRoomId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchBatch = useCallback(async () => {
    try {
      const d = await api('/api/inspections/quarterly-batch', {
        method: 'POST',
        body: JSON.stringify({ propertyId }),
      });
      d.inspections = sortRooms(d.inspections);
      setData(d);
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
      return { ...prev, inspections: prev.inspections.map((insp) =>
        insp.roomId === roomId ? { ...insp, items: freshItems } : insp
      ) };
    });
  };

  const doSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      for (const insp of data.inspections) {
        if (insp.status !== 'DRAFT') continue;
        await api(`/api/inspections/${insp.id}/submit`, { method: 'POST', body: JSON.stringify({}) });
      }
      navigate('/dashboard', { state: { notification: `Room inspection submitted for ${data.propertyName}` } });
    } catch (err) {
      setError(err.message);
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
        <RoomInspection
          inspectionId={insp.id}
          roomLabel={insp.roomLabel}
          propertyName={data.propertyName}
          onBack={() => navigate(`/quarterly/${propertyId}`)}
          onItemsSynced={(freshItems) => handleItemsSynced(activeRoomId, freshItems)}
        />
      );
    }
  }

  const totalRooms = data.inspections.length;
  const completedRooms = data.inspections.filter((i) => roomState(i.items) === 'complete').length;

  return (
    <div className="q-flow-page">
      <div className="q-flow-header">
        <button className="btn-text" onClick={() => navigate('/dashboard')}>&larr; Save &amp; exit</button>
        <h1>Room Inspection</h1>
        <p className="q-flow-subtitle">{data.propertyName}</p>
        <div className="q-flow-counter">{completedRooms} of {totalRooms} done</div>
      </div>

      {error && <div className="auth-error" style={{ margin: '1rem 0' }}>{error}</div>}

      <div className="q-grid">
        {data.inspections.map((insp) => (
          <RoomCard
            key={insp.roomId}
            inspection={insp}
            onClick={() => navigate(`/quarterly/${propertyId}/${insp.roomId}`)}
          />
        ))}
      </div>

      <div className="q-flow-footer">
        <button className="q-submit-btn" onClick={doSubmit} disabled={submitting}>
          {submitting ? 'Submitting...' : 'Submit Inspection'}
        </button>
      </div>
    </div>
  );
}

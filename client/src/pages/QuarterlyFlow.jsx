import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAutoSave } from '../hooks/useAutoSave';
import { ChecklistItem } from '../components/InspectionItems';
import { queuePhoto } from '../lib/offlineStore';
import Modal from '../components/Modal';

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

const MAINTENANCE_ZONES = ['Room Condition', 'Safety', 'Features'];
const COMPLIANCE_ZONE = 'Compliance';
const MISC_ZONE = 'Misc';

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

// ─── Shared photo uploader ─────────────────────────────

function usePhotoUpload(inspectionId, item, onItemUpdate) {
  const fileRef = useRef();
  const [uploading, setUploading] = useState(false);

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      if (!navigator.onLine) {
        await queuePhoto(inspectionId, item.id, file, file.name);
        onItemUpdate({ ...item, photos: [...(item.photos || []), { id: `local-${Date.now()}`, url: URL.createObjectURL(file), local: true }] });
      } else {
        const form = new FormData();
        form.append('photo', file);
        const res = await fetch(`/api/inspections/${inspectionId}/items/${item.id}/photos`, { method: 'POST', credentials: 'include', body: form });
        if (res.ok) {
          const d = await res.json();
          onItemUpdate({ ...item, photos: [...(item.photos || []), d.photo] });
        }
      }
    } catch { /* ignore */ }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return { fileRef, uploading, handlePhoto };
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

// ─── Screen 1: Maintenance ─────────────────────────────

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

// ─── Compliance Pill (selected → detail card) ──────────

function CompliancePill({ item, inspectionId, onUpdate }) {
  const { fileRef, uploading, handlePhoto } = usePhotoUpload(inspectionId, item, onUpdate);
  const isViolation = item.status === 'Fail';

  const toggle = () => {
    if (isViolation) {
      onUpdate({ ...item, status: '', note: null, isMaintenance: false });
    } else {
      onUpdate({ ...item, status: 'Fail' });
    }
  };

  return (
    <div className={`q-pill-wrap ${isViolation ? 'q-pill-wrap-selected' : ''}`}>
      <button className={`q-pill ${isViolation ? 'q-pill-selected' : ''}`} onClick={toggle}>
        <span className="q-pill-icon">{isViolation ? '\u2715' : '\u00b7'}</span>
        <span className="q-pill-label">{item.text}</span>
      </button>
      {isViolation && (
        <div className="q-pill-detail">
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
          <div className="q-pill-detail-actions">
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: 'none' }} />
            <button className="q-flag-box" onClick={() => fileRef.current.click()} disabled={uploading}>
              <span className="q-flag-box-icon">{uploading ? '...' : '\uD83D\uDCF7'}</span>
              <span>Photo</span>
              {(item.photos?.length > 0) && <span className="q-flag-badge">{item.photos.length}</span>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Screen 2: Lease Compliance ────────────────────────

function ComplianceScreen({ items, inspectionId, saveItem, onItemUpdate, onNext }) {
  const complianceItems = visibleItems(items).filter((i) => i.zone === COMPLIANCE_ZONE);
  const anySelected = complianceItems.some((i) => i.status === 'Fail');
  const violationCount = complianceItems.filter((i) => i.status === 'Fail').length;

  const handlePillUpdate = (updated) => {
    onItemUpdate(updated);
    saveItem(updated.id, {
      status: updated.status || '',
      note: updated.note,
      isMaintenance: updated.isMaintenance,
    });
  };

  const markAllClear = () => {
    complianceItems.forEach((it) => {
      const cleared = { ...it, status: 'Pass', note: null, isMaintenance: false };
      onItemUpdate(cleared);
      saveItem(it.id, { status: 'Pass', note: null, isMaintenance: false });
    });
    onNext();
  };

  return (
    <>
      <div className="q-screen-body">
        <div className="q-screen-intro">
          <h2 className="q-screen-title">Lease Compliance</h2>
          <p className="q-screen-sub">Tap any violations you observe. Add details when selected.</p>
          {violationCount > 0 && (
            <div className="q-screen-count q-screen-count-fail">
              {violationCount} violation{violationCount !== 1 ? 's' : ''} noted
            </div>
          )}
        </div>

        <div className="q-pill-list">
          {complianceItems.map((item) => (
            <CompliancePill
              key={item.id}
              item={item}
              inspectionId={inspectionId}
              onUpdate={handlePillUpdate}
            />
          ))}
        </div>
      </div>

      <div className="q-screen-footer q-screen-footer-split">
        {!anySelected && (
          <button className="q-allclear-btn" onClick={markAllClear}>
            All clear &#10003;
          </button>
        )}
        <button className="q-next-btn" onClick={onNext}>
          Next: Misc &rarr;
        </button>
      </div>
    </>
  );
}

// ─── Screen 3: Misc ────────────────────────────────────

function MiscScreen({ items, inspectionId, saveItem, onItemUpdate, roomLabel, onDone }) {
  const miscItem = visibleItems(items).find((i) => i.zone === MISC_ZONE);
  const { fileRef, uploading, handlePhoto } = usePhotoUpload(inspectionId, miscItem || {}, onItemUpdate);

  if (!miscItem) {
    return (
      <div className="q-screen-body">
        <div className="q-screen-intro">
          <h2 className="q-screen-title">Misc</h2>
          <p className="q-screen-sub">No misc item on this inspection.</p>
        </div>
        <div className="q-screen-footer">
          <button className="q-next-btn" onClick={onDone}>Done &rarr;</button>
        </div>
      </div>
    );
  }

  const update = (changes) => {
    const updated = { ...miscItem, ...changes };
    onItemUpdate(updated);
    const { photos, ...saveable } = changes;
    if (Object.keys(saveable).length) saveItem(miscItem.id, saveable);
  };

  const handleDone = () => {
    // If anything was entered, mark as Fail with the notes; otherwise leave as is.
    const hasContent = miscItem.note || miscItem.isMaintenance || (miscItem.photos?.length > 0);
    if (hasContent && miscItem.status !== 'Fail') {
      update({ status: 'Fail' });
    } else if (!miscItem.status) {
      update({ status: 'Pass' });
    }
    onDone();
  };

  const handleSkip = () => {
    update({ status: 'Pass', note: null, isMaintenance: false });
    onDone();
  };

  return (
    <>
      <div className="q-screen-body">
        <div className="q-screen-intro">
          <h2 className="q-screen-title">Misc</h2>
          <p className="q-screen-sub">Anything else worth reporting? Notes, a photo, or flag for maintenance.</p>
        </div>

        <div className="q-misc-card">
          <label className="q-flag-label">
            Notes
            <textarea
              className="q-flag-note q-misc-note"
              value={miscItem.note || ''}
              onChange={(e) => update({ note: e.target.value || null })}
              placeholder="Anything not covered above..."
              rows={4}
            />
          </label>

          <div className="q-misc-actions">
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: 'none' }} />
            <button className="q-flag-box" onClick={() => fileRef.current.click()} disabled={uploading}>
              <span className="q-flag-box-icon">{uploading ? '...' : '\uD83D\uDCF7'}</span>
              <span>Photo</span>
              {(miscItem.photos?.length > 0) && <span className="q-flag-badge">{miscItem.photos.length}</span>}
            </button>
            <button
              className={`q-flag-box q-flag-maint ${miscItem.isMaintenance ? 'active' : ''}`}
              onClick={() => update({ isMaintenance: !miscItem.isMaintenance })}
            >
              <span className="q-flag-box-icon">{'\uD83D\uDD27'}</span>
              <span>Maintenance</span>
            </button>
          </div>
        </div>
      </div>

      <div className="q-screen-footer q-screen-footer-split">
        <button className="q-skip-btn" onClick={handleSkip}>
          Skip &mdash; nothing to report
        </button>
        <button className="q-done-room-btn" onClick={handleDone}>
          Done with {roomLabel} &rarr;
        </button>
      </div>
    </>
  );
}

// ─── Room Inspection (multi-screen) ────────────────────

function RoomInspection({ inspectionId, roomLabel, propertyName, onBack, onItemsSynced, onRoomDone }) {
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
  const handleDone = () => { onItemsSynced(itemsRef.current); onRoomDone(); };

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
      {screen === 'compliance' && (
        <ComplianceScreen
          items={items}
          inspectionId={inspectionId}
          saveItem={saveItem}
          onItemUpdate={handleItemUpdate}
          onNext={() => setScreen('misc')}
        />
      )}
      {screen === 'misc' && (
        <MiscScreen
          items={items}
          inspectionId={inspectionId}
          saveItem={saveItem}
          onItemUpdate={handleItemUpdate}
          roomLabel={roomLabel}
          onDone={handleDone}
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

// ─── Common Area Quick Check ───────────────────────────

function CommonAreaQuickCheck({ quickCheck, onItemsUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const { saveItem, saveStatus } = useAutoSave(quickCheck?.id);

  if (!quickCheck) return null;

  const items = visibleItems(quickCheck.items || []);
  if (!items.length) return null;

  const done = items.filter((i) => i.status).length;
  const total = items.length;

  const zones = [];
  const zoneMap = {};
  for (const it of items) {
    if (!zoneMap[it.zone]) { zoneMap[it.zone] = []; zones.push(it.zone); }
    zoneMap[it.zone].push(it);
  }

  const toggle = (item, newStatus) => {
    const updated = { ...item, status: newStatus || '' };
    onItemsUpdate(quickCheck.items.map((i) => (i.id === item.id ? updated : i)));
    saveItem(item.id, { status: updated.status });
  };

  return (
    <div className="q-common-section">
      <button className="q-common-toggle" onClick={() => setExpanded(!expanded)}>
        <span className="q-common-toggle-label">
          Common Area Quick Check <span className="q-common-toggle-sub">(optional &middot; {done}/{total})</span>
        </span>
        <span className="q-common-toggle-right">
          {saveStatus === 'saving' && <span className="save-saving">Saving...</span>}
          {saveStatus === 'saved' && <span className="save-saved">Saved &#10003;</span>}
          <span className={`q-common-toggle-chev ${expanded ? 'open' : ''}`}>&#9656;</span>
        </span>
      </button>
      {expanded && (
        <div className="q-common-body">
          {zones.map((zone) => (
            <div key={zone} className="q-common-zone">
              <h4 className="q-common-zone-title">{zone}</h4>
              <div className="q-common-grid">
                {zoneMap[zone].map((item) => {
                  const status = item.status;
                  return (
                    <div key={item.id} className={`q-common-card q-common-card-${status || 'none'}`}>
                      <div className="q-common-card-label">{item.text}</div>
                      <div className="q-common-card-buttons">
                        <button
                          className={`q-btn q-btn-pass ${status === 'Pass' ? 'active' : ''}`}
                          onClick={() => toggle(item, status === 'Pass' ? '' : 'Pass')}
                        >&#10003;</button>
                        <button
                          className={`q-btn q-btn-fail ${status === 'Fail' ? 'active' : ''}`}
                          onClick={() => toggle(item, status === 'Fail' ? '' : 'Fail')}
                        >&#10005;</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
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

  const handleQuickItemsUpdate = (freshItems) => {
    setData((prev) => prev && ({ ...prev, commonAreaQuick: { ...prev.commonAreaQuick, items: freshItems } }));
  };

  const getIncompleteRooms = () => {
    if (!data) return [];
    return data.inspections
      .filter((insp) => insp.status === 'DRAFT')
      .map((insp) => {
        const vis = visibleItems(insp.items);
        const done = vis.filter((i) => i.status).length;
        return { id: insp.roomId, label: insp.roomLabel, done, total: vis.length, inspectionId: insp.id };
      })
      .filter((r) => r.done < r.total);
  };

  const quickCheckSummary = () => {
    if (!data?.commonAreaQuick) return null;
    const vis = visibleItems(data.commonAreaQuick.items);
    const done = vis.filter((i) => i.status).length;
    return { id: data.commonAreaQuick.id, done, total: vis.length, started: done > 0 };
  };

  const onSubmitClick = () => {
    const incomplete = getIncompleteRooms();
    const quick = quickCheckSummary();
    const quickPartial = quick && quick.started && quick.done < quick.total;
    if (incomplete.length > 0 || quickPartial) setShowPartialModal(true);
    else doSubmit(false);
  };

  const doSubmit = async (partial) => {
    setSubmitting(true);
    setError('');
    try {
      for (const insp of data.inspections) {
        if (insp.status !== 'DRAFT') continue;
        const vis = visibleItems(insp.items);
        const isIncomplete = vis.filter((i) => i.status).length < vis.length;
        const body = partial && isIncomplete ? { partial: true, partialReason } : {};
        await api(`/api/inspections/${insp.id}/submit`, { method: 'POST', body: JSON.stringify(body) });
      }

      // Submit the quick check only if the user actually used it
      const quick = quickCheckSummary();
      if (quick && quick.started) {
        const isIncomplete = quick.done < quick.total;
        const body = partial && isIncomplete ? { partial: true, partialReason } : {};
        await api(`/api/inspections/${quick.id}/submit`, { method: 'POST', body: JSON.stringify(body) });
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
        <RoomInspection
          inspectionId={insp.id}
          roomLabel={insp.roomLabel}
          propertyName={data.propertyName}
          onBack={() => navigate(`/quarterly/${propertyId}`)}
          onItemsSynced={(freshItems) => handleItemsSynced(activeRoomId, freshItems)}
          onRoomDone={() => navigate(`/quarterly/${propertyId}`)}
        />
      );
    }
  }

  const totalRooms = data.inspections.length;
  const completedRooms = data.inspections.filter((i) => roomState(i.items) === 'complete').length;
  const incompleteRooms = getIncompleteRooms();
  const quick = quickCheckSummary();
  const quickPartial = quick && quick.started && quick.done < quick.total;

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

      <CommonAreaQuickCheck
        quickCheck={data.commonAreaQuick}
        onItemsUpdate={handleQuickItemsUpdate}
      />

      <div className="q-flow-footer">
        <button className="q-submit-btn" onClick={onSubmitClick} disabled={submitting}>
          {submitting ? 'Submitting...' : 'Submit Inspection'}
        </button>
      </div>

      <Modal
        open={showPartialModal}
        onClose={() => { setShowPartialModal(false); setPartialReason(''); setError(''); }}
        title="Some rooms weren't fully checked"
      >
        <div className="modal-form">
          <p className="partial-intro">
            The following {incompleteRooms.length === 1 ? 'room is' : `${incompleteRooms.length} rooms are`} incomplete.
            Tell us why so the property manager can follow up.
          </p>
          <ul className="partial-room-list">
            {incompleteRooms.map((r) => (
              <li key={r.id}>
                <strong>{r.label}</strong> &mdash; {r.done}/{r.total} items checked
              </li>
            ))}
            {quickPartial && (
              <li>
                <strong>Common Area Quick Check</strong> &mdash; {quick.done}/{quick.total} items checked
              </li>
            )}
          </ul>
          <label>
            Reason for partial submission
            <textarea
              className="detail-textarea"
              value={partialReason}
              onChange={(e) => setPartialReason(e.target.value)}
              placeholder="e.g. Room 3 locked — resident not home. Couldn't access kitchen 2."
              rows={3}
              autoFocus
            />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <div className="modal-actions">
            <button
              className="btn-secondary"
              onClick={() => { setShowPartialModal(false); setPartialReason(''); setError(''); }}
              disabled={submitting}
            >
              Keep going
            </button>
            <button
              className="btn-primary"
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

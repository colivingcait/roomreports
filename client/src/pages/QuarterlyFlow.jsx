import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAutoSave } from '../hooks/useAutoSave';
import { queuePhoto } from '../lib/offlineStore';
import Modal from '../components/Modal';
import { FLAG_CATEGORIES, pillColors } from '../../../shared/index.js';

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

const MAINTENANCE_ZONE = 'Maintenance';
const FEATURE_ZONES = [
  'Ensuite Bathroom',
  'Mini Fridge',
  'Window AC',
  'Microwave',
  'Basement Room',
  'Separate Entry',
];
const COMPLIANCE_ZONE = 'Compliance';
const MISC_ZONE = 'Misc';
const COMPLETED_ZONE = '_Completed';

// Canonical pill order — items are rendered in this exact order on every
// room's compliance screen regardless of DB insertion order.
const COMPLIANCE_PILL_ORDER = [
  'Messy',
  'Bad odor',
  'Smoking',
  'Unauthorized guests',
  'Pets',
  'Open food',
  'Pests/bugs',
  'Open flames/candles',
  'Overloaded outlets',
  'Kitchen appliances in room',
  'Lithium batteries',
  'Modifications (paint, holes, etc.)',
  'Drug paraphernalia',
  'Weapons',
  'Unclear egress path',
];

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

function isRoomComplete(items) {
  return items.some((i) => i.zone === COMPLETED_ZONE && i.status === 'Yes');
}

function hasAnyProgress(items) {
  return visibleItems(items).some((i) => i.status);
}

function roomState(items) {
  if (isRoomComplete(items)) return 'complete';
  if (hasAnyProgress(items)) return 'in-progress';
  return 'not-started';
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

// ─── 4-step Progress Stepper ───────────────────────────

function ProgressStepper({ active, onStepClick }) {
  const steps = [
    { key: 'rooms', label: 'Rooms' },
    { key: 'maintenance', label: 'Maintenance' },
    { key: 'compliance', label: 'Compliance' },
    { key: 'misc', label: 'Misc' },
  ];
  const activeIdx = steps.findIndex((s) => s.key === active);

  return (
    <div className="q-stepper">
      {steps.map((s, i) => {
        const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'upcoming';
        const clickable = i <= activeIdx;
        return (
          <div
            key={s.key}
            className={`q-stepper-step q-stepper-${state} ${clickable ? 'q-stepper-clickable' : ''}`}
            onClick={() => clickable && onStepClick?.(s.key)}
            role={clickable ? 'button' : undefined}
          >
            <div className="q-stepper-dot">{i < activeIdx ? '\u2713' : i + 1}</div>
            <div className="q-stepper-label">{s.label}</div>
            {i < steps.length - 1 && <div className="q-stepper-line" />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Generic pass/fail checklist item (no section headings) ─

function FlagDrawerMini({ item, inspectionId, onUpdate }) {
  const { fileRef, uploading, handlePhoto } = usePhotoUpload(inspectionId, item, onUpdate);
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
          Task Name
          <textarea
            className="q-flag-note"
            value={item.note || ''}
            onChange={(e) => onUpdate({ ...item, note: e.target.value || null })}
            placeholder="e.g. Lock needs new batteries"
            rows={2}
          />
        </label>
      </div>
      <div className="q-flag-right">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: 'none' }} />
        <button type="button" className="q-flag-box" onClick={() => fileRef.current.click()} disabled={uploading}>
          <span className="q-flag-box-icon">{uploading ? '...' : '\uD83D\uDCF7'}</span>
          <span>Photo</span>
          {(item.photos?.length > 0) && <span className="q-flag-badge">{item.photos.length}</span>}
        </button>
        <button
          type="button"
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

function PassFailItem({ item, inspectionId, saveItem, onItemUpdate }) {
  const isPassed = item.status === 'Pass';
  const isFailed = item.status === 'Fail';

  const update = (changes) => {
    const updated = { ...item, ...changes };
    onItemUpdate(updated);
    const { photos, ...saveable } = changes;
    if (Object.keys(saveable).length) saveItem(item.id, saveable);
  };

  const handleDrawerUpdate = (updated) => {
    onItemUpdate(updated);
    saveItem(item.id, {
      flagCategory: updated.flagCategory,
      note: updated.note,
      isMaintenance: updated.isMaintenance,
    });
  };

  return (
    <div className={`q-item ${isPassed ? 'q-item-pass' : ''} ${isFailed ? 'q-item-fail' : ''}`}>
      <div className="q-item-row">
        <div className="q-item-text">{item.text}</div>
        <div className="q-item-buttons">
          <button
            className={`q-btn q-btn-pass ${isPassed ? 'active' : ''}`}
            onClick={() => update({ status: 'Pass', flagCategory: null, isMaintenance: false, note: null })}
          >&#10003;</button>
          <button
            className={`q-btn q-btn-fail ${isFailed ? 'active' : ''}`}
            onClick={() => update({ status: 'Fail' })}
          >&#10005;</button>
        </div>
      </div>
      {isFailed && (
        <FlagDrawerMini item={item} inspectionId={inspectionId} onUpdate={handleDrawerUpdate} />
      )}
    </div>
  );
}

// ─── Screen 2: Maintenance ─────────────────────────────

function MaintenanceScreen({ items, inspectionId, saveItem, onItemUpdate, onBack, onNext }) {
  const coreItems = items.filter((i) => i.zone === MAINTENANCE_ZONE);

  // Group feature items by zone, preserving order
  const featureGroups = [];
  const featureMap = {};
  for (const it of items) {
    if (!FEATURE_ZONES.includes(it.zone)) continue;
    if (!featureMap[it.zone]) {
      featureMap[it.zone] = [];
      featureGroups.push(it.zone);
    }
    featureMap[it.zone].push(it);
  }

  return (
    <>
      <div className="q-screen-body">
        {coreItems.map((item) => (
          <PassFailItem
            key={item.id}
            item={item}
            inspectionId={inspectionId}
            saveItem={saveItem}
            onItemUpdate={onItemUpdate}
          />
        ))}

        {featureGroups.map((zone) => (
          <div key={zone} className="q-feature-group">
            <div className="q-feature-divider" />
            <div className="q-feature-label">{zone}</div>
            {featureMap[zone].map((item) => (
              <PassFailItem
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

      <div className="q-screen-footer q-screen-footer-dual">
        <button className="q-back-btn" onClick={onBack}>&larr; Back</button>
        <button className="q-next-btn" onClick={onNext}>Next: Compliance &rarr;</button>
      </div>
    </>
  );
}

// ─── Screen 3: Lease Compliance ────────────────────────

function ComplianceScreen({ items, inspectionId, saveItem, onItemUpdate, onBack, onNext }) {
  // Hardcoded canonical order — don't trust DB ordering.
  const byText = new Map();
  for (const it of items) {
    if (it.zone === COMPLIANCE_ZONE) byText.set(it.text, it);
  }
  const pills = COMPLIANCE_PILL_ORDER
    .map((text) => byText.get(text))
    .filter(Boolean);
  const selected = pills.filter((p) => p.status === 'Fail');

  const togglePill = (pill) => {
    if (pill.status === 'Fail') {
      const cleared = { ...pill, status: '', note: null, isLeaseViolation: false };
      onItemUpdate(cleared);
      saveItem(pill.id, { status: '', note: null, isLeaseViolation: false });
    } else {
      const flagged = { ...pill, status: 'Fail', isLeaseViolation: true };
      onItemUpdate(flagged);
      saveItem(pill.id, { status: 'Fail', isLeaseViolation: true });
    }
  };

  const handleDetailUpdate = (updated) => {
    onItemUpdate(updated);
    saveItem(updated.id, { note: updated.note });
  };

  return (
    <>
      <div className="q-screen-body">
        <h2 className="q-screen-title">Select any that apply:</h2>

        <div className="q-compliance-grid">
          {pills.map((p) => {
            const c = pillColors(p.text);
            return (
              <button
                key={p.id}
                type="button"
                className={`q-compliance-card ${p.status === 'Fail' ? 'selected' : ''}`}
                style={{
                  '--pill-bg': c.bg,
                  '--pill-fg': c.fg,
                  '--pill-border': c.border,
                  '--pill-sel-bg': c.selBg,
                  '--pill-sel-fg': c.selFg,
                }}
                onClick={() => togglePill(p)}
              >
                {p.text}
              </button>
            );
          })}
        </div>

        {selected.length > 0 && (
          <div className="q-compliance-details">
            {selected.map((p) => (
              <ComplianceDetailCard
                key={p.id}
                item={p}
                inspectionId={inspectionId}
                onUpdate={handleDetailUpdate}
              />
            ))}
          </div>
        )}
      </div>

      <div className="q-screen-footer q-screen-footer-dual">
        <button className="q-back-btn" onClick={onBack}>&larr; Back</button>
        <button className="q-next-btn" onClick={onNext}>Next: Misc &rarr;</button>
      </div>
    </>
  );
}

function ComplianceDetailCard({ item, inspectionId, onUpdate }) {
  const { fileRef, uploading, handlePhoto } = usePhotoUpload(inspectionId, item, onUpdate);
  return (
    <div className="q-compliance-detail">
      <div className="q-compliance-detail-header">{item.text}</div>
      <textarea
        className="q-flag-note"
        value={item.note || ''}
        onChange={(e) => onUpdate({ ...item, note: e.target.value || null })}
        placeholder="Add details..."
        rows={2}
      />
      <div className="q-compliance-detail-actions">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: 'none' }} />
        <button type="button" className="q-flag-box" onClick={() => fileRef.current.click()} disabled={uploading}>
          <span className="q-flag-box-icon">{uploading ? '...' : '\uD83D\uDCF7'}</span>
          <span>Photo</span>
          {(item.photos?.length > 0) && <span className="q-flag-badge">{item.photos.length}</span>}
        </button>
      </div>
    </div>
  );
}

// ─── Screen 4: Misc (dynamic items) ────────────────────

function MiscScreen({ items, inspectionId, saveItem, onItemUpdate, onItemsUpdate, roomLabel, onBack, onDone }) {
  const miscItems = items.filter((i) => i.zone === MISC_ZONE);
  const [adding, setAdding] = useState(false);

  const addItem = async () => {
    setAdding(true);
    try {
      const { item } = await api(`/api/inspections/${inspectionId}/items`, {
        method: 'POST',
        body: JSON.stringify({ zone: MISC_ZONE, text: '', options: ['Pass', 'Fail'] }),
      });
      onItemsUpdate([...items, { ...item, photos: [] }]);
    } catch { /* ignore */ }
    finally { setAdding(false); }
  };

  const removeItem = async (id) => {
    try {
      await api(`/api/inspections/${inspectionId}/items/${id}`, { method: 'DELETE' });
      onItemsUpdate(items.filter((i) => i.id !== id));
    } catch { /* ignore */ }
  };

  // If there are zero misc items on mount, auto-add one blank so the UI isn't empty
  useEffect(() => {
    if (miscItems.length === 0 && !adding) {
      addItem();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="q-screen-body">
        <h2 className="q-screen-title">Anything else to report?</h2>
        <p className="q-screen-sub">Leave blank and tap Done if nothing else.</p>

        {miscItems.map((item) => (
          <MiscItemCard
            key={item.id}
            item={item}
            inspectionId={inspectionId}
            saveItem={saveItem}
            onItemUpdate={onItemUpdate}
            onRemove={() => removeItem(item.id)}
            removable={miscItems.length > 1}
          />
        ))}

        <button className="q-misc-add" onClick={addItem} disabled={adding}>
          {adding ? 'Adding...' : '+ Add another'}
        </button>
      </div>

      <div className="q-screen-footer q-screen-footer-dual">
        <button className="q-back-btn" onClick={onBack}>&larr; Back</button>
        <button className="q-done-room-btn" onClick={onDone}>Done with {roomLabel} &rarr;</button>
      </div>
    </>
  );
}

function MiscItemCard({ item, inspectionId, saveItem, onItemUpdate, onRemove, removable }) {
  const { fileRef, uploading, handlePhoto } = usePhotoUpload(inspectionId, item, onItemUpdate);

  // "Neither" = not maintenance and not lease violation
  const neither = !item.isMaintenance && !item.isLeaseViolation;

  const update = (changes) => {
    const updated = { ...item, ...changes };
    // Any interaction sets status so the item counts as completed
    if (!updated.status) updated.status = 'Fail';
    onItemUpdate(updated);
    const { photos, ...saveable } = changes;
    if (!item.status) saveable.status = 'Fail';
    if (Object.keys(saveable).length) saveItem(item.id, saveable);
  };

  const setKind = (kind) => {
    if (kind === 'maintenance') update({ isMaintenance: true, isLeaseViolation: false });
    else if (kind === 'violation') update({ isMaintenance: false, isLeaseViolation: true });
    else update({ isMaintenance: false, isLeaseViolation: false });
  };

  return (
    <div className="q-misc-card">
      <div className="q-misc-card-head">
        <label className="q-flag-label q-misc-category">
          Category
          <select
            className="q-flag-select"
            value={item.flagCategory || ''}
            onChange={(e) => update({ flagCategory: e.target.value || null })}
          >
            <option value="">Select...</option>
            {FLAG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {removable && (
          <button type="button" className="q-misc-remove" onClick={onRemove} aria-label="Remove">&times;</button>
        )}
      </div>

      <label className="q-flag-label">
        Task Name
        <textarea
          className="q-flag-note q-misc-note"
          value={item.note || ''}
          onChange={(e) => update({ note: e.target.value || null })}
          onBlur={(e) => {
            // Also save text so the item has a useful description
            if (e.target.value && !item.text) update({ text: e.target.value.slice(0, 140) });
          }}
          placeholder="e.g. Living room lamp bulb out"
          rows={3}
        />
      </label>

      <div className="q-misc-actions">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: 'none' }} />
        <button type="button" className="q-flag-box" onClick={() => fileRef.current.click()} disabled={uploading}>
          <span className="q-flag-box-icon">{uploading ? '...' : '\uD83D\uDCF7'}</span>
          <span>Photo</span>
          {(item.photos?.length > 0) && <span className="q-flag-badge">{item.photos.length}</span>}
        </button>
      </div>

      <div className="q-misc-toggles">
        <button
          type="button"
          className={`q-misc-toggle ${item.isMaintenance ? 'active q-misc-toggle-maint' : ''}`}
          onClick={() => setKind('maintenance')}
        >
          Maintenance
        </button>
        <button
          type="button"
          className={`q-misc-toggle ${item.isLeaseViolation ? 'active q-misc-toggle-viol' : ''}`}
          onClick={() => setKind('violation')}
        >
          Lease violation
        </button>
        <button
          type="button"
          className={`q-misc-toggle ${neither ? 'active q-misc-toggle-neither' : ''}`}
          onClick={() => setKind('neither')}
        >
          Neither
        </button>
      </div>
    </div>
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
  useEffect(() => () => { onItemsSyncedRef.current(itemsRef.current); }, []);

  const handleItemUpdate = useCallback((updated) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }, []);
  const handleItemsUpdate = useCallback((next) => { setItems(next); }, []);

  const handleBack = () => { onItemsSynced(items); onBack(); };

  const handleStepClick = (step) => {
    if (step === 'rooms') handleBack();
    else setScreen(step);
  };

  const handleDone = () => {
    // Mark the room complete
    const completedItem = items.find((i) => i.zone === COMPLETED_ZONE);
    if (completedItem && completedItem.status !== 'Yes') {
      const updated = { ...completedItem, status: 'Yes' };
      setItems((prev) => prev.map((i) => (i.id === completedItem.id ? updated : i)));
      saveItem(completedItem.id, { status: 'Yes' });
    }
    setTimeout(() => {
      onItemsSynced(itemsRef.current);
      onRoomDone();
    }, 200);
  };

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
        <ProgressStepper active={screen} onStepClick={handleStepClick} />
      </div>

      {screen === 'maintenance' && (
        <MaintenanceScreen
          items={items}
          inspectionId={inspectionId}
          saveItem={saveItem}
          onItemUpdate={handleItemUpdate}
          onBack={handleBack}
          onNext={() => setScreen('compliance')}
        />
      )}
      {screen === 'compliance' && (
        <ComplianceScreen
          items={items}
          inspectionId={inspectionId}
          saveItem={saveItem}
          onItemUpdate={handleItemUpdate}
          onBack={() => setScreen('maintenance')}
          onNext={() => setScreen('misc')}
        />
      )}
      {screen === 'misc' && (
        <MiscScreen
          items={items}
          inspectionId={inspectionId}
          saveItem={saveItem}
          onItemUpdate={handleItemUpdate}
          onItemsUpdate={handleItemsUpdate}
          roomLabel={roomLabel}
          onBack={() => setScreen('compliance')}
          onDone={handleDone}
        />
      )}
    </div>
  );
}

// ─── Room Selector Grid ────────────────────────────────

function RoomCard({ inspection, onClick }) {
  const state = roomState(inspection.items);
  return (
    <button className={`q-grid-card q-grid-card-${state}`} onClick={onClick}>
      <div className="q-grid-card-label">{inspection.roomLabel}</div>
      <div className="q-grid-card-state">
        {state === 'complete' && <span className="q-grid-card-check">&#10003;</span>}
        {state === 'in-progress' && <span className="q-grid-card-progress">In progress</span>}
        {state === 'not-started' && <span className="q-grid-card-start">Start</span>}
      </div>
    </button>
  );
}

// ─── Common Area Quick Check (with flag drawer) ────────

function CommonAreaQuickCheck({ quickCheck, onItemsUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const inspectionId = quickCheck?.inspectionId;
  const { saveItem, saveStatus } = useAutoSave(inspectionId);

  if (!quickCheck || !inspectionId) return null;
  const items = (quickCheck.items || []).filter((i) => i.zone?.startsWith('_QuickCommon:'));
  if (!items.length) return null;

  // Group by kind ("_QuickCommon:Kitchen" → "Kitchen")
  const groups = [];
  const byKind = {};
  for (const it of items) {
    const kind = it.zone.split(':')[1] || 'Other';
    if (!byKind[kind]) { byKind[kind] = []; groups.push(kind); }
    byKind[kind].push(it);
  }

  const done = items.filter((i) => i.status).length;
  const total = items.length;

  const updateItem = (updated) => {
    onItemsUpdate(items.map((i) => (i.id === updated.id ? updated : i)));
  };

  const togglePass = (item) => {
    const next = item.status === 'Pass'
      ? { ...item, status: '', note: null, flagCategory: null, isMaintenance: false }
      : { ...item, status: 'Pass', note: null, flagCategory: null, isMaintenance: false };
    updateItem(next);
    saveItem(item.id, { status: next.status, note: null, flagCategory: null, isMaintenance: false });
  };
  const toggleFail = (item) => {
    const next = item.status === 'Fail'
      ? { ...item, status: '', note: null, flagCategory: null, isMaintenance: false }
      : { ...item, status: 'Fail' };
    updateItem(next);
    saveItem(item.id, { status: next.status });
  };
  const updateDrawer = (updated) => {
    updateItem(updated);
    saveItem(updated.id, {
      flagCategory: updated.flagCategory,
      note: updated.note,
      isMaintenance: updated.isMaintenance,
    });
  };

  return (
    <div className="q-common-section">
      <button className="q-common-toggle" onClick={() => setExpanded(!expanded)}>
        <span className="q-common-toggle-label">
          Quick common area check <span className="q-common-toggle-sub">(optional &middot; {done}/{total})</span>
        </span>
        <span className="q-common-toggle-right">
          {saveStatus === 'saving' && <span className="save-saving">Saving...</span>}
          {saveStatus === 'saved' && <span className="save-saved">Saved &#10003;</span>}
          <span className={`q-common-toggle-chev ${expanded ? 'open' : ''}`}>&#9656;</span>
        </span>
      </button>
      {expanded && (
        <div className="q-common-body">
          {groups.map((kind) => (
            <div key={kind} className="q-common-zone">
              <h4 className="q-common-zone-title">{kind}s</h4>
              {byKind[kind].map((item) => (
                <div
                  key={item.id}
                  className={`q-common-card q-common-card-${item.status || 'none'}`}
                >
                  <div className="q-common-card-row">
                    <div className="q-common-card-label">{item.text}</div>
                    <div className="q-common-card-buttons">
                      <button
                        className={`q-btn q-btn-pass ${item.status === 'Pass' ? 'active' : ''}`}
                        onClick={() => togglePass(item)}
                      >&#10003;</button>
                      <button
                        className={`q-btn q-btn-fail ${item.status === 'Fail' ? 'active' : ''}`}
                        onClick={() => toggleFail(item)}
                      >&#10005;</button>
                    </div>
                  </div>
                  {item.status === 'Fail' && (
                    <FlagDrawerMini
                      item={item}
                      inspectionId={inspectionId}
                      onUpdate={updateDrawer}
                    />
                  )}
                </div>
              ))}
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

  // Quick-check items live on the primary room inspection now. When the
  // user toggles a quick-check row, update that room's items AND the
  // flattened commonAreaQuick.items view.
  const handleQuickItemsUpdate = (freshQuickItems) => {
    setData((prev) => {
      if (!prev?.commonAreaQuick) return prev;
      const { inspectionId } = prev.commonAreaQuick;
      const nextInspections = prev.inspections.map((insp) => {
        if (insp.id !== inspectionId) return insp;
        const quickIds = new Set(freshQuickItems.map((i) => i.id));
        const others = insp.items.filter((i) => !quickIds.has(i.id));
        return { ...insp, items: [...others, ...freshQuickItems] };
      });
      return {
        ...prev,
        inspections: nextInspections,
        commonAreaQuick: { ...prev.commonAreaQuick, items: freshQuickItems },
      };
    });
  };

  // A room is "incomplete for submission" if any of its visible checklist
  // items still have no status — regardless of whether the user tapped
  // "Done with Room" (which only flips the `_Completed` marker). The
  // backend enforces the same rule, so we always match it here.
  const roomHasUnanswered = (items) => visibleItems(items).some((i) => !i.status);

  const getIncompleteRooms = () => {
    if (!data) return [];
    return data.inspections
      .filter((insp) => insp.status === 'DRAFT' && roomHasUnanswered(insp.items))
      .map((insp) => ({ id: insp.roomId, label: insp.roomLabel, inspectionId: insp.id }));
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
        // Per-inspection decision: if this specific room has unanswered
        // items, send partial + reason; if every item is answered, submit
        // normally (even if the batch overall has other incomplete rooms).
        const body = roomHasUnanswered(insp.items)
          ? { partial: true, partialReason }
          : {};
        await api(`/api/inspections/${insp.id}/submit`, { method: 'POST', body: JSON.stringify(body) });
      }

      // Quick-check items live on the primary room inspection, so they're
      // submitted automatically as part of that room's inspection above.

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
  const completedRooms = data.inspections.filter((i) => isRoomComplete(i.items)).length;
  const incompleteRooms = getIncompleteRooms();

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
            Add a reason to submit.
          </p>
          <ul className="partial-room-list">
            {incompleteRooms.map((r) => <li key={r.id}><strong>{r.label}</strong></li>)}
          </ul>
          <label>
            Reason for partial submission
            <textarea
              className="detail-textarea"
              value={partialReason}
              onChange={(e) => setPartialReason(e.target.value)}
              placeholder="e.g. Room 3 locked — resident not home"
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

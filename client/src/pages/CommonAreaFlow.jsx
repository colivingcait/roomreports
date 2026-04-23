import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAutoSave } from '../hooks/useAutoSave';
import { queuePhoto } from '../lib/offlineStore';
import { ChecklistItem } from '../components/InspectionItems';
import Modal from '../components/Modal';
import { FLAG_CATEGORIES } from '../../../shared/index.js';

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

// ─── Shared helpers ────────────────────────────────────

const SECTION_SENTINEL = '_section';

function isSection(i) { return Array.isArray(i.options) && i.options.includes(SECTION_SENTINEL); }
function isMarker(i) { return typeof i.zone === 'string' && i.zone.startsWith('_'); }
function isMisc(i) { return typeof i.zone === 'string' && i.zone.startsWith('Misc:'); }
function checklistItems(items) {
  return items.filter((i) => !isMarker(i) && !isSection(i));
}
function completedMarker(items, areaKey) {
  return items.find((i) => i.zone === `_Completed:${areaKey}`);
}
function isAreaComplete(items, areaKey) {
  const m = completedMarker(items, areaKey);
  return !!(m && m.status === 'Yes');
}

// Derive the ordered list of area keys present in the inspection's items.
// Area key = item.zone for regular items; `Misc:<AreaKey>` items map back to
// their area; `_Completed:<AreaKey>` items also count.
function extractAreaKeys(items) {
  const seen = new Set();
  const order = [];
  const addArea = (key) => {
    if (!seen.has(key)) { seen.add(key); order.push(key); }
  };
  for (const it of items) {
    if (!it.zone) continue;
    if (it.zone.startsWith('_Completed:')) {
      addArea(it.zone.slice('_Completed:'.length));
    } else if (it.zone.startsWith('Misc:')) {
      // Misc items alone shouldn't create an area — they follow an existing one.
      continue;
    } else if (!it.zone.startsWith('_')) {
      addArea(it.zone);
    }
  }
  return order;
}

function areaLabel(key) {
  if (key.startsWith('Kitchen:')) return key.slice('Kitchen:'.length);
  if (key.startsWith('Bathroom:')) return key.slice('Bathroom:'.length);
  if (key === 'Living') return 'Living / Common Areas';
  return key;
}

function areaSubtitle(key) {
  if (key.startsWith('Kitchen:')) return 'Kitchen';
  if (key.startsWith('Bathroom:')) return 'Shared Bathroom';
  return null;
}

// ─── Photo uploader hook ───────────────────────────────

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

// ─── Flag drawer (shared with room inspections) ────────

function FlagDrawer({ item, inspectionId, onUpdate }) {
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
          Task name / notes
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
        <button type="button" className="q-flag-box" onClick={() => fileRef.current.click()} disabled={uploading}>
          <span className="q-flag-box-icon">{uploading ? '...' : '📷'}</span>
          <span>Photo</span>
          {(item.photos?.length > 0) && <span className="q-flag-badge">{item.photos.length}</span>}
        </button>
        <button
          type="button"
          className={`q-flag-box q-flag-maint ${item.isMaintenance ? 'active' : ''}`}
          onClick={() => onUpdate({ ...item, isMaintenance: !item.isMaintenance })}
        >
          <span className="q-flag-box-icon">{'🔧'}</span>
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
        <FlagDrawer item={item} inspectionId={inspectionId} onUpdate={handleDrawerUpdate} />
      )}
    </div>
  );
}

// ─── MISC item (dynamic, per-area) ─────────────────────

function MiscItemCard({ item, inspectionId, saveItem, onItemUpdate, onRemove, removable }) {
  const { fileRef, uploading, handlePhoto } = usePhotoUpload(inspectionId, item, onItemUpdate);

  const update = (changes) => {
    const updated = { ...item, ...changes };
    if (!updated.status) updated.status = 'Fail';
    onItemUpdate(updated);
    const { photos, ...saveable } = changes;
    if (!item.status) saveable.status = 'Fail';
    if (Object.keys(saveable).length) saveItem(item.id, saveable);
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
        Task name / notes
        <textarea
          className="q-flag-note q-misc-note"
          value={item.note || ''}
          onChange={(e) => update({ note: e.target.value || null })}
          onBlur={(e) => {
            if (e.target.value && !item.text) update({ text: e.target.value.slice(0, 140) });
          }}
          placeholder="Describe it..."
          rows={3}
        />
      </label>

      <div className="q-misc-actions">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: 'none' }} />
        <button type="button" className="q-flag-box" onClick={() => fileRef.current.click()} disabled={uploading}>
          <span className="q-flag-box-icon">{uploading ? '...' : '📷'}</span>
          <span>Photo</span>
          {(item.photos?.length > 0) && <span className="q-flag-badge">{item.photos.length}</span>}
        </button>
        <button
          type="button"
          className={`q-misc-toggle ${item.isMaintenance ? 'active q-misc-toggle-maint' : ''}`}
          onClick={() => update({ isMaintenance: !item.isMaintenance })}
        >
          Maintenance
        </button>
      </div>
    </div>
  );
}

// ─── Area Checklist Screen ─────────────────────────────

function AreaScreen({ inspection, areaKey, allItems, setAllItems, saveItem, saveStatus, onBack, onDone }) {
  const inspectionId = inspection.id;

  // Items for this area, preserving order from the checklist:
  //   - regular items + section dividers: zone === areaKey
  //   - MISC items: zone === `Misc:${areaKey}`
  const areaItems = allItems.filter((i) => i.zone === areaKey);
  const miscZone = `Misc:${areaKey}`;
  const miscItems = allItems.filter((i) => i.zone === miscZone);

  const handleItemUpdate = useCallback((updated) => {
    setAllItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }, [setAllItems]);

  // Build ordered render blocks. Section items open a new block; PF items
  // append to the current block; if no section yet, they go into an
  // "intro" block with no heading.
  const blocks = [];
  let current = { heading: null, items: [] };
  for (const it of areaItems) {
    if (isSection(it)) {
      if (current.items.length > 0 || current.heading) blocks.push(current);
      current = { heading: it.text, items: [] };
    } else {
      current.items.push(it);
    }
  }
  if (current.items.length > 0 || current.heading) blocks.push(current);

  const [adding, setAdding] = useState(false);
  const addMisc = async () => {
    if (adding) return;
    setAdding(true);
    try {
      const { item } = await api(`/api/inspections/${inspectionId}/items`, {
        method: 'POST',
        body: JSON.stringify({ zone: miscZone, text: '', options: ['Pass', 'Fail'] }),
      });
      setAllItems((prev) => [...prev, { ...item, photos: [] }]);
    } catch { /* ignore */ }
    finally { setAdding(false); }
  };

  const removeMisc = async (id) => {
    try {
      await api(`/api/inspections/${inspectionId}/items/${id}`, { method: 'DELETE' });
      setAllItems((prev) => prev.filter((i) => i.id !== id));
    } catch { /* ignore */ }
  };

  const handleDone = () => {
    const marker = completedMarker(allItems, areaKey);
    if (marker && marker.status !== 'Yes') {
      const updated = { ...marker, status: 'Yes' };
      setAllItems((prev) => prev.map((i) => (i.id === marker.id ? updated : i)));
      saveItem(marker.id, { status: 'Yes' });
    }
    setTimeout(onDone, 200);
  };

  const subtitle = areaSubtitle(areaKey);

  return (
    <div className="q-room-page">
      <div className="q-room-header">
        <div className="q-room-header-top">
          <button className="btn-text" onClick={onBack}>&larr; Areas</button>
          <div className="save-indicator">
            {saveStatus === 'saving' && <span className="save-saving">Saving...</span>}
            {saveStatus === 'saved' && <span className="save-saved">Saved &#10003;</span>}
            {saveStatus === 'offline' && <span className="save-offline">Saved locally</span>}
          </div>
        </div>
        <div className="q-room-header-info">
          <h1>{areaLabel(areaKey)}</h1>
          <span className="q-room-header-meta">
            {subtitle ? `${subtitle} · ` : ''}{inspection.property?.name}
          </span>
        </div>
      </div>

      <div className="q-screen-body">
        {blocks.map((block, bi) => (
          <div key={bi} className={block.heading ? 'q-feature-group' : ''}>
            {block.heading && (
              <>
                <div className="q-feature-divider" />
                <div className="q-feature-label">{block.heading}</div>
              </>
            )}
            {block.items.map((item) => (
              <PassFailItem
                key={item.id}
                item={item}
                inspectionId={inspectionId}
                saveItem={saveItem}
                onItemUpdate={handleItemUpdate}
              />
            ))}
          </div>
        ))}

        <div className="q-feature-group">
          <div className="q-feature-divider" />
          <div className="q-feature-label">Misc</div>
          <p className="q-screen-sub" style={{ marginTop: 0 }}>Anything else worth noting in this area.</p>
          {miscItems.map((item) => (
            <MiscItemCard
              key={item.id}
              item={item}
              inspectionId={inspectionId}
              saveItem={saveItem}
              onItemUpdate={handleItemUpdate}
              onRemove={() => removeMisc(item.id)}
              removable={true}
            />
          ))}
          <button className="q-misc-add" onClick={addMisc} disabled={adding}>
            {adding ? 'Adding...' : miscItems.length === 0 ? '+ Add misc item' : '+ Add another'}
          </button>
        </div>
      </div>

      <div className="q-screen-footer q-screen-footer-dual">
        <button className="q-back-btn" onClick={onBack}>&larr; Back</button>
        <button className="q-done-room-btn" onClick={handleDone}>Done with {areaLabel(areaKey)} &rarr;</button>
      </div>
    </div>
  );
}

// ─── Common Area Multi-Screen (area grid + per-area checklist) ────

function AreaCard({ areaKey, items, onClick }) {
  const relevant = items.filter((i) => i.zone === areaKey || i.zone === `Misc:${areaKey}`);
  const pfItems = checklistItems(relevant);
  const done = pfItems.filter((i) => i.status).length;
  const total = pfItems.length;
  const complete = isAreaComplete(items, areaKey);
  const started = done > 0 || relevant.some((i) => i.zone === `Misc:${areaKey}`);
  const state = complete ? 'complete' : started ? 'in-progress' : 'not-started';
  const flags = relevant.filter((i) => i.status === 'Fail' || i.isMaintenance).length;

  return (
    <button className={`q-grid-card q-grid-card-${state}`} onClick={onClick}>
      <div className="q-grid-card-label">{areaLabel(areaKey)}</div>
      <div className="q-grid-card-state">
        {state === 'complete' && (
          <span className="q-grid-card-check">&#10003;</span>
        )}
        {state === 'in-progress' && (
          <span className="q-grid-card-progress">
            {done}/{total}{flags > 0 ? ` · ${flags} flag${flags === 1 ? '' : 's'}` : ''}
          </span>
        )}
        {state === 'not-started' && <span className="q-grid-card-start">Start</span>}
      </div>
    </button>
  );
}

function CommonAreaMultiScreen({ inspection, initialItems }) {
  const navigate = useNavigate();
  const [items, setItems] = useState(initialItems);
  const [activeArea, setActiveArea] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showPartialModal, setShowPartialModal] = useState(false);
  const [partialReason, setPartialReason] = useState('');
  const { saveItem, saveStatus } = useAutoSave(inspection.id);

  // Reset scroll on any grid ↔ area transition (no URL change to trigger
  // React Router's scroll reset).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeArea]);

  // Expose browser back button as "leave area" when inside an area.
  useEffect(() => {
    if (!activeArea) return;
    const onPop = () => setActiveArea(null);
    window.addEventListener('popstate', onPop);
    window.history.pushState({ area: activeArea }, '');
    return () => { window.removeEventListener('popstate', onPop); };
  }, [activeArea]);

  const areas = extractAreaKeys(items);

  const incompleteAreas = areas.filter((a) => !isAreaComplete(items, a));

  const onSubmitClick = () => {
    if (incompleteAreas.length > 0) setShowPartialModal(true);
    else doSubmit(false);
  };

  const doSubmit = async (partial) => {
    setSubmitting(true);
    setError('');
    try {
      const body = partial ? { partial: true, partialReason } : {};
      await api(`/api/inspections/${inspection.id}/submit`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      navigate('/dashboard', {
        state: { notification: `Common area inspection submitted for ${inspection.property?.name}` },
      });
    } catch (err) {
      setError(err.message);
      setShowPartialModal(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (activeArea) {
    return (
      <AreaScreen
        inspection={inspection}
        areaKey={activeArea}
        allItems={items}
        setAllItems={setItems}
        saveItem={saveItem}
        saveStatus={saveStatus}
        onBack={() => setActiveArea(null)}
        onDone={() => setActiveArea(null)}
      />
    );
  }

  const completedCount = areas.filter((a) => isAreaComplete(items, a)).length;
  const totalFlags = items.filter((i) => !isMarker(i) && !isSection(i) && (i.status === 'Fail' || i.isMaintenance)).length;

  return (
    <div className="q-flow-page">
      <div className="q-flow-header">
        <button className="btn-text" onClick={() => navigate('/dashboard')}>&larr; Save &amp; exit</button>
        <h1>Common Area Inspection</h1>
        <p className="q-flow-subtitle">{inspection.property?.name}</p>
        <div className="q-flow-counter">{completedCount} of {areas.length} done</div>
      </div>

      {error && <div className="auth-error" style={{ margin: '1rem 0' }}>{error}</div>}

      <div className="q-grid">
        {areas.map((a) => (
          <AreaCard
            key={a}
            areaKey={a}
            items={items}
            onClick={() => setActiveArea(a)}
          />
        ))}
      </div>

      <div className="q-flow-footer">
        <button className="q-submit-btn" onClick={onSubmitClick} disabled={submitting}>
          {submitting
            ? 'Submitting...'
            : `Submit Inspection${totalFlags > 0 ? ` (${totalFlags} flag${totalFlags === 1 ? '' : 's'})` : ''}`}
        </button>
      </div>

      <Modal
        open={showPartialModal}
        onClose={() => { setShowPartialModal(false); setPartialReason(''); setError(''); }}
        title="Some areas weren't finished"
      >
        <div className="modal-form">
          <p className="partial-intro">
            The following {incompleteAreas.length === 1 ? 'area is' : `${incompleteAreas.length} areas are`} incomplete.
            Tell us why so the property manager can follow up.
          </p>
          <ul className="partial-room-list">
            {incompleteAreas.map((a) => <li key={a}><strong>{areaLabel(a)}</strong></li>)}
          </ul>
          <label>
            Reason for partial submission
            <textarea
              className="detail-textarea"
              value={partialReason}
              onChange={(e) => setPartialReason(e.target.value)}
              placeholder="e.g. Basement locked — couldn't access laundry"
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

// ─── Room Turn (single-page) — kept as-is ──────────────

function RoomTurnSinglePage({ inspection, initialItems }) {
  const navigate = useNavigate();
  const [items, setItems] = useState(initialItems);
  const { saveItem, saveStatus } = useAutoSave(inspection.id);
  const [submitting, setSubmitting] = useState(false);
  const [showPartialModal, setShowPartialModal] = useState(false);
  const [partialReason, setPartialReason] = useState('');
  const [error, setError] = useState('');

  const handleItemUpdate = useCallback((updated) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }, []);

  const visible = items.filter((i) => !i.zone.startsWith('_'));
  const zones = [];
  const zoneMap = {};
  for (const it of visible) {
    if (!zoneMap[it.zone]) { zoneMap[it.zone] = []; zones.push(it.zone); }
    zoneMap[it.zone].push(it);
  }

  const total = visible.length;
  const done = visible.filter((i) => i.status).length;
  const flags = visible.filter((i) => i.status === 'Fail').length;
  const progress = total > 0 ? (done / total) * 100 : 0;
  const incomplete = visible.filter((i) => !i.status);

  const doSubmit = async (partial) => {
    setSubmitting(true);
    setError('');
    try {
      const body = partial ? { partial: true, partialReason } : {};
      await api(`/api/inspections/${inspection.id}/submit`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const noFlags = visible.every((i) => i.status !== 'Fail');
      const roomLabel = inspection?.room ? ` — ${inspection.room.label}` : '';
      const notification = noFlags
        ? `Room Ready ✓ ${inspection?.property?.name}${roomLabel}`
        : `Room turn inspection submitted for ${inspection?.property?.name}${roomLabel}`;
      navigate('/dashboard', { state: { notification } });
    } catch (err) {
      setError(err.message);
      setShowPartialModal(false);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitClick = () => {
    if (incomplete.length > 0) setShowPartialModal(true);
    else doSubmit(false);
  };

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
            {inspection.room ? ` — ${inspection.room.label}` : ''}
          </h1>
          <span className="q-room-header-meta">
            Room Turn Inspection &middot; {done}/{total}
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
                inspectionId={inspection.id}
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
          <p style={{ fontSize: '0.9rem', color: '#4A4543', marginBottom: '0.5rem' }}>
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

// ─── Entry point (routes both /common-area and /room-turn) ──

export default function CommonAreaFlow() {
  const { inspectionId } = useParams();
  const [inspection, setInspection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api(`/api/inspections/${inspectionId}`)
      .then((d) => { if (!cancelled) setInspection(d.inspection); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [inspectionId]);

  if (loading) return <div className="page-loading">Loading inspection...</div>;
  if (!inspection) return <div className="page-container"><div className="auth-error">{error || 'Not found'}</div></div>;

  const items = inspection.items || [];

  if (inspection.type === 'COMMON_AREA') {
    return <CommonAreaMultiScreen inspection={inspection} initialItems={items} />;
  }

  return <RoomTurnSinglePage inspection={inspection} initialItems={items} />;
}

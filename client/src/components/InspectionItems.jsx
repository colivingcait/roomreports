import { useState, useRef } from 'react';
import { queuePhoto } from '../lib/offlineStore';
import { FLAG_CATEGORIES } from '../../../shared/index.js';

export { FLAG_CATEGORIES };

export function FlagDrawer({ item, inspectionId, onUpdate }) {
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

export function ChecklistItem({ item, inspectionId, saveItem, onItemUpdate }) {
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
            saveItem(item.id, { flagCategory: updated.flagCategory, note: updated.note, isMaintenance: updated.isMaintenance });
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

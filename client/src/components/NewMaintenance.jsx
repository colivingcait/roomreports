import { useState, useEffect, useRef } from 'react';
import Modal from './Modal';
import {
  FLAG_CATEGORIES,
  PRIORITIES,
  PRIORITY_COLORS,
  suggestPriority,
} from '../../../shared/index.js';

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

const EMPTY = {
  propertyId: '',
  roomId: '',
  description: '',
  flagCategory: 'General',
  priority: 'Medium',
  note: '',
};

export default function NewMaintenance({ open, onClose, onCreated }) {
  const [draft, setDraft] = useState(EMPTY);
  const [properties, setProperties] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  // Load properties when opened
  useEffect(() => {
    if (!open) return;
    fetch('/api/properties', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setProperties(d.properties || []))
      .catch(() => {});
  }, [open]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setDraft(EMPTY);
      setPhotoFile(null);
      setPhotoPreview('');
      setError('');
      setRooms([]);
    }
  }, [open]);

  // Load rooms when property changes
  useEffect(() => {
    if (!draft.propertyId) { setRooms([]); return; }
    fetch(`/api/properties/${draft.propertyId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setRooms(d.property?.rooms || []))
      .catch(() => setRooms([]));
  }, [draft.propertyId]);

  const handleCategory = (category) => {
    setDraft((prev) => ({
      ...prev,
      flagCategory: category,
      // Auto-suggest priority only when the user hasn't deliberately overridden
      priority: prev.priority === suggestPriority(prev.flagCategory) || !prev.priority
        ? suggestPriority(category)
        : prev.priority,
    }));
  };

  const handlePhotoPick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!draft.propertyId || !draft.description.trim()) return;
    setSaving(true);
    setError('');
    try {
      const data = await api('/api/maintenance', {
        method: 'POST',
        body: JSON.stringify({
          propertyId: draft.propertyId,
          roomId: draft.roomId || null,
          description: draft.description.trim(),
          flagCategory: draft.flagCategory,
          priority: draft.priority,
          note: draft.note.trim() || null,
        }),
      });

      // Upload the optional photo to the freshly-created ticket
      if (photoFile) {
        const form = new FormData();
        form.append('photo', photoFile);
        try {
          await fetch(`/api/maintenance/${data.item.id}/photos`, {
            method: 'POST',
            credentials: 'include',
            body: form,
          });
        } catch { /* best effort — ticket still exists */ }
      }

      onCreated?.(data.item);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Maintenance Item">
      <form onSubmit={handleSubmit} className="modal-form">
        {error && <div className="auth-error">{error}</div>}

        <label>
          Property
          <select
            className="form-select"
            value={draft.propertyId}
            onChange={(e) => setDraft({ ...draft, propertyId: e.target.value, roomId: '' })}
            required
          >
            <option value="">Select a property...</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        <label>
          Room <span className="form-optional">(optional — leave blank for common area)</span>
          <select
            className="form-select"
            value={draft.roomId}
            onChange={(e) => setDraft({ ...draft, roomId: e.target.value })}
            disabled={!draft.propertyId || rooms.length === 0}
          >
            <option value="">— Common area —</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>

        <label>
          Title / description
          <input
            type="text"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="e.g. Kitchen sink drain clogged"
            required
          />
        </label>

        <label>
          Category
          <select
            className="form-select"
            value={draft.flagCategory}
            onChange={(e) => handleCategory(e.target.value)}
          >
            {FLAG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label>
          Priority
          <select
            className="form-select"
            value={draft.priority}
            onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
            style={{
              color: PRIORITY_COLORS[draft.priority],
              borderColor: PRIORITY_COLORS[draft.priority],
            }}
          >
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>

        <label>
          Notes <span className="form-optional">(optional)</span>
          <textarea
            className="detail-textarea"
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder="Any extra context for maintenance..."
            rows={2}
          />
        </label>

        <label>
          Photo <span className="form-optional">(optional)</span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoPick}
              style={{ display: 'none' }}
            />
            <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
              {photoFile ? 'Change photo' : '+ Add photo'}
            </button>
            {photoPreview && (
              <div className="photo-thumb-sm"><img src={photoPreview} alt="" /></div>
            )}
          </div>
        </label>

        <button
          type="submit"
          className="btn-primary"
          disabled={saving || !draft.propertyId || !draft.description.trim()}
        >
          {saving ? 'Creating...' : 'Create Maintenance Item'}
        </button>
      </form>
    </Modal>
  );
}

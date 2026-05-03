import { useState, useEffect } from 'react';
import Modal from './Modal';
import { pillColors } from '../../../shared/index.js';

const VIOLATION_TYPES = [
  { value: 'MESSY',               label: 'Messy' },
  { value: 'BAD_ODOR',            label: 'Bad odor' },
  { value: 'SMOKING',             label: 'Smoking' },
  { value: 'UNAUTHORIZED_GUESTS', label: 'Unauthorized guests' },
  { value: 'PETS',                label: 'Pets' },
  { value: 'OPEN_FOOD',           label: 'Open food' },
  { value: 'PESTS',               label: 'Pests/bugs' },
  { value: 'OPEN_FLAMES',         label: 'Open flames/candles' },
  { value: 'KITCHEN_APPLIANCES',  label: 'Kitchen appliances in room' },
  { value: 'LITHIUM_BATTERIES',   label: 'Lithium batteries' },
  { value: 'MODIFICATIONS',       label: 'Modifications (paint, holes, etc.)' },
  { value: 'DRUG_PARAPHERNALIA',  label: 'Drug paraphernalia' },
  { value: 'WEAPONS',             label: 'Weapons' },
  { value: 'NOISE',               label: 'Noise' },
  { value: 'OTHER',               label: 'Other' },
];

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

export default function LogViolation({ open, onClose, propertyId, rooms = [], onCreated }) {
  const [roomId, setRoomId] = useState('');
  const [residentName, setResidentName] = useState('');
  const [violationType, setViolationType] = useState('');
  const [otherDescription, setOtherDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setRoomId('');
      setResidentName('');
      setViolationType('');
      setOtherDescription('');
      setNotes('');
      setPhotos([]);
      setError('');
    }
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    if (!violationType) { setError('Pick a violation type'); return; }
    if (violationType === 'OTHER' && !otherDescription.trim()) { setError('Describe the violation'); return; }
    setSaving(true);
    setError('');
    try {
      const form = new FormData();
      form.append('propertyId', propertyId);
      if (roomId) form.append('roomId', roomId);
      if (residentName.trim()) form.append('residentName', residentName.trim());
      form.append('violationType', violationType);
      if (otherDescription.trim()) form.append('otherDescription', otherDescription.trim());
      if (notes.trim()) form.append('notes', notes.trim());
      for (const file of photos) form.append('photos', file);
      await fetch('/api/violations', {
        method: 'POST',
        credentials: 'include',
        body: form,
      }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });
      onCreated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Log Lease Violation">
      <form className="modal-form" onSubmit={submit}>
        <label>
          Room <span className="form-optional">(optional)</span>
          <select className="form-select" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">Property-wide</option>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>

        <label>
          Resident name <span className="form-optional">(optional)</span>
          <input
            type="text"
            className="form-input"
            value={residentName}
            onChange={(e) => setResidentName(e.target.value)}
            placeholder="e.g. Jane Smith"
          />
        </label>

        <label>
          Violation type <span style={{ color: '#A02420' }}>*</span>
        </label>
        <div className="q-compliance-grid">
          {VIOLATION_TYPES.map(({ value, label }) => {
            const col = pillColors(label);
            return (
              <button
                key={value}
                type="button"
                className={`q-compliance-card ${violationType === value ? 'selected' : ''}`}
                style={{
                  '--pill-bg': col.bg, '--pill-fg': col.fg,
                  '--pill-border': col.border, '--pill-sel-bg': col.selBg, '--pill-sel-fg': col.selFg,
                }}
                onClick={() => setViolationType(value)}
              >
                {label}
              </button>
            );
          })}
        </div>

        {violationType === 'OTHER' && (
          <label>
            Describe the violation <span style={{ color: '#A02420' }}>*</span>
            <input
              type="text"
              className="form-input"
              value={otherDescription}
              onChange={(e) => setOtherDescription(e.target.value)}
              placeholder="Brief description..."
              required
            />
          </label>
        )}

        <label>
          Notes <span className="form-optional">(optional)</span>
          <textarea
            className="detail-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What did you observe?"
            rows={3}
          />
        </label>

        <label>
          Photos <span className="form-optional">(optional, up to 5)</span>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setPhotos(Array.from(e.target.files).slice(0, 5))}
          />
        </label>

        {error && <div className="auth-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving || !violationType}>
            {saving ? 'Logging...' : 'Log Violation'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

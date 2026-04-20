import { useState, useEffect } from 'react';
import Modal from './Modal';

// Same canonical pills the inspection compliance screen uses.
const VIOLATION_CATEGORIES = [
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

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

export default function LogViolation({ open, onClose, propertyId, rooms = [], onCreated }) {
  const [roomId, setRoomId] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setRoomId('');
      setCategory('');
      setNote('');
      setError('');
    }
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    if (!category) { setError('Pick a violation type'); return; }
    setSaving(true);
    setError('');
    try {
      const description = category; // pill label is the description / title
      await api('/api/violations', {
        method: 'POST',
        body: JSON.stringify({
          propertyId,
          roomId: roomId || null,
          category,
          description,
          note: note.trim() || null,
        }),
      });
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
          <select
            className="form-select"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          >
            <option value="">Property-wide</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </label>

        <label>
          Violation type
          <div className="violation-pill-row">
            {VIOLATION_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className={`q-compliance-pill ${category === c ? 'selected' : ''}`}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </label>

        <label>
          Notes <span className="form-optional">(optional)</span>
          <textarea
            className="detail-textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did you observe?"
            rows={3}
          />
        </label>

        {error && <div className="auth-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !category}>
            {saving ? 'Logging...' : 'Log Violation'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

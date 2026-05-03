import { useState, useEffect } from 'react';
import Modal from './Modal';

const METHODS = [
  { value: '', label: 'None' },
  { value: 'VERBAL', label: 'Verbal' },
  { value: 'TEXT', label: 'Text message' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'POSTED_NOTICE', label: 'Posted notice' },
  { value: 'PADSPLIT_MESSAGE', label: 'PadSplit message' },
  { value: 'OTHER', label: 'Other' },
];

function todayLocal() {
  return new Date().toISOString().slice(0, 16);
}

export default function AddNoteModal({ open, onClose, violationId, onUpdated }) {
  const [notes, setNotes] = useState('');
  const [method, setMethod] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [photos, setPhotos] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setNotes(''); setMethod(''); setDate(todayLocal()); setPhotos([]); setError(''); }
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    if (!notes.trim()) { setError('Notes are required'); return; }
    setSaving(true);
    setError('');
    try {
      const form = new FormData();
      form.append('actionType', 'NOTE');
      form.append('notes', notes.trim());
      form.append('date', new Date(date).toISOString());
      if (method) form.append('method', method);
      for (const file of photos) form.append('photos', file);
      await fetch(`/api/violations/${violationId}/timeline`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });
      onUpdated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Note">
      <form className="modal-form" onSubmit={submit}>
        <label>
          Date <span className="form-optional">(defaults to now)</span>
          <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <label>
          Method <span className="form-optional">(optional)</span>
          <select className="form-select" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>

        <label>
          Notes <span style={{ color: '#A02420' }}>*</span>
          <textarea
            className="detail-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What happened, what was observed..."
            rows={3}
            required
          />
        </label>

        <label>
          Photo <span className="form-optional">(optional, up to 5)</span>
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
          <button type="submit" className="btn-primary" disabled={saving || !notes.trim()}>
            {saving ? 'Saving...' : 'Add Note'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

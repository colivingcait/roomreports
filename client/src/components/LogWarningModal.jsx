import { useState, useEffect } from 'react';
import Modal from './Modal';

const ESCALATION_ORDER = ['FLAGGED', 'FIRST_WARNING', 'SECOND_WARNING', 'FINAL_NOTICE'];
const ESCALATION_LABELS = {
  FLAGGED: 'Flagged', FIRST_WARNING: '1st Warning',
  SECOND_WARNING: '2nd Warning', FINAL_NOTICE: 'Final Notice',
};
const METHODS = [
  { value: 'VERBAL', label: 'Verbal' },
  { value: 'TEXT', label: 'Text message' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'POSTED_NOTICE', label: 'Posted notice' },
  { value: 'PADSPLIT_MESSAGE', label: 'PadSplit message' },
  { value: 'OTHER', label: 'Other' },
];

function todayLocal() {
  const d = new Date();
  return d.toISOString().slice(0, 16);
}

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

export default function LogWarningModal({ open, onClose, violationId, currentLevel, suggestedNext, onUpdated }) {
  const [escalateTo, setEscalateTo] = useState('');
  const [method, setMethod] = useState('VERBAL');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [photos, setPhotos] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setEscalateTo(suggestedNext || 'FIRST_WARNING');
      setMethod('VERBAL');
      setNotes('');
      setDate(todayLocal());
      setPhotos([]);
      setError('');
    }
  }, [open, suggestedNext]);

  const validLevels = ESCALATION_ORDER.filter((l) => l !== 'FLAGGED');

  const submit = async (e) => {
    e.preventDefault();
    if (!notes.trim()) { setError('Notes are required'); return; }
    setSaving(true);
    setError('');
    try {
      const form = new FormData();
      form.append('actionType', escalateTo);
      form.append('method', method);
      form.append('notes', notes.trim());
      form.append('date', new Date(date).toISOString());
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

  const currentLabel = ESCALATION_LABELS[currentLevel] || currentLevel;

  return (
    <Modal open={open} onClose={onClose} title="Log Warning">
      <form className="modal-form" onSubmit={submit}>
        <div style={{ background: '#F3F0EC', borderRadius: 6, padding: '10px 12px', marginBottom: 4, fontSize: 13 }}>
          Current level: <strong>{currentLabel}</strong>
        </div>

        <label>
          Escalate to
          <select className="form-select" value={escalateTo} onChange={(e) => setEscalateTo(e.target.value)}>
            {validLevels.map((l) => (
              <option key={l} value={l}>{ESCALATION_LABELS[l]}</option>
            ))}
          </select>
        </label>

        <label>
          Method
          <select className="form-select" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>

        <label>
          Date <span className="form-optional">(defaults to now)</span>
          <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <label>
          Notes <span style={{ color: '#A02420' }}>*</span>
          <textarea
            className="detail-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Describe the warning given, what was observed..."
            rows={3}
            required
          />
        </label>

        <label>
          Photos <span className="form-optional">(up to 5)</span>
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
            {saving ? 'Saving...' : 'Log Warning'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

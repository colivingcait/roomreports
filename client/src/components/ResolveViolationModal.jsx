import { useState, useEffect } from 'react';
import Modal from './Modal';

const RESOLVED_TYPES = [
  { value: 'RESOLVED_BY_RESIDENT', label: 'Resolved by resident' },
  { value: 'WARNING_ISSUED', label: 'Warning issued' },
  { value: 'FINE_ASSESSED', label: 'Fine assessed' },
  { value: 'LEASE_TERMINATION', label: 'Lease termination' },
  { value: 'DISMISSED', label: 'Dismissed / false flag' },
];

function todayLocal() {
  return new Date().toISOString().slice(0, 16);
}

export default function ResolveViolationModal({ open, onClose, violationId, onUpdated }) {
  const [resolvedType, setResolvedType] = useState('RESOLVED_BY_RESIDENT');
  const [resolvedNote, setResolvedNote] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [photos, setPhotos] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setResolvedType('RESOLVED_BY_RESIDENT'); setResolvedNote(''); setDate(todayLocal()); setPhotos([]); setError(''); }
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const form = new FormData();
      form.append('resolvedType', resolvedType);
      form.append('date', new Date(date).toISOString());
      if (resolvedNote.trim()) form.append('resolvedNote', resolvedNote.trim());
      for (const file of photos) form.append('photos', file);
      await fetch(`/api/violations/${violationId}/resolve`, {
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
    <Modal open={open} onClose={onClose} title="Resolve Violation">
      <form className="modal-form" onSubmit={submit}>
        <label>
          Resolution
          <select className="form-select" value={resolvedType} onChange={(e) => setResolvedType(e.target.value)}>
            {RESOLVED_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>

        <label>
          Resolution date <span className="form-optional">(defaults to today)</span>
          <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <label>
          Notes <span className="form-optional">(optional)</span>
          <textarea
            className="detail-textarea"
            value={resolvedNote}
            onChange={(e) => setResolvedNote(e.target.value)}
            placeholder="How was this resolved? Any follow-up actions taken?"
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
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Resolving...' : 'Resolve Violation'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

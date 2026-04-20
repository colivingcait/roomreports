import { useState, useEffect } from 'react';
import Modal from './Modal';
import { FLAG_CATEGORIES } from '../../../shared/index.js';

const EMPTY = { name: '', company: '', phone: '', email: '', specialties: [], notes: '' };

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

export default function VendorForm({ open, vendor, onClose, onSaved }) {
  const [draft, setDraft] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (vendor) {
      setDraft({
        name: vendor.name || '',
        company: vendor.company || '',
        phone: vendor.phone || '',
        email: vendor.email || '',
        specialties: vendor.specialties || [],
        notes: vendor.notes || '',
      });
    } else {
      setDraft(EMPTY);
    }
    setError('');
  }, [vendor, open]);

  const toggleSpecialty = (c) => {
    setDraft((prev) => ({
      ...prev,
      specialties: prev.specialties.includes(c)
        ? prev.specialties.filter((x) => x !== c)
        : [...prev.specialties, c],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    setSaving(true);
    setError('');
    try {
      const path = vendor ? `/api/vendors/${vendor.id}` : '/api/vendors';
      const method = vendor ? 'PUT' : 'POST';
      const data = await api(path, { method, body: JSON.stringify(draft) });
      onSaved(data.vendor);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={vendor ? `Edit ${vendor.name}` : 'Add Vendor'}>
      <form onSubmit={handleSubmit} className="modal-form">
        {error && <div className="auth-error">{error}</div>}
        <label>
          Name
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Jane Smith"
            required
          />
        </label>
        <label>
          Company <span className="form-optional">(optional)</span>
          <input
            type="text"
            value={draft.company}
            onChange={(e) => setDraft({ ...draft, company: e.target.value })}
            placeholder="Handy Co"
          />
        </label>
        <label>
          Phone <span className="form-optional">(optional)</span>
          <input
            type="tel"
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            placeholder="(555) 123-4567"
          />
        </label>
        <label>
          Email <span className="form-optional">(optional)</span>
          <input
            type="email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            placeholder="jane@handyco.com"
          />
        </label>
        <label>
          Specialties <span className="form-optional">(select any)</span>
          <div className="tag-list">
            {FLAG_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className={`tag ${draft.specialties.includes(c) ? 'tag-active' : ''}`}
                onClick={() => toggleSpecialty(c)}
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
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            placeholder="Preferred hours, rate, anything else..."
            rows={2}
          />
        </label>
        <button type="submit" className="btn-primary" disabled={saving || !draft.name.trim()}>
          {saving ? 'Saving...' : vendor ? 'Save Changes' : 'Add Vendor'}
        </button>
      </form>
    </Modal>
  );
}

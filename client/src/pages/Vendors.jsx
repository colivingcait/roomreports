import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';
import { FLAG_CATEGORIES } from '../../../shared/index.js';
import { useAuth } from '../context/AuthContext';

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

function VendorMenu({ vendor, onEdit, onArchive, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const handler = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [onClose]);
  return (
    <div className="member-menu" ref={ref}>
      <button className="member-menu-item" onClick={() => { onEdit(vendor); onClose(); }}>Edit</button>
      <button className="member-menu-item member-menu-danger" onClick={() => { onArchive(vendor); onClose(); }}>Archive</button>
    </div>
  );
}

function VendorForm({ open, onClose, onSaved, initial }) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [specialties, setSpecialties] = useState([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName(initial?.name || '');
      setCompany(initial?.company || '');
      setPhone(initial?.phone || '');
      setEmail(initial?.email || '');
      setSpecialties(initial?.specialties || []);
      setNotes(initial?.notes || '');
      setError('');
    }
  }, [open, initial]);

  const toggleSpec = (cat) => {
    setSpecialties((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        company: company.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        specialties,
        notes: notes.trim() || null,
      };
      const d = initial?.id
        ? await api(`/api/vendors/${initial.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await api('/api/vendors', { method: 'POST', body: JSON.stringify(payload) });
      onSaved(d.vendor);
    } catch (err) {
      setError(err.message || 'Failed to save vendor');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { if (!saving) onClose(); }} title={initial?.id ? 'Edit Vendor' : 'Add Vendor'}>
      <form className="modal-form" onSubmit={submit}>
        <label>
          Name
          <input type="text" className="maint-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label>
          Company <span className="form-optional">(optional)</span>
          <input type="text" className="maint-input" value={company} onChange={(e) => setCompany(e.target.value)} />
        </label>
        <label>
          Phone <span className="form-optional">(optional)</span>
          <input type="tel" className="maint-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label>
          Email <span className="form-optional">(optional)</span>
          <input type="email" className="maint-input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <div>
          <div className="form-label-sm">Specialty categories</div>
          <div className="violation-pill-row">
            {FLAG_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`q-compliance-pill ${specialties.includes(cat) ? 'selected' : ''}`}
                onClick={() => toggleSpec(cat)}
                style={specialties.includes(cat) ? { background: '#6B8F71', borderColor: '#6B8F71', color: '#fff' } : undefined}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
        <label>
          Notes <span className="form-optional">(optional)</span>
          <textarea
            className="detail-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : (initial?.id ? 'Save changes' : 'Add vendor')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Vendors() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [menuOpenFor, setMenuOpenFor] = useState(null);

  const isOwnerOrPM = user?.role === 'OWNER' || user?.role === 'PM';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api('/api/vendors');
      setVendors(d.vendors || []);
    } catch (err) {
      setError(err.message || 'Failed to load vendors');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSaved = () => {
    setShowForm(false);
    setEditing(null);
    load();
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      await api(`/api/vendors/${archiveTarget.id}`, { method: 'DELETE' });
      setArchiveTarget(null);
      load();
    } catch { /* ignore */ }
    finally { setArchiving(false); }
  };

  if (loading) return <div className="page-loading">Loading vendors...</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Vendors</h1>
          <p className="page-subtitle">
            {vendors.length} {vendors.length === 1 ? 'vendor' : 'vendors'}
          </p>
        </div>
        {isOwnerOrPM && (
          <button className="btn-primary-sm" onClick={() => { setEditing(null); setShowForm(true); }}>
            + Add Vendor
          </button>
        )}
      </div>

      {error && <div className="auth-error">{error}</div>}

      {vendors.length === 0 ? (
        <div className="empty-state">
          <p>No vendors yet.</p>
          {isOwnerOrPM && (
            <button className="btn-primary-sm" onClick={() => setShowForm(true)}>
              Add your first vendor
            </button>
          )}
        </div>
      ) : (
        <div className="vendor-list">
          {vendors.map((v) => (
            <div
              key={v.id}
              className="vendor-row"
              onClick={() => navigate(`/vendors/${v.id}`)}
            >
              <div className="vendor-row-main">
                <div className="vendor-row-name">{v.name}</div>
                {v.company && <div className="vendor-row-company">{v.company}</div>}
                <div className="vendor-row-contact">
                  {v.phone && <span>{v.phone}</span>}
                  {v.phone && v.email && <span className="dot" />}
                  {v.email && <span>{v.email}</span>}
                </div>
                {v.specialties?.length > 0 && (
                  <div className="vendor-row-specs">
                    {v.specialties.map((s) => (
                      <span key={s} className="vendor-spec-pill">{s}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="vendor-row-right">
                <div className="vendor-row-jobs">
                  <span className="vendor-row-jobs-num">{v.activeJobs || 0}</span>
                  <span className="vendor-row-jobs-label">active job{v.activeJobs === 1 ? '' : 's'}</span>
                </div>
                {isOwnerOrPM && (
                  <div className="team-menu-wrap" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="team-menu-btn"
                      onClick={() => setMenuOpenFor(menuOpenFor === v.id ? null : v.id)}
                      aria-label="Open menu"
                    >
                      &#8942;
                    </button>
                    {menuOpenFor === v.id && (
                      <VendorMenu
                        vendor={v}
                        onEdit={(ven) => { setEditing(ven); setShowForm(true); }}
                        onArchive={(ven) => setArchiveTarget(ven)}
                        onClose={() => setMenuOpenFor(null)}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <VendorForm
        open={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onSaved={handleSaved}
        initial={editing}
      />

      <Modal
        open={!!archiveTarget}
        onClose={() => { if (!archiving) setArchiveTarget(null); }}
        title="Archive vendor"
      >
        {archiveTarget && (
          <div className="modal-form">
            <p>
              Archive <strong>{archiveTarget.name}</strong>? They won&apos;t appear in the
              vendor picker anymore, but historical work orders stay attributed
              to them.
            </p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setArchiveTarget(null)} disabled={archiving}>
                Cancel
              </button>
              <button className="btn-danger" onClick={handleArchive} disabled={archiving}>
                {archiving ? 'Archiving...' : 'Archive'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

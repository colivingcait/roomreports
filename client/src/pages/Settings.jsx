import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

// Common US timezones first, then everything Intl has.
const COMMON_TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
];
function allTimezones() {
  try {
    const all = Intl.supportedValuesOf('timeZone');
    return Array.from(new Set([...COMMON_TIMEZONES, ...all]));
  } catch {
    return COMMON_TIMEZONES;
  }
}

export default function Settings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [org, setOrg] = useState(null);
  const [owner, setOwner] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [timezone, setTimezone] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveMsg, setSaveMsg] = useState('');

  // Delete
  const [showDelete, setShowDelete] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const isOwner = user?.role === 'OWNER';

  useEffect(() => {
    api('/api/organization')
      .then((d) => {
        setOrg(d.organization);
        setOwner(d.owner);
        setName(d.organization?.name || '');
        setSlug(d.organization?.slug || '');
        setTimezone(d.organization?.timezone || '');
        setPhone(d.organization?.phone || '');
      })
      .catch((err) => setLoadError(err.message || 'Failed to load organization'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    setSaveMsg('');
    try {
      const d = await api('/api/organization', {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim() || undefined,
          slug: slug.trim() || undefined,
          timezone: timezone || null,
          phone: phone.trim() || null,
        }),
      });
      setOrg(d.organization);
      setName(d.organization.name);
      setSlug(d.organization.slug || '');
      setTimezone(d.organization.timezone || '');
      setPhone(d.organization.phone || '');
      setSaveMsg('Saved.');
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (err) {
      setSaveError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (e) => {
    e.preventDefault();
    setDeleting(true);
    setDeleteError('');
    try {
      await api('/api/organization', {
        method: 'DELETE',
        body: JSON.stringify({ confirmSlug }),
      });
      // Org is gone, user's session is invalidated server-side.
      logout?.();
      navigate('/login');
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete organization');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="page-loading">Loading settings...</div>;
  if (loadError) return <div className="page-container"><div className="auth-error">{loadError}</div></div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="page-subtitle">Organization settings</p>
        </div>
      </div>

      <form className="settings-form" onSubmit={handleSave}>
        <label>
          Organization name
          <input
            type="text"
            className="maint-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isOwner}
          />
        </label>

        <label>
          Organization slug
          <input
            type="text"
            className="maint-input"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={!isOwner}
          />
          <span className="form-hint">
            Used in resident links (e.g. roomreport.co/movein/<strong>{slug || 'your-slug'}</strong>).
            Lowercase letters, numbers, and hyphens only.
          </span>
        </label>

        <label>
          Owner email
          <input
            type="email"
            className="maint-input"
            value={owner?.email || ''}
            disabled
            title="Owner email is set at signup"
          />
        </label>

        <label>
          Property manager phone
          <input
            type="tel"
            className="maint-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
            disabled={!isOwner}
          />
          <span className="form-hint">
            {phone.trim()
              ? "Residents see this number on emergency popups in the maintenance report flow."
              : "Add your phone number so residents can reach you in emergencies."}
          </span>
        </label>

        <label>
          Timezone
          <select
            className="form-select"
            value={timezone || ''}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={!isOwner}
          >
            <option value="">— Not set —</option>
            {allTimezones().map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </label>

        {saveError && <div className="auth-error">{saveError}</div>}
        {saveMsg && <div className="settings-success">{saveMsg}</div>}

        {isOwner && (
          <div className="modal-actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        )}
        {!isOwner && (
          <p className="empty-text">Only the organization owner can change settings.</p>
        )}
      </form>

      {isOwner && (
        <div className="settings-danger">
          <h3 className="settings-danger-title">Danger zone</h3>
          <div className="settings-danger-body">
            <div>
              <div className="settings-danger-head">Delete organization</div>
              <div className="settings-danger-sub">
                Permanently deactivates the org and signs out all members. Data is
                soft-deleted and can be recovered by Anthropic support for 30 days.
              </div>
            </div>
            <button className="btn-danger" onClick={() => setShowDelete(true)}>
              Delete organization
            </button>
          </div>
        </div>
      )}

      <Modal
        open={showDelete}
        onClose={() => { if (!deleting) { setShowDelete(false); setConfirmSlug(''); setDeleteError(''); } }}
        title="Delete organization"
      >
        <form className="modal-form" onSubmit={handleDelete}>
          <p>
            This removes the org for everyone on the team and signs them out.
            Inspection history, maintenance tickets, violations — all preserved
            as soft-deleted but no longer accessible to your team.
          </p>
          <label>
            Type your organization slug <code>{org?.slug || '—'}</code> to confirm.
            <input
              type="text"
              className="maint-input"
              value={confirmSlug}
              onChange={(e) => setConfirmSlug(e.target.value)}
              placeholder={org?.slug || ''}
              autoFocus
            />
          </label>
          {deleteError && <div className="auth-error">{deleteError}</div>}
          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { setShowDelete(false); setConfirmSlug(''); }}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-danger"
              disabled={deleting || confirmSlug !== org?.slug}
            >
              {deleting ? 'Deleting...' : 'Delete organization'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import VendorForm from '../components/VendorForm';
import { ROLE_LABELS, roleLabel } from '../../../shared/index.js';

// ─── Resident Link card with Copy Link + QR download ────

function ResidentLinkCard({ title, url, flyerHref }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    const svg = document.getElementById(`qr-${title.replace(/\s/g, '-')}`);
    if (!svg) return;
    const serializer = new XMLSerializer();
    const data = serializer.serializeToString(svg);
    const blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' });
    const dl = document.createElement('a');
    dl.href = URL.createObjectURL(blob);
    dl.download = `${title.replace(/\s/g, '-').toLowerCase()}-qr.svg`;
    document.body.appendChild(dl);
    dl.click();
    document.body.removeChild(dl);
    URL.revokeObjectURL(dl.href);
  };

  return (
    <div className="pub-link-card">
      <h4>{title}</h4>
      <div className="pub-link-qr">
        <QRCodeSVG id={`qr-${title.replace(/\s/g, '-')}`} value={url} size={120} level="M" fgColor="#2C2C2C" />
      </div>
      <code className="pub-link-url">{url}</code>
      <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn-primary-xs"
          onClick={handleCopy}
          style={copied ? { color: '#3B6D11', borderColor: '#6B8F71' } : undefined}
        >
          {copied ? 'Copied!' : 'Copy Link'}
        </button>
        <button type="button" className="btn-secondary" onClick={handleDownload}>
          Download QR
        </button>
        {flyerHref && (
          <button type="button" className="btn-secondary" onClick={() => window.open(flyerHref, '_blank')}>
            Print flyer
          </button>
        )}
      </div>
    </div>
  );
}

const ROLE_COLORS = {
  OWNER: '#2C2C2C',
  PM: '#6B8F71',
  CLEANER: '#C4703F',
  HANDYPERSON: '#5B7A8A',
  RESIDENT: '#C9A84C',
  OTHER: '#8A8580',
};
const INVITABLE_ROLES = ['PM', 'CLEANER', 'HANDYPERSON', 'RESIDENT', 'OTHER'];

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

export default function Team() {
  const { user, organization } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [properties, setProperties] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);

  // Vendor modal
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [editingVendor, setEditingVendor] = useState(null);
  const [archiveVendorTarget, setArchiveVendorTarget] = useState(null);

  // Invite modal
  const [showInvite, setShowInvite] = useState(false);
  const [invEmail, setInvEmail] = useState('');
  const [invName, setInvName] = useState('');
  const [invRole, setInvRole] = useState('CLEANER');
  const [invCustomRole, setInvCustomRole] = useState('');
  const [invPropertyIds, setInvPropertyIds] = useState([]);
  const [inviting, setInviting] = useState(false);
  const [invError, setInvError] = useState('');
  const [createdCredentials, setCreatedCredentials] = useState(null);
  const [copied, setCopied] = useState('');

  // Edit modal
  const [editUser, setEditUser] = useState(null);
  const [editRole, setEditRole] = useState('');
  const [editCustomRole, setEditCustomRole] = useState('');
  const [editPropertyIds, setEditPropertyIds] = useState([]);
  const [saving, setSaving] = useState(false);

  // Deactivate
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [deactivating, setDeactivating] = useState(false);

  // Reset password
  const [resetTarget, setResetTarget] = useState(null);
  const [resetResult, setResetResult] = useState(null);
  const [resetting, setResetting] = useState(false);

  // Feature suggestion
  const [suggestion, setSuggestion] = useState('');
  const [submittingSuggestion, setSubmittingSuggestion] = useState(false);
  const [suggestionSuccess, setSuggestionSuccess] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestionsList, setShowSuggestionsList] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [teamData, propData, vendorData] = await Promise.all([
        api('/api/team'),
        api('/api/properties'),
        api('/api/vendors'),
      ]);
      setUsers(teamData.users || []);
      setProperties(propData.properties || []);
      setVendors(vendorData.vendors || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const handleVendorSaved = (vendor) => {
    setVendors((prev) => {
      const exists = prev.find((v) => v.id === vendor.id);
      return exists
        ? prev.map((v) => v.id === vendor.id ? vendor : v)
        : [...prev, vendor].sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  const handleArchiveVendor = async () => {
    if (!archiveVendorTarget) return;
    try {
      await api(`/api/vendors/${archiveVendorTarget.id}`, { method: 'DELETE' });
      setVendors((prev) => prev.filter((v) => v.id !== archiveVendorTarget.id));
    } catch { /* ignore */ }
    finally { setArchiveVendorTarget(null); }
  };

  useEffect(() => { fetchData(); }, [fetchData]);

  const resetInviteForm = () => {
    setInvEmail('');
    setInvName('');
    setInvRole('CLEANER');
    setInvCustomRole('');
    setInvPropertyIds([]);
    setInvError('');
    setCreatedCredentials(null);
    setCopied('');
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviting(true);
    setInvError('');
    try {
      const data = await api('/api/team/invite', {
        method: 'POST',
        body: JSON.stringify({
          email: invEmail,
          name: invName || undefined,
          role: invRole,
          customRole: invRole === 'OTHER' ? invCustomRole.trim() : undefined,
          propertyIds: invPropertyIds,
        }),
      });
      setCreatedCredentials({ email: data.user.email, password: data.password });
      fetchData();
    } catch (err) {
      setInvError(err.message);
    } finally {
      setInviting(false);
    }
  };

  const toggleInvProperty = (pid) => {
    setInvPropertyIds((prev) =>
      prev.includes(pid) ? prev.filter((id) => id !== pid) : [...prev, pid],
    );
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(''), 2000);
    });
  };

  const openEdit = (u) => {
    setEditUser(u);
    setEditRole(u.role);
    setEditCustomRole(u.customRole || '');
    setEditPropertyIds(u.propertyAssignments?.map((a) => a.property.id) || []);
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      await api(`/api/team/${editUser.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          role: editRole,
          customRole: editRole === 'OTHER' ? editCustomRole.trim() : undefined,
          propertyIds: editPropertyIds,
        }),
      });
      setEditUser(null);
      fetchData();
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  const handleDeactivate = async () => {
    setDeactivating(true);
    try {
      await api(`/api/team/${deactivateTarget.id}`, { method: 'DELETE' });
      setDeactivateTarget(null);
      fetchData();
    } catch { /* ignore */ }
    finally { setDeactivating(false); }
  };

  const handleResetPassword = async () => {
    setResetting(true);
    try {
      const data = await api(`/api/team/${resetTarget.id}/reset-password`, { method: 'POST' });
      setResetResult({ email: data.user.email, password: data.password });
    } catch { /* ignore */ }
    finally { setResetting(false); }
  };

  const handleSubmitSuggestion = async (e) => {
    e.preventDefault();
    if (!suggestion.trim()) return;
    setSubmittingSuggestion(true);
    try {
      await api('/api/suggestions', {
        method: 'POST',
        body: JSON.stringify({ suggestion: suggestion.trim() }),
      });
      setSuggestion('');
      setSuggestionSuccess(true);
      setTimeout(() => setSuggestionSuccess(false), 3000);
    } catch { /* ignore */ }
    finally { setSubmittingSuggestion(false); }
  };

  const loadSuggestions = async () => {
    try {
      const data = await api('/api/suggestions');
      setSuggestions(data.suggestions || []);
      setShowSuggestionsList(true);
    } catch { /* ignore */ }
  };

  const toggleProperty = (pid) => {
    setEditPropertyIds((prev) =>
      prev.includes(pid) ? prev.filter((id) => id !== pid) : [...prev, pid],
    );
  };

  const buildLoginMessage = (creds) =>
    `Here's your RoomReport login:\n\nEmail: ${creds.email}\nPassword: ${creds.password}\n\nLogin at: ${window.location.origin}/login`;

  const isOwner = user?.role === 'OWNER';
  const canInvite = user?.role === 'OWNER' || user?.role === 'PM';
  const activeUsers = users.filter((u) => !u.deletedAt);
  const deactivatedUsers = users.filter((u) => u.deletedAt);

  if (loading) return <div className="page-loading">Loading team...</div>;

  const credentialsDisplay = (creds, onClose) => (
    <div>
      <p style={{ color: '#6B8F71', fontWeight: 600, marginBottom: '0.5rem' }}>Account created</p>
      <p style={{ fontSize: '0.85rem', color: '#8A8580', marginBottom: '1rem' }}>
        Share these credentials with {creds.email}. This password won&apos;t be shown again.
      </p>

      <div className="credentials-box">
        <div className="credential-row">
          <span className="credential-label">Email</span>
          <code className="credential-value">{creds.email}</code>
        </div>
        <div className="credential-row">
          <span className="credential-label">Password</span>
          <code className="credential-value credential-password">{creds.password}</code>
        </div>
      </div>

      <div className="credential-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => copyToClipboard(creds.password, 'password')}
        >
          {copied === 'password' ? 'Copied \u2713' : 'Copy Password'}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => copyToClipboard(buildLoginMessage(creds), 'full')}
        >
          {copied === 'full' ? 'Copied \u2713' : 'Copy Login Details'}
        </button>
      </div>

      <p className="credential-warning">This password won&apos;t be shown again.</p>

      <button className="btn-secondary" style={{ marginTop: '0.75rem', width: '100%' }} onClick={onClose}>
        Done
      </button>
    </div>
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Team</h1>
          <p className="page-subtitle">{activeUsers.length} member{activeUsers.length !== 1 ? 's' : ''}</p>
        </div>
        {canInvite && (
          <button className="btn-primary-sm" onClick={() => { setShowInvite(true); resetInviteForm(); }}>
            + Add Member
          </button>
        )}
      </div>

      {/* Active members */}
      <div className="team-list">
        {activeUsers.map((u) => (
          <div key={u.id} className="team-card">
            <div className="team-card-left">
              <div className="team-card-name">
                {u.name}
                {u.id === user?.id && <span className="team-you">(you)</span>}
              </div>
              <div className="team-card-email">{u.email}</div>
              {u.propertyAssignments?.length > 0 && (
                <div className="team-props">
                  {u.propertyAssignments.map((a) => (
                    <span key={a.property.id} className="team-prop-tag">{a.property.name}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="team-card-right">
              <span className="team-role-badge" style={{ color: ROLE_COLORS[u.role] || '#8A8580', borderColor: ROLE_COLORS[u.role] || '#8A8580' }}>
                {roleLabel(u.role, u.customRole)}
              </span>
              {isOwner && u.id !== user?.id && (
                <div className="team-actions">
                  <button className="btn-text-sm" onClick={() => openEdit(u)}>Edit</button>
                  <button className="btn-text-sm" onClick={() => { setResetTarget(u); setResetResult(null); }}>
                    Reset Password
                  </button>
                  <button className="btn-text-sm" style={{ color: '#C53030' }} onClick={() => setDeactivateTarget(u)}>Deactivate</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Deactivated users */}
      {deactivatedUsers.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <h3 className="team-section-title">Deactivated</h3>
          <div className="team-list">
            {deactivatedUsers.map((u) => (
              <div key={u.id} className="team-card" style={{ opacity: 0.5 }}>
                <div className="team-card-left">
                  <div className="team-card-name">{u.name}</div>
                  <div className="team-card-email">{u.email}</div>
                </div>
                <span className="team-role-badge" style={{ color: '#B5B0AB', borderColor: '#E8E4DF' }}>{roleLabel(u.role, u.customRole)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resident Links — org-wide */}
      {organization?.slug && (
        <div style={{ marginTop: '1.5rem' }}>
          <h3 className="team-section-title">Resident Links</h3>
          <p className="suggestion-help">
            Share these links or print the QR codes. Residents enter their street name to find their place.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            <ResidentLinkCard
              title="Move-In Inspection"
              url={`https://roomreport.co/movein/${organization.slug}`}
              flyerHref={`/flyer/${organization.slug}/movein`}
            />
            <ResidentLinkCard
              title="Monthly Self-Check"
              url={`https://roomreport.co/selfcheck/${organization.slug}`}
              flyerHref={`/flyer/${organization.slug}/selfcheck`}
            />
            <ResidentLinkCard
              title="Report Maintenance"
              url={`https://roomreport.co/report/${organization.slug}`}
              flyerHref={`/flyer/${organization.slug}/report`}
            />
          </div>
        </div>
      )}

      {/* Vendors */}
      {canInvite && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="section-header">
            <h3 className="team-section-title" style={{ margin: 0 }}>Vendors</h3>
            <button className="btn-text-sm" onClick={() => { setEditingVendor(null); setShowVendorForm(true); }}>
              + Add Vendor
            </button>
          </div>
          {vendors.length === 0 ? (
            <p className="empty-text">No vendors yet</p>
          ) : (
            <div className="team-list">
              {vendors.map((v) => (
                <div key={v.id} className="team-card" onClick={() => navigate(`/vendors/${v.id}`)} style={{ cursor: 'pointer' }}>
                  <div className="team-card-left">
                    <div className="team-card-name">{v.name}</div>
                    <div className="team-card-email">
                      {v.company}
                      {v.phone && <> &middot; {v.phone}</>}
                      {v.email && <> &middot; {v.email}</>}
                    </div>
                    {v.specialties?.length > 0 && (
                      <div className="team-props">
                        {v.specialties.map((s) => <span key={s} className="team-prop-tag">{s}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="team-card-right">
                    <div className="team-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-text-sm" onClick={() => { setEditingVendor(v); setShowVendorForm(true); }}>Edit</button>
                      <button className="btn-text-sm" style={{ color: '#C53030' }} onClick={() => setArchiveVendorTarget(v)}>Archive</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <VendorForm
        open={showVendorForm}
        vendor={editingVendor}
        onClose={() => { setShowVendorForm(false); setEditingVendor(null); }}
        onSaved={handleVendorSaved}
      />
      <ConfirmDialog
        open={!!archiveVendorTarget}
        onClose={() => setArchiveVendorTarget(null)}
        onConfirm={handleArchiveVendor}
        title="Archive Vendor"
        message={`Archive "${archiveVendorTarget?.name}"? Their job history stays accessible on existing tickets.`}
        confirmLabel="Archive"
      />

      {/* Shortcuts */}
      <div style={{ marginTop: '1.5rem' }}>
        <h3 className="team-section-title">Shortcuts</h3>
        <div className="shortcut-grid">
          <button className="shortcut-card" onClick={() => navigate('/health')}>
            <span className="shortcut-title">Properties</span>
            <span className="shortcut-sub">Health grades + portfolio view</span>
          </button>
          <button className="shortcut-card" onClick={() => navigate('/todo')}>
            <span className="shortcut-title">To-Do</span>
            <span className="shortcut-sub">Admin to-do board</span>
          </button>
          <button className="shortcut-card" onClick={() => navigate('/calendar')}>
            <span className="shortcut-title">Calendar</span>
            <span className="shortcut-sub">Inspection schedules + overdue</span>
          </button>
          <button className="shortcut-card" onClick={() => navigate('/violations')}>
            <span className="shortcut-title">Lease Violations</span>
            <span className="shortcut-sub">Follow-up log + paper trail</span>
          </button>
          <button className="shortcut-card" onClick={() => navigate('/templates')}>
            <span className="shortcut-title">Templates</span>
            <span className="shortcut-sub">Customize inspection checklists</span>
          </button>
        </div>
      </div>

      {/* Suggest a Feature */}
      <div style={{ marginTop: '1.5rem' }}>
        <h3 className="team-section-title">Suggest a Feature</h3>
        <div className="suggestion-box">
          <p className="suggestion-help">
            Have an idea for something RoomReport could do better? Let us know.
          </p>
          <form onSubmit={handleSubmitSuggestion} className="suggestion-form">
            <textarea
              className="detail-textarea"
              value={suggestion}
              onChange={(e) => setSuggestion(e.target.value)}
              placeholder="I'd love it if..."
              rows={3}
            />
            <div className="suggestion-actions">
              {suggestionSuccess && (
                <span className="suggestion-success">{'\u2713'} Thanks for the suggestion!</span>
              )}
              <button
                type="submit"
                className="btn-primary-sm"
                disabled={submittingSuggestion || !suggestion.trim()}
              >
                {submittingSuggestion ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </form>
          {(isOwner || user?.role === 'PM') && (
            <div className="suggestion-admin">
              <button className="btn-text-sm" onClick={loadSuggestions}>
                See past requests &rarr;
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Suggestions list modal */}
      <Modal
        open={showSuggestionsList}
        onClose={() => setShowSuggestionsList(false)}
        title="Submitted Suggestions"
      >
        {suggestions.length === 0 ? (
          <p className="empty-text">No suggestions yet</p>
        ) : (
          <div className="suggestion-list">
            {suggestions.map((s) => (
              <div key={s.id} className="suggestion-item">
                <p className="suggestion-text">{s.suggestion}</p>
                <div className="suggestion-meta">
                  {s.userName} &middot; {new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Invite Modal */}
      <Modal
        open={showInvite}
        onClose={() => { setShowInvite(false); resetInviteForm(); }}
        title={createdCredentials ? 'Account Created' : 'Add Team Member'}
      >
        {createdCredentials ? (
          credentialsDisplay(createdCredentials, () => { setShowInvite(false); resetInviteForm(); })
        ) : (
          <form onSubmit={handleInvite} className="modal-form">
            {invError && <div className="auth-error">{invError}</div>}
            <label>
              Name <span className="form-optional">(optional)</span>
              <input type="text" value={invName} onChange={(e) => setInvName(e.target.value)} placeholder="Jane Doe" />
            </label>
            <label>
              Email
              <input type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="jane@example.com" required />
            </label>
            <label>
              Role
              <select className="form-select" value={invRole} onChange={(e) => setInvRole(e.target.value)}>
                {INVITABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </label>
            {invRole === 'OTHER' && (
              <label>
                Role name
                <input
                  type="text"
                  value={invCustomRole}
                  onChange={(e) => setInvCustomRole(e.target.value)}
                  placeholder="e.g. Regional Manager"
                  required
                />
              </label>
            )}
            {properties.length > 0 && (
              <label>
                Property Assignments <span className="form-optional">(select one or more)</span>
                <div className="team-prop-checkboxes">
                  {properties.map((p) => (
                    <label key={p.id} className="team-prop-checkbox">
                      <input
                        type="checkbox"
                        checked={invPropertyIds.includes(p.id)}
                        onChange={() => toggleInvProperty(p.id)}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              </label>
            )}
            <button
              type="submit"
              className="btn-primary"
              disabled={inviting || (invRole === 'OTHER' && !invCustomRole.trim())}
            >
              {inviting ? 'Creating...' : 'Create Account'}
            </button>
          </form>
        )}
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        open={!!resetTarget}
        onClose={() => { setResetTarget(null); setResetResult(null); setCopied(''); }}
        title={resetResult ? 'New Password' : 'Reset Password'}
      >
        {resetResult ? (
          credentialsDisplay(resetResult, () => { setResetTarget(null); setResetResult(null); setCopied(''); })
        ) : (
          <div className="modal-form">
            <p style={{ color: '#2C2C2C', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Generate a new password for <strong>{resetTarget?.name}</strong>?
              They will be logged out of all sessions.
            </p>
            <button className="btn-danger" onClick={handleResetPassword} disabled={resetting} style={{ width: '100%' }}>
              {resetting ? 'Generating...' : 'Generate New Password'}
            </button>
          </div>
        )}
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editUser} onClose={() => setEditUser(null)} title={`Edit ${editUser?.name}`}>
        <div className="modal-form">
          <label>
            Role
            <select className="form-select" value={editRole} onChange={(e) => setEditRole(e.target.value)}>
              {INVITABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </label>
          {editRole === 'OTHER' && (
            <label>
              Role name
              <input
                type="text"
                value={editCustomRole}
                onChange={(e) => setEditCustomRole(e.target.value)}
                placeholder="e.g. Regional Manager"
              />
            </label>
          )}
          <label>
            Property Assignments
            <div className="team-prop-checkboxes">
              {properties.map((p) => (
                <label key={p.id} className="team-prop-checkbox">
                  <input
                    type="checkbox"
                    checked={editPropertyIds.includes(p.id)}
                    onChange={() => toggleProperty(p.id)}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </label>
          <button
            className="btn-primary"
            onClick={handleSaveEdit}
            disabled={saving || (editRole === 'OTHER' && !editCustomRole.trim())}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </Modal>

      {/* Deactivate Confirm */}
      <ConfirmDialog
        open={!!deactivateTarget}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={handleDeactivate}
        loading={deactivating}
        title="Deactivate User"
        message={`Are you sure you want to deactivate ${deactivateTarget?.name}? They will be logged out and unable to access the platform.`}
        confirmLabel="Deactivate"
      />
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

const ROLE_COLORS = { OWNER: '#4A4543', PM: '#6B8F71', CLEANER: '#C4703F', RESIDENT: '#C9A84C' };
const INVITABLE_ROLES = ['PM', 'CLEANER', 'RESIDENT'];

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

export default function Team() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);

  // Invite modal
  const [showInvite, setShowInvite] = useState(false);
  const [invEmail, setInvEmail] = useState('');
  const [invName, setInvName] = useState('');
  const [invRole, setInvRole] = useState('CLEANER');
  const [invPropertyId, setInvPropertyId] = useState('');
  const [inviting, setInviting] = useState(false);
  const [invError, setInvError] = useState('');
  const [createdCredentials, setCreatedCredentials] = useState(null);
  const [copied, setCopied] = useState('');

  // Edit modal
  const [editUser, setEditUser] = useState(null);
  const [editRole, setEditRole] = useState('');
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
      const [teamData, propData] = await Promise.all([
        api('/api/team'),
        api('/api/properties'),
      ]);
      setUsers(teamData.users || []);
      setProperties(propData.properties || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const resetInviteForm = () => {
    setInvEmail('');
    setInvName('');
    setInvRole('CLEANER');
    setInvPropertyId('');
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
          propertyId: invPropertyId || undefined,
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

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(''), 2000);
    });
  };

  const openEdit = (u) => {
    setEditUser(u);
    setEditRole(u.role);
    setEditPropertyIds(u.propertyAssignments?.map((a) => a.property.id) || []);
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      await api(`/api/team/${editUser.id}`, {
        method: 'PUT',
        body: JSON.stringify({ role: editRole, propertyIds: editPropertyIds }),
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
      <p style={{ fontSize: '0.85rem', color: '#8A8583', marginBottom: '1rem' }}>
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
              {u.role === 'CLEANER' && u.propertyAssignments?.length > 0 && (
                <div className="team-props">
                  {u.propertyAssignments.map((a) => (
                    <span key={a.property.id} className="team-prop-tag">{a.property.name}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="team-card-right">
              <span className="team-role-badge" style={{ color: ROLE_COLORS[u.role], borderColor: ROLE_COLORS[u.role] }}>
                {u.role}
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
                <span className="team-role-badge" style={{ color: '#B5B1AF', borderColor: '#D4D0CE' }}>{u.role}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
                View submitted suggestions &rarr;
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
                {INVITABLE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            {(invRole === 'CLEANER' || invRole === 'RESIDENT') && (
              <label>
                Property {invRole === 'CLEANER' ? '(assignment)' : '(residence)'}
                <select className="form-select" value={invPropertyId} onChange={(e) => setInvPropertyId(e.target.value)}>
                  <option value="">Select property...</option>
                  {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
            <button type="submit" className="btn-primary" disabled={inviting}>
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
            <p style={{ color: '#4A4543', fontSize: '0.9rem', marginBottom: '1rem' }}>
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
              <option value="PM">PM</option>
              <option value="CLEANER">Cleaner</option>
              <option value="RESIDENT">Resident</option>
            </select>
          </label>
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
          <button className="btn-primary" onClick={handleSaveEdit} disabled={saving}>
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

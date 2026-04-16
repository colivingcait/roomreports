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
  const [invitations, setInvitations] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);

  // Invite modal
  const [showInvite, setShowInvite] = useState(false);
  const [invEmail, setInvEmail] = useState('');
  const [invRole, setInvRole] = useState('CLEANER');
  const [invPropertyId, setInvPropertyId] = useState('');
  const [inviting, setInviting] = useState(false);
  const [invError, setInvError] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');

  // Edit modal
  const [editUser, setEditUser] = useState(null);
  const [editRole, setEditRole] = useState('');
  const [editPropertyIds, setEditPropertyIds] = useState([]);
  const [saving, setSaving] = useState(false);

  // Deactivate
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [deactivating, setDeactivating] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [teamData, inviteData, propData] = await Promise.all([
        api('/api/team'),
        user?.role === 'OWNER' || user?.role === 'PM' ? api('/api/team/invites') : { invitations: [] },
        api('/api/properties'),
      ]);
      setUsers(teamData.users || []);
      setInvitations(inviteData.invitations || []);
      setProperties(propData.properties || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [user?.role]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviting(true);
    setInvError('');
    setInviteUrl('');
    try {
      const data = await api('/api/team/invite', {
        method: 'POST',
        body: JSON.stringify({
          email: invEmail,
          role: invRole,
          propertyId: invPropertyId || undefined,
        }),
      });
      setInviteUrl(data.signupUrl);
      fetchData();
    } catch (err) {
      setInvError(err.message);
    } finally {
      setInviting(false);
    }
  };

  const handleCancelInvite = async (id) => {
    try {
      await api(`/api/team/invites/${id}`, { method: 'DELETE' });
      fetchData();
    } catch { /* ignore */ }
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

  const toggleProperty = (pid) => {
    setEditPropertyIds((prev) =>
      prev.includes(pid) ? prev.filter((id) => id !== pid) : [...prev, pid],
    );
  };

  const isOwner = user?.role === 'OWNER';
  const canInvite = user?.role === 'OWNER' || user?.role === 'PM';
  const activeUsers = users.filter((u) => !u.deletedAt);
  const deactivatedUsers = users.filter((u) => u.deletedAt);

  if (loading) return <div className="page-loading">Loading team...</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Team</h1>
          <p className="page-subtitle">{activeUsers.length} member{activeUsers.length !== 1 ? 's' : ''}</p>
        </div>
        {canInvite && (
          <button className="btn-primary-sm" onClick={() => { setShowInvite(true); setInviteUrl(''); setInvError(''); setInvEmail(''); }}>
            + Invite Member
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
                  <button className="btn-text-sm" style={{ color: '#C53030' }} onClick={() => setDeactivateTarget(u)}>Deactivate</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Pending invitations */}
      {canInvite && invitations.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <h3 className="team-section-title">Pending Invitations</h3>
          <div className="team-list">
            {invitations.map((inv) => (
              <div key={inv.id} className="team-card team-card-pending">
                <div className="team-card-left">
                  <div className="team-card-name">{inv.email}</div>
                  <div className="team-card-email">
                    Invited by {inv.invitedBy?.name}
                    {inv.property && ` — ${inv.property.name}`}
                  </div>
                </div>
                <div className="team-card-right">
                  <span className="team-role-badge" style={{ color: ROLE_COLORS[inv.role], borderColor: ROLE_COLORS[inv.role] }}>
                    {inv.role}
                  </span>
                  <button className="btn-text-sm" style={{ color: '#C53030' }} onClick={() => handleCancelInvite(inv.id)}>Cancel</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Invite Modal */}
      <Modal open={showInvite} onClose={() => setShowInvite(false)} title="Invite Team Member">
        {inviteUrl ? (
          <div>
            <p style={{ color: '#6B8F71', fontWeight: 500, marginBottom: '0.5rem' }}>Invitation created!</p>
            <p style={{ fontSize: '0.85rem', color: '#8A8583', marginBottom: '0.75rem' }}>
              Share this signup link with {invEmail}:
            </p>
            <div className="invite-url-box">
              <code>{inviteUrl}</code>
              <button
                className="btn-primary-xs"
                onClick={() => { navigator.clipboard.writeText(inviteUrl); }}
              >
                Copy
              </button>
            </div>
            <button className="btn-secondary" style={{ marginTop: '1rem', width: '100%' }} onClick={() => { setShowInvite(false); setInviteUrl(''); }}>Done</button>
          </div>
        ) : (
          <form onSubmit={handleInvite} className="modal-form">
            {invError && <div className="auth-error">{invError}</div>}
            <label>
              Email
              <input type="email" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} placeholder="team@example.com" required />
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
              {inviting ? 'Sending...' : 'Send Invitation'}
            </button>
          </form>
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

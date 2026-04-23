import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';
import { ROLE_LABELS, roleLabel } from '../../../shared/index.js';

const ROLE_COLORS = {
  OWNER: '#4A4543',
  PM: '#6B8F71',
  CLEANER: '#C4703F',
  HANDYPERSON: '#5B7A8A',
  RESIDENT: '#C9A84C',
  OTHER: '#8A8583',
};

const INVITABLE_ROLES = ['PM', 'CLEANER', 'HANDYPERSON'];

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

function MemberMenu({ member, onEdit, onReset, onRemove, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const handler = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [onClose]);
  return (
    <div className="member-menu" ref={ref}>
      <button className="member-menu-item" onClick={() => { onEdit(member); onClose(); }}>Edit</button>
      <button className="member-menu-item" onClick={() => { onReset(member); onClose(); }}>Reset password</button>
      <button className="member-menu-item member-menu-danger" onClick={() => { onRemove(member); onClose(); }}>Remove</button>
    </div>
  );
}

function InviteMenu({ invite, onResend, onRevoke, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const handler = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [onClose]);
  return (
    <div className="member-menu" ref={ref}>
      <button className="member-menu-item" onClick={() => { onResend(invite); onClose(); }}>Resend invite</button>
      <button className="member-menu-item member-menu-danger" onClick={() => { onRevoke(invite); onClose(); }}>Revoke</button>
    </div>
  );
}

function StatusBadge({ status }) {
  if (status === 'EXPIRED') {
    return <span className="invite-badge invite-badge-expired">Expired</span>;
  }
  if (status === 'PENDING') {
    return <span className="invite-badge invite-badge-pending">Invited</span>;
  }
  return null;
}

export default function Team() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const [inviteMenuFor, setInviteMenuFor] = useState(null);
  const [showDeactivated, setShowDeactivated] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('CLEANER');
  const [addPropertyIds, setAddPropertyIds] = useState([]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [notification, setNotification] = useState('');

  const [editUser, setEditUser] = useState(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editPropertyIds, setEditPropertyIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [deactivating, setDeactivating] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revoking, setRevoking] = useState(false);

  const [resetTarget, setResetTarget] = useState(null);
  const [resetResult, setResetResult] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [copied, setCopied] = useState('');

  const isOwnerOrPM = user?.role === 'OWNER' || user?.role === 'PM';

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [teamData, propData] = await Promise.all([
        api('/api/team'),
        api('/api/properties'),
      ]);
      setUsers(teamData.users || []);
      setInvitations(teamData.invitations || []);
      setProperties(propData.properties || []);
    } catch (err) {
      setError(err.message || 'Failed to load team');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(''), 5000);
    return () => clearTimeout(t);
  }, [notification]);

  const resetAddForm = () => {
    setAddName('');
    setAddEmail('');
    setAddRole('CLEANER');
    setAddPropertyIds([]);
    setAddError('');
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!addName.trim() || !addEmail.trim()) {
      setAddError('Name and email are required');
      return;
    }
    setAdding(true);
    setAddError('');
    try {
      await api('/api/team/invite', {
        method: 'POST',
        body: JSON.stringify({
          name: addName.trim(),
          email: addEmail.trim(),
          role: addRole,
          propertyIds: addPropertyIds,
        }),
      });
      setShowAdd(false);
      resetAddForm();
      setNotification(`Invitation sent to ${addEmail.trim()}.`);
      await fetchData();
    } catch (err) {
      setAddError(err.message || 'Failed to send invitation');
    } finally {
      setAdding(false);
    }
  };

  const togglePropertyId = (list, setList, pid) => {
    setList(list.includes(pid) ? list.filter((x) => x !== pid) : [...list, pid]);
  };

  const openEdit = (m) => {
    setEditUser(m);
    setEditName(m.name || '');
    setEditEmail(m.email || '');
    setEditRole(m.role);
    setEditPropertyIds((m.propertyAssignments || []).map((a) => a.propertyId));
    setEditError('');
  };

  const handleEditSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setEditError('');
    try {
      await api(`/api/team/${editUser.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editName.trim(),
          role: editRole,
          propertyIds: editPropertyIds,
        }),
      });
      setEditUser(null);
      await fetchData();
    } catch (err) {
      setEditError(err.message || 'Failed to update team member');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    setDeactivating(true);
    try {
      await api(`/api/team/${deactivateTarget.id}`, { method: 'DELETE' });
      setDeactivateTarget(null);
      await fetchData();
    } catch { /* ignore */ }
    finally { setDeactivating(false); }
  };

  const handleResendInvite = async (inv) => {
    try {
      await api(`/api/team/invitations/${inv.id}/resend`, { method: 'POST' });
      setNotification(`Invite re-sent to ${inv.email}.`);
      await fetchData();
    } catch (err) {
      setNotification(err.message || 'Failed to resend invite');
    }
  };

  const handleRevokeConfirm = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await api(`/api/team/invitations/${revokeTarget.id}`, { method: 'DELETE' });
      setRevokeTarget(null);
      setNotification('Invitation revoked.');
      await fetchData();
    } catch (err) {
      setNotification(err.message || 'Failed to revoke invite');
    } finally {
      setRevoking(false);
    }
  };

  const handleReset = async () => {
    if (!resetTarget) return;
    setResetting(true);
    try {
      const d = await api(`/api/team/${resetTarget.id}/reset-password`, { method: 'POST' });
      setResetResult({ user: resetTarget, ...d });
    } catch { /* ignore */ }
    finally { setResetting(false); setResetTarget(null); }
  };

  const copyText = (key, text) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 1500);
  };

  const activeUsers = users.filter((u) => !u.deletedAt);
  const deactivatedUsers = users.filter((u) => u.deletedAt);
  const pendingInvites = invitations;

  if (loading) return <div className="page-loading">Loading team...</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Team</h1>
          <p className="page-subtitle">
            {activeUsers.length} active {activeUsers.length === 1 ? 'member' : 'members'}
            {pendingInvites.length > 0 && ` · ${pendingInvites.length} pending invite${pendingInvites.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {isOwnerOrPM && (
          <button className="btn-primary-sm" onClick={() => { resetAddForm(); setShowAdd(true); }}>
            + Add Team Member
          </button>
        )}
      </div>

      {notification && <div className="notification-bar">{notification}</div>}
      {error && <div className="auth-error">{error}</div>}

      <div className="team-list">
        {activeUsers.length === 0 && pendingInvites.length === 0 ? (
          <div className="empty-state"><p>No team members yet.</p></div>
        ) : (
          <>
            {activeUsers.map((m) => {
              const assignedCount = m.propertyAssignments?.length || 0;
              const roleStr = roleLabel(m.role, m.customRole);
              return (
                <div
                  key={m.id}
                  className="team-row"
                  onClick={() => isOwnerOrPM && openEdit(m)}
                  style={{ cursor: isOwnerOrPM ? 'pointer' : 'default' }}
                >
                  <div className="team-row-left">
                    <div className="team-avatar">
                      {(m.name || m.email || '?').split(' ').map((s) => s[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <div className="team-row-info">
                      <div className="team-row-name">{m.name}</div>
                      <div className="team-row-email">{m.email}</div>
                    </div>
                  </div>
                  <div className="team-row-right">
                    <span className="invite-badge invite-badge-active">Active</span>
                    <span
                      className="team-role-badge"
                      style={{ color: ROLE_COLORS[m.role] || '#8A8583', borderColor: ROLE_COLORS[m.role] || '#D4D0CE' }}
                    >
                      {roleStr}
                    </span>
                    <span className="team-row-props">
                      {m.role === 'OWNER'
                        ? 'All properties'
                        : assignedCount === 0
                          ? 'No properties'
                          : `${assignedCount} propert${assignedCount === 1 ? 'y' : 'ies'}`}
                    </span>
                    {isOwnerOrPM && m.id !== user?.id && m.role !== 'OWNER' && (
                      <div className="team-menu-wrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="team-menu-btn"
                          onClick={() => setMenuOpenFor(menuOpenFor === m.id ? null : m.id)}
                          aria-label="Open menu"
                        >
                          &#8942;
                        </button>
                        {menuOpenFor === m.id && (
                          <MemberMenu
                            member={m}
                            onEdit={openEdit}
                            onReset={(mem) => setResetTarget(mem)}
                            onRemove={(mem) => setDeactivateTarget(mem)}
                            onClose={() => setMenuOpenFor(null)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {pendingInvites.map((inv) => {
              const propCount = (inv.propertyIds || []).length;
              const roleStr = roleLabel(inv.role, inv.customRole);
              return (
                <div key={inv.id} className="team-row team-row-pending">
                  <div className="team-row-left">
                    <div className="team-avatar team-avatar-muted">
                      {(inv.name || inv.email || '?').split(' ').map((s) => s[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <div className="team-row-info">
                      <div className="team-row-name">{inv.name || inv.email}</div>
                      <div className="team-row-email">{inv.email}</div>
                    </div>
                  </div>
                  <div className="team-row-right">
                    <StatusBadge status={inv.status} />
                    <span
                      className="team-role-badge"
                      style={{ color: ROLE_COLORS[inv.role] || '#8A8583', borderColor: ROLE_COLORS[inv.role] || '#D4D0CE' }}
                    >
                      {roleStr}
                    </span>
                    <span className="team-row-props">
                      {propCount === 0
                        ? 'No properties'
                        : `${propCount} propert${propCount === 1 ? 'y' : 'ies'}`}
                    </span>
                    {isOwnerOrPM && (
                      <div className="team-menu-wrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="team-menu-btn"
                          onClick={() => setInviteMenuFor(inviteMenuFor === inv.id ? null : inv.id)}
                          aria-label="Open menu"
                        >
                          &#8942;
                        </button>
                        {inviteMenuFor === inv.id && (
                          <InviteMenu
                            invite={inv}
                            onResend={handleResendInvite}
                            onRevoke={(i) => setRevokeTarget(i)}
                            onClose={() => setInviteMenuFor(null)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {deactivatedUsers.length > 0 && (
        <div className="team-deactivated">
          <button className="btn-text-sm" onClick={() => setShowDeactivated(!showDeactivated)}>
            {showDeactivated ? 'Hide' : 'Show'} deactivated ({deactivatedUsers.length})
          </button>
          {showDeactivated && (
            <div className="team-list team-list-muted">
              {deactivatedUsers.map((m) => (
                <div key={m.id} className="team-row team-row-muted">
                  <div className="team-row-left">
                    <div className="team-avatar team-avatar-muted">
                      {(m.name || '?').split(' ').map((s) => s[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <div className="team-row-info">
                      <div className="team-row-name">{m.name}</div>
                      <div className="team-row-email">{m.email} &middot; removed</div>
                    </div>
                  </div>
                  <span className="team-role-badge" style={{ color: '#8A8583', borderColor: '#D4D0CE' }}>
                    {roleLabel(m.role, m.customRole)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Modal
        open={showAdd}
        onClose={() => { if (!adding) setShowAdd(false); }}
        title="Invite Team Member"
      >
        <form className="modal-form" onSubmit={handleAdd}>
          <label>
            Name
            <input
              type="text"
              className="maint-input"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            Email
            <input
              type="email"
              className="maint-input"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
            />
          </label>
          <label>
            Role
            <select
              className="form-select"
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
            >
              {INVITABLE_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </label>
          <div>
            <div className="form-label-sm">Assign to properties</div>
            {properties.length === 0 ? (
              <p className="empty-text">No properties yet.</p>
            ) : (
              <div className="checkbox-list">
                {properties.map((p) => (
                  <label key={p.id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={addPropertyIds.includes(p.id)}
                      onChange={() => togglePropertyId(addPropertyIds, setAddPropertyIds, p.id)}
                    />
                    <span>{p.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {addError && <div className="auth-error">{addError}</div>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={() => setShowAdd(false)} disabled={adding}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={adding}>
              {adding ? 'Sending...' : 'Send invite'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!editUser}
        onClose={() => { if (!saving) setEditUser(null); }}
        title={editUser ? `Edit ${editUser.name}` : 'Edit'}
      >
        {editUser && (
          <form className="modal-form" onSubmit={handleEditSave}>
            <label>
              Name
              <input
                type="text"
                className="maint-input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                className="maint-input"
                value={editEmail}
                disabled
                title="Email cannot be changed here"
              />
            </label>
            {editUser.role !== 'OWNER' && (
              <label>
                Role
                <select
                  className="form-select"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                >
                  {INVITABLE_ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </label>
            )}
            {editUser.role !== 'OWNER' && (
              <div>
                <div className="form-label-sm">Assign to properties</div>
                {properties.length === 0 ? (
                  <p className="empty-text">No properties yet.</p>
                ) : (
                  <div className="checkbox-list">
                    {properties.map((p) => (
                      <label key={p.id} className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={editPropertyIds.includes(p.id)}
                          onChange={() => togglePropertyId(editPropertyIds, setEditPropertyIds, p.id)}
                        />
                        <span>{p.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            {editError && <div className="auth-error">{editError}</div>}
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setEditUser(null)} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={!!deactivateTarget}
        onClose={() => { if (!deactivating) setDeactivateTarget(null); }}
        title="Remove team member"
      >
        {deactivateTarget && (
          <div className="modal-form">
            <p>
              Remove <strong>{deactivateTarget.name}</strong> ({deactivateTarget.email})?
              They&apos;ll be deactivated, their sessions invalidated, and they won&apos;t be able to sign in.
              Historical inspection / maintenance records stay attributed to them.
            </p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setDeactivateTarget(null)} disabled={deactivating}>
                Cancel
              </button>
              <button className="btn-danger" onClick={handleDeactivate} disabled={deactivating}>
                {deactivating ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!revokeTarget}
        onClose={() => { if (!revoking) setRevokeTarget(null); }}
        title="Revoke invitation"
      >
        {revokeTarget && (
          <div className="modal-form">
            <p>
              Revoke invitation to <strong>{revokeTarget.email}</strong>? They won&apos;t be able to use the invite link anymore.
            </p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setRevokeTarget(null)} disabled={revoking}>
                Cancel
              </button>
              <button className="btn-danger" onClick={handleRevokeConfirm} disabled={revoking}>
                {revoking ? 'Revoking...' : 'Revoke invite'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!resetTarget}
        onClose={() => { if (!resetting) setResetTarget(null); }}
        title="Reset password"
      >
        {resetTarget && (
          <div className="modal-form">
            <p>
              Generate a new password for <strong>{resetTarget.name}</strong>?
              Their current password stops working immediately.
            </p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setResetTarget(null)} disabled={resetting}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleReset} disabled={resetting}>
                {resetting ? 'Resetting...' : 'Reset password'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {resetResult && (
        <Modal open={true} onClose={() => setResetResult(null)} title="New password generated">
          <div className="modal-form">
            <p className="empty-text" style={{ marginTop: 0 }}>
              Share this with <strong>{resetResult.user.name}</strong>. It won&apos;t be shown again.
            </p>
            <div className="cred-row">
              <span className="cred-label">Password</span>
              <code className="cred-value">{resetResult.password}</code>
              <button className="btn-text-sm" onClick={() => copyText('reset-pw', resetResult.password)}>
                {copied === 'reset-pw' ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="modal-actions">
              <button className="btn-primary" onClick={() => setResetResult(null)}>Done</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

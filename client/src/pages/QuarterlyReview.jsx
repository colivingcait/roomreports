import { useState, useEffect, useCallback, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import { roleLabel, PRIORITIES, PRIORITY_COLORS, suggestPriority } from '../../../shared/index.js';
import { useAuth } from '../context/AuthContext';

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

function Lightbox({ url, onClose }) {
  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose}>&times;</button>
      <img src={url} alt="" className="lightbox-image" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

export default function QuarterlyReview() {
  const { propertyId, date } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedRoom, setExpandedRoom] = useState(null);
  const [itemSelections, setItemSelections] = useState({}); // itemId -> { createTask, description, pmNote }
  const [approving, setApproving] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState('');
  const [followUpFor, setFollowUpFor] = useState(null);
  const [reopening, setReopening] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchGroup = useCallback(async () => {
    try {
      const d = await api(`/api/inspections/quarterly-group/${propertyId}/${date}`);
      setData(d);

      // Pre-populate selections: default createTask=true for isMaintenance items
      const sel = {};
      for (const room of d.rooms) {
        for (const item of room.flaggedItems) {
          sel[item.id] = {
            createTask: !!item.isMaintenance,
            createViolation: !!item.isLeaseViolation,
            description: (item.note && item.note.trim()) || item.text,
            pmNote: '',
            priority: item.priority || (item.flagCategory ? suggestPriority(item.flagCategory) : 'Medium'),
          };
        }
      }
      setItemSelections(sel);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId, date]);

  useEffect(() => { fetchGroup(); }, [fetchGroup]);

  const updateSelection = (itemId, updates) => {
    setItemSelections((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], ...updates },
    }));
  };

  const handleApprove = async () => {
    setApproving(true);
    setError('');
    try {
      const ids = data.rooms
        .filter((r) => r.status === 'SUBMITTED')
        .map((r) => r.inspectionId);

      const items = Object.entries(itemSelections).map(([itemId, sel]) => ({
        itemId,
        createTask: sel.createTask,
        createViolation: sel.createViolation,
        description: sel.description,
        pmNote: sel.pmNote,
        priority: sel.priority || null,
      }));

      const result = await api('/api/inspections/bulk-approve', {
        method: 'POST',
        body: JSON.stringify({ ids, items }),
      });

      navigate('/dashboard', {
        state: {
          notification: `Room inspection approved. ${result.maintenanceItemsCreated} maintenance task${result.maintenanceItemsCreated !== 1 ? 's' : ''} created.`,
        },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setApproving(false);
    }
  };

  const handleReopenForEdit = async () => {
    setReopening(true);
    setError('');
    try {
      // Reopen every non-draft room in the batch so the inspector can
      // resume the multi-room flow.
      const ids = data.rooms
        .filter((r) => r.status === 'SUBMITTED' || r.status === 'REVIEWED')
        .map((r) => r.inspectionId);
      for (const roomInspId of ids) {
        await api(`/api/inspections/${roomInspId}/reopen`, { method: 'POST' });
      }
      navigate(`/quarterly/${propertyId}`);
    } catch (err) {
      setError(err.message);
      setReopening(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      const ids = data.rooms.map((r) => r.inspectionId);
      await api('/api/inspections/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      navigate('/dashboard', {
        state: { notification: 'Inspection deleted.' },
      });
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  };

  if (loading) return <div className="page-loading">Loading room inspection...</div>;
  if (!data) return <div className="page-container"><div className="auth-error">{error || 'Not found'}</div></div>;

  const isReviewable = data.status === 'SUBMITTED';
  const isReviewed = data.status === 'REVIEWED';
  const totalTasksToCreate = Object.values(itemSelections).filter((s) => s.createTask).length;

  // Find any partial reasons across rooms
  // Show the Partial banner only when a room is ACTUALLY incomplete
  // by today's rules (Maintenance items unanswered). Inspections
  // submitted under the older "everything required" rule may still
  // carry a stored _PartialReason; those count as complete now and
  // shouldn't keep flashing the banner.
  const partialReasons = data.rooms
    .filter((r) => r.partialReason && r.completedItems < r.totalItems)
    .map((r) => ({ roomLabel: r.roomLabel, reason: r.partialReason }));

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <button className="btn-text-sm" onClick={() => navigate(-1)}>&larr; Back</button>
          <h1 style={{ marginTop: '0.25rem' }}>Room Inspection</h1>
          <p className="page-subtitle">
            {data.property.name} &middot;{' '}
            {new Date(data.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <div className="review-header-right">
          <button
            className="btn-edit-inspection"
            onClick={() => window.open(`/api/inspections/quarterly-group/${propertyId}/${date}/pdf`, '_blank')}
            title="Download PDF"
          >
            Download PDF
          </button>
          <span
            className="insp-status-badge"
            style={{
              color: isReviewed ? '#6B8F71' : '#C4703F',
              borderColor: isReviewed ? '#6B8F71' : '#C4703F',
            }}
          >
            {data.status}
          </span>
        </div>
      </div>

      {data.edits?.length > 0 && (
        <div className="review-edit-note">
          {data.completedAt && (
            <>Originally submitted {new Date(data.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{' · '}</>
          )}
          {data.edits.map((e, i) => (
            <span key={e.id}>
              {i > 0 && ' · '}
              Edited by {e.editorName} on {new Date(e.editedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          ))}
        </div>
      )}

      {/* Aggregated summary */}
      <div className="review-summary">
        <div className="review-summary-row">
          <span className="review-label">Inspector</span>
          <span className="review-value">{data.inspector?.name} ({roleLabel(data.inspector?.role, data.inspector?.customRole)})</span>
        </div>
        <div className="review-summary-row">
          <span className="review-label">Rooms</span>
          <span className="review-value">{data.totalRooms} inspected &middot; {data.totalItems} items checked</span>
        </div>
        <div className="review-summary-row">
          <span className="review-label">Issues</span>
          <span className="review-value">
            {data.totalFlags === 0
              ? <span style={{ color: '#6B8F71', fontWeight: 600 }}>No issues found</span>
              : <span className="review-flag-count">&#9873; {data.totalFlags} flagged across all rooms</span>}
          </span>
        </div>
      </div>

      {/* Partial submission banner */}
      {partialReasons.length > 0 && (
        <div className="partial-banner">
          <div className="partial-banner-title">
            &#9888; Partial Inspection &mdash; some rooms not fully completed
          </div>
          {partialReasons.map((p, i) => (
            <div key={i} className="partial-banner-reason">
              <span className="partial-banner-label">{p.roomLabel}:</span> {p.reason}
            </div>
          ))}
        </div>
      )}

      {/* Room list */}
      <h3 className="review-section-title">Rooms ({data.rooms.length})</h3>
      <div className="qr-room-list">
        {data.rooms.map((room) => {
          const isExpanded = expandedRoom === room.roomId;
          // Three states: fully complete, partial (some but not all), or
          // truly skipped (zero items answered). Partial rooms still
          // deserve a flag count badge alongside — the inspector
          // captured real issues before stopping.
          const isSkipped = room.completedItems === 0;
          const isPartial = room.completedItems > 0 && room.completedItems < room.totalItems;

          return (
            <Fragment key={room.roomId}>
              <div
                className={`qr-room-row ${isExpanded ? 'expanded' : ''}`}
                onClick={() => setExpandedRoom(isExpanded ? null : room.roomId)}
              >
                <div className="qr-room-row-left">
                  <span className={`chevron ${isExpanded ? 'open' : ''}`}>&#9656;</span>
                  <div className="qr-room-info">
                    <span className="qr-room-label">{room.roomLabel}</span>
                    <span className="qr-room-meta">
                      {room.completedItems}/{room.totalItems} items
                      {room.flagCount > 0 && (
                        <span className="qr-room-flags"> &middot; <span style={{ color: '#C0392B' }}>&#9873; {room.flagCount}</span></span>
                      )}
                    </span>
                  </div>
                </div>
                <div className="qr-room-row-right">
                  {isSkipped && (
                    <span className="qr-room-badge qr-room-badge-skipped">Skipped</span>
                  )}
                  {isPartial && (
                    <span className="qr-room-badge qr-room-badge-partial">Partial</span>
                  )}
                  {room.flagCount > 0 && (
                    <span className="qr-room-badge qr-room-badge-flagged">
                      {room.flagCount} flag{room.flagCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {!isSkipped && !isPartial && room.flagCount === 0 && (
                    <span className="qr-room-badge qr-room-badge-clean">&#10003; Clean</span>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div className="qr-room-expanded">
                  {room.flaggedItems.length === 0 ? (
                    <p className="po-expanded-empty">&#10003; No issues found in this room</p>
                  ) : (
                    room.flaggedItems.map((item) => {
                      const sel = itemSelections[item.id] || {
                        createTask: false, createViolation: false,
                        description: (item.note && item.note.trim()) || item.text, pmNote: '',
                        priority: item.priority || (item.flagCategory ? suggestPriority(item.flagCategory) : 'Medium'),
                      };
                      const effectivePriority = sel.priority || 'Medium';
                      return (
                        <div key={item.id} className="qr-item">
                          <div className="qr-item-head">
                            <div className="qr-item-text">{item.text}</div>
                            <div className="review-item-badges">
                              {item.status && (
                                <span className="review-status-badge" style={{ color: '#C53030', borderColor: '#F5C6C6' }}>
                                  {item.status}
                                </span>
                              )}
                              {item.flagCategory && (
                                <span className="review-cat-badge">{item.flagCategory}</span>
                              )}
                              <span
                                className="maint-priority-tag"
                                style={{
                                  color: PRIORITY_COLORS[effectivePriority],
                                  borderColor: PRIORITY_COLORS[effectivePriority],
                                }}
                              >
                                {effectivePriority}
                              </span>
                              {item.isLeaseViolation && (
                                <span className="review-cat-badge" style={{ background: '#F5E8F0', color: '#8A2B6D', borderColor: '#8A2B6D' }}>
                                  Lease violation
                                </span>
                              )}
                            </div>
                          </div>

                          {item.note && (
                            <div className="review-item-note">
                              <span className="review-note-label">Inspector note:</span> {item.note}
                            </div>
                          )}

                          {item.photos?.length > 0 && (
                            <div className="review-photos">
                              {item.photos.map((p) => (
                                <button key={p.id} type="button" className="review-photo-thumb" onClick={() => setLightboxUrl(p.url)}>
                                  <img src={p.url} alt="" />
                                </button>
                              ))}
                            </div>
                          )}

                          {isReviewable && (
                            <div className="review-task-box">
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                                <label className="review-task-toggle">
                                  <input
                                    type="checkbox"
                                    checked={sel.createTask}
                                    onChange={(e) => updateSelection(item.id, { createTask: e.target.checked })}
                                  />
                                  <span>Create maintenance task</span>
                                </label>
                                <label className="review-task-toggle">
                                  <input
                                    type="checkbox"
                                    checked={sel.createViolation}
                                    onChange={(e) => updateSelection(item.id, { createViolation: e.target.checked })}
                                  />
                                  <span>Record lease violation</span>
                                </label>
                              </div>

                              {sel.createViolation && (
                                <button
                                  type="button"
                                  className="review-followup-btn"
                                  onClick={() => setFollowUpFor({
                                    inspectionId: room.inspectionId,
                                    inspectionItemId: item.id,
                                    violationDescription: item.text,
                                    violationCategory: item.flagCategory || 'Lease Compliance',
                                    note: item.note || '',
                                    roomLabel: room.roomLabel,
                                    completedAt: room.completedAt,
                                  })}
                                >
                                  + Create follow-up ticket
                                </button>
                              )}
                              {sel.createTask && (
                                <div className="review-task-fields">
                                  <label className="review-field-label">
                                    Task description
                                    <input
                                      type="text"
                                      className="maint-input"
                                      value={sel.description}
                                      onChange={(e) => updateSelection(item.id, { description: e.target.value })}
                                    />
                                  </label>
                                  <label className="review-field-label">
                                    Priority
                                    <select
                                      className="form-select"
                                      value={sel.priority}
                                      onChange={(e) => updateSelection(item.id, { priority: e.target.value })}
                                      style={{
                                        color: PRIORITY_COLORS[sel.priority],
                                        borderColor: PRIORITY_COLORS[sel.priority],
                                      }}
                                    >
                                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                                    </select>
                                  </label>
                                  <label className="review-field-label">
                                    PM notes <span className="form-optional">(optional)</span>
                                    <input
                                      type="text"
                                      className="maint-input"
                                      placeholder="Instructions for the maintenance team..."
                                      value={sel.pmNote}
                                      onChange={(e) => updateSelection(item.id, { pmNote: e.target.value })}
                                    />
                                  </label>
                                </div>
                              )}
                            </div>
                          )}

                          {isReviewed && item.isMaintenance && (
                            <div className="review-task-done">
                              <span>&#10003; Maintenance task created</span>
                            </div>
                          )}
                          {isReviewed && item.isLeaseViolation && (
                            <div className="review-task-done" style={{ color: '#8A2B6D' }}>
                              <span>&#10003; Lease violation recorded</span>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      {/* Quick common area check (shared across the batch) */}
      {Array.isArray(data.commonAreaQuick) && data.commonAreaQuick.length > 0 && (
        <div className="qr-common-section">
          <h3 className="qr-common-title">Common Area Quick Check</h3>
          {['Kitchen', 'Bathroom'].map((kind) => {
            const rows = data.commonAreaQuick.filter((c) => c.kind === kind);
            if (rows.length === 0) return null;
            return (
              <div key={kind} className="qr-common-group">
                <h4 className="qr-common-subtitle">{kind}s</h4>
                {rows.map((r) => (
                  <div
                    key={r.id}
                    className={`qr-common-row qr-common-row-${r.status || 'empty'}`}
                  >
                    <div className="qr-common-main">
                      <span className="qr-common-label">{r.label}</span>
                      <span className={`qr-common-status qr-common-status-${r.status || 'empty'}`}>
                        {r.status === 'Pass' ? 'Pass \u2713'
                          : r.status === 'Fail' ? 'Fail \u2715'
                          : 'Not checked'}
                      </span>
                    </div>
                    {r.status === 'Fail' && (r.note || r.flagCategory || r.photos?.length) && (
                      <div className="qr-common-detail">
                        {r.flagCategory && <span className="qr-common-cat">{r.flagCategory}</span>}
                        {r.note && <p className="qr-common-note">{r.note}</p>}
                        {r.photos?.length > 0 && (
                          <div className="qr-common-photos">
                            {r.photos.map((p) => (
                              <button
                                key={p.id}
                                className="qr-common-photo"
                                onClick={() => setLightboxUrl(p.url)}
                              >
                                <img src={p.url} alt="" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {error && <div className="auth-error" style={{ marginTop: '1rem' }}>{error}</div>}

      {/* Approve footer */}
      {isReviewable && (
        <div className="review-footer">
          <p className="review-footer-summary">
            {totalTasksToCreate} maintenance task{totalTasksToCreate !== 1 ? 's' : ''} will be created across all rooms
          </p>
          <div className="review-footer-actions">
            <button className="btn-finish" onClick={handleApprove} disabled={approving}>
              {approving ? 'Approving...' : 'Approve Report'}
            </button>
          </div>
        </div>
      )}

      {/* Edit / Delete bar — OWNER/PM only */}
      {(user?.role === 'OWNER' || user?.role === 'PM') && (
        <div className="review-edit-delete-bar">
          <button
            className="btn-edit-outline"
            onClick={handleReopenForEdit}
            disabled={reopening || deleting}
          >
            {reopening ? 'Opening...' : 'Edit Inspection'}
          </button>
          <button
            className="btn-delete-outline"
            onClick={() => setShowDelete(true)}
            disabled={reopening || deleting}
          >
            Delete Inspection
          </button>
        </div>
      )}

      <ConfirmDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        title="Delete Inspection"
        message="Are you sure you want to delete this inspection? Any maintenance tickets and lease violations created from this inspection will also be removed."
        confirmLabel="Delete"
        loading={deleting}
      />

      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl('')} />}

      {followUpFor && (
        <FollowUpModal
          spec={followUpFor}
          onClose={() => setFollowUpFor(null)}
          onCreated={() => setFollowUpFor(null)}
        />
      )}
    </div>
  );
}

function FollowUpModal({ spec, onClose, onCreated }) {
  const defaultDue = new Date();
  defaultDue.setDate(defaultDue.getDate() + 7);
  const defaultDueIso = defaultDue.toISOString().slice(0, 10);

  const [title, setTitle] = useState(
    `Follow-up: ${spec.violationDescription}${spec.roomLabel ? ` — ${spec.roomLabel}` : ''}`,
  );
  const [priority, setPriority] = useState('Medium');
  const [dueAt, setDueAt] = useState(defaultDueIso);
  const [note, setNote] = useState(
    `Lease violation recorded${spec.completedAt ? ` on ${new Date(spec.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}. Follow up to ensure compliance.`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(
        `/api/inspections/${spec.inspectionId}/items/${spec.inspectionItemId}/follow-up`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), priority, dueAt, note }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to create follow-up');
      onCreated?.(body.item);
    } catch (e) {
      setError(e.message || 'Failed to create follow-up');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Create lease follow-up</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-form">
          <label>
            Title
            <input
              type="text"
              className="maint-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            Priority
            <select className="form-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </label>
          <label>
            Due date
            <input
              type="date"
              className="maint-input"
              value={dueAt}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </label>
          <label>
            Notes
            <textarea
              className="detail-textarea"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {error && <div className="auth-error">{error}</div>}
          <div className="modal-actions">
            <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={handleCreate} disabled={busy || !title.trim()}>
              {busy ? 'Creating…' : 'Create follow-up'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

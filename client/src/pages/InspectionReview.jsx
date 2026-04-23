import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { roleLabel, PRIORITIES, PRIORITY_COLORS, suggestPriority } from '../../../shared/index.js';
import { useAuth } from '../context/AuthContext';
import ConfirmDialog from '../components/ConfirmDialog';

const TYPE_LABELS = {
  COMMON_AREA: 'Common Area', COMMON_AREA_QUICK: 'Common Area Quick Check',
  ROOM_TURN: 'Room Turn', QUARTERLY: 'Room Inspection',
  RESIDENT_SELF_CHECK: 'Self-Check', MOVE_IN_OUT: 'Move-In',
};

const STATUS_COLORS = { DRAFT: '#C4703F', SUBMITTED: '#C4703F', REVIEWED: '#6B8F71' };

const BAD_STATUSES = new Set([
  'Fail', 'Poor', 'Dirty', 'No', 'Missing', 'Damaged', 'Heavily Damaged',
  'Needs Help', 'Could Use Attention', 'I See a Problem', 'Needs Cleaning',
  'Something\u2019s Broken', 'Issue to Report', 'Wear or Damage',
  'Marks or Damage', 'Yes', 'Yes \u2014 Let me tell you',
]);

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

export default function InspectionReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [inspection, setInspection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [error, setError] = useState('');
  const [itemState, setItemState] = useState({}); // itemId -> { createTask, description, pmNote }
  const [sendBackReason, setSendBackReason] = useState('');
  const [showSendBack, setShowSendBack] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchInspection = useCallback(async () => {
    try {
      const data = await api(`/api/inspections/${id}`);
      setInspection(data.inspection);

      // Initialize item state: default createTask=true for isMaintenance items
      const state = {};
      for (const item of data.inspection.items || []) {
        if (item.flagCategory || item.isMaintenance || item.isLeaseViolation) {
          state[item.id] = {
            createTask: !!item.isMaintenance,
            createViolation: !!item.isLeaseViolation,
            description: (item.note && item.note.trim()) || item.text,
            pmNote: '',
            priority: item.priority || (item.flagCategory ? suggestPriority(item.flagCategory) : 'Medium'),
          };
        }
      }
      setItemState(state);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchInspection(); }, [fetchInspection]);

  const updateItemState = (itemId, updates) => {
    setItemState((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], ...updates },
    }));
  };

  const handleApprove = async () => {
    setApproving(true);
    setError('');
    try {
      const items = Object.entries(itemState).map(([itemId, state]) => ({
        itemId,
        createTask: state.createTask,
        createViolation: state.createViolation,
        description: state.description,
        pmNote: state.pmNote,
        priority: state.priority || null,
      }));

      const data = await api(`/api/inspections/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ items }),
      });

      const count = data.maintenanceItemsCreated;
      navigate('/dashboard', {
        state: {
          notification: count > 0
            ? `Report approved. ${count} maintenance task${count !== 1 ? 's' : ''} created.`
            : 'Report approved.',
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
      await api(`/api/inspections/${id}/reopen`, { method: 'POST' });
      if (inspection.type === 'QUARTERLY' && inspection.property?.id) {
        navigate(`/quarterly/${inspection.property.id}`);
      } else if (inspection.type === 'COMMON_AREA_QUICK') {
        // Reopened quick-check — send them back to the quarterly flow root for that property
        navigate(`/quarterly/${inspection.property.id}`);
      } else if (inspection.type === 'COMMON_AREA' && inspection.id) {
        navigate(`/common-area/${inspection.id}`);
      } else if (inspection.type === 'ROOM_TURN' && inspection.id) {
        navigate(`/room-turn/${inspection.id}`);
      } else {
        navigate(`/inspections/${id}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setReopening(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError('');
    try {
      await api(`/api/inspections/${id}`, { method: 'DELETE' });
      navigate('/dashboard', {
        state: { notification: 'Inspection deleted.' },
      });
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  };

  const handleSendBack = async () => {
    setSendingBack(true);
    setError('');
    try {
      await api(`/api/inspections/${id}/send-back`, {
        method: 'POST',
        body: JSON.stringify({ reason: sendBackReason }),
      });
      navigate('/dashboard', {
        state: { notification: 'Inspection sent back to inspector for revision.' },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingBack(false);
    }
  };

  if (loading) return <div className="page-loading">Loading inspection...</div>;
  if (!inspection) {
    return (
      <div className="page-container">
        <div className="auth-error">{error || 'Inspection not found'}</div>
      </div>
    );
  }

  const isDraft = inspection.status === 'DRAFT';
  const isSubmitted = inspection.status === 'SUBMITTED';
  const isReviewed = inspection.status === 'REVIEWED';

  // Detect partial submission
  const partialItem = inspection.items?.find((i) => i.zone === '_PartialReason');
  const partialReason = partialItem?.note || null;
  const incompleteItems = (inspection.items || []).filter(
    (i) => !i.zone.startsWith('_') && !i.status && !(Array.isArray(i.options) && i.options.includes('_section')),
  );

  // Only display items with flags or marked for maintenance (filter out metadata zones)
  const flaggedItems = (inspection.items || []).filter(
    (i) => !i.zone.startsWith('_') && (i.flagCategory || i.isMaintenance || BAD_STATUSES.has(i.status)),
  );

  // Group by zone
  const zones = [];
  const zoneMap = {};
  for (const item of flaggedItems) {
    if (!zoneMap[item.zone]) {
      zoneMap[item.zone] = [];
      zones.push(item.zone);
    }
    zoneMap[item.zone].push(item);
  }

  const tasksToCreate = Object.values(itemState).filter((s) => s.createTask).length;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <button className="btn-text-sm" onClick={() => navigate(-1)}>&larr; Back</button>
          <h1 style={{ marginTop: '0.25rem' }}>
            {isSubmitted ? 'Review Inspection' : isReviewed ? 'Inspection Report' : 'Inspection'}
          </h1>
          <p className="page-subtitle">
            {TYPE_LABELS[inspection.type] || inspection.type}
            {' \u2014 '}
            {inspection.property?.name}
            {inspection.room ? ` / ${inspection.room.label}` : ''}
          </p>
        </div>
        <div className="review-header-right">
          {(isSubmitted || isReviewed) && (
            <button
              className="btn-edit-inspection"
              onClick={() => window.open(`/api/inspections/${id}/pdf`, '_blank')}
              title="Download PDF"
            >
              Download PDF
            </button>
          )}
          <span
            className="insp-status-badge"
            style={{ color: STATUS_COLORS[inspection.status], borderColor: STATUS_COLORS[inspection.status] }}
          >
            {inspection.status}
          </span>
        </div>
      </div>
      {(inspection.edits?.length > 0 || (inspection.editCount > 0 && inspection.editedAt)) && (
        <div className="review-edit-note">
          {inspection.completedAt && (
            <>Originally submitted {new Date(inspection.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{' · '}</>
          )}
          {inspection.edits?.length > 0
            ? inspection.edits.map((e, i) => (
                <span key={e.id}>
                  {i > 0 && ' · '}
                  Edited by {e.editorName} on {new Date(e.editedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              ))
            : (
              <span>
                Edited on {new Date(inspection.editedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                {inspection.editCount > 1 ? ` (${inspection.editCount} edits)` : ''}
              </span>
            )}
        </div>
      )}

      {/* Summary */}
      {/* Partial submission banner */}
      {partialReason && (
        <div className="partial-banner">
          <div className="partial-banner-title">
            &#9888; Partial Inspection
            {incompleteItems.length > 0 && ` \u2014 ${incompleteItems.length} item${incompleteItems.length !== 1 ? 's' : ''} not completed`}
          </div>
          <div className="partial-banner-reason">
            <span className="partial-banner-label">Reason:</span> {partialReason}
          </div>
        </div>
      )}

      <div className="review-summary">
        <div className="review-summary-row">
          <span className="review-label">Inspector</span>
          <span className="review-value">
            {inspection.inspector?.name} ({roleLabel(inspection.inspector?.role, inspection.inspector?.customRole)})
          </span>
        </div>
        <div className="review-summary-row">
          <span className="review-label">
            {isReviewed ? 'Approved' : 'Submitted'}
          </span>
          <span className="review-value">
            {inspection.completedAt
              ? new Date(inspection.completedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
              : '\u2014'}
          </span>
        </div>
        <div className="review-summary-row">
          <span className="review-label">Issues</span>
          <span className="review-value">
            {flaggedItems.length === 0 ? (
              <span style={{ color: '#6B8F71', fontWeight: 600 }}>No issues found</span>
            ) : (
              <>
                <span className="review-flag-count">&#9873; {flaggedItems.length} flagged</span>
              </>
            )}
          </span>
        </div>
      </div>

      {isDraft && (
        <div className="auth-error">
          This inspection is still a DRAFT and cannot be reviewed yet.
        </div>
      )}

      {/* No issues case */}
      {flaggedItems.length === 0 ? (
        <div className="empty-state" style={{ padding: '2rem 1rem' }}>
          <p style={{ fontSize: '1.1rem', color: '#6B8F71', fontWeight: 600 }}>
            No issues found &mdash; clean inspection &#10003;
          </p>
          {isSubmitted && (
            <button
              className="btn-finish"
              style={{ marginTop: '1rem', maxWidth: '280px' }}
              onClick={handleApprove}
              disabled={approving}
            >
              {approving ? 'Approving...' : 'Approve Report'}
            </button>
          )}
        </div>
      ) : (
        <>
          <h3 className="review-section-title">Flagged Items ({flaggedItems.length})</h3>
          <div className="review-items">
            {zones.map((zone) => (
              <div key={zone} className="review-zone">
                <h4 className="review-zone-name">{zone}</h4>
                {zoneMap[zone].map((item) => {
                  const state = itemState[item.id] || {
                    createTask: false,
                    createViolation: false,
                    description: (item.note && item.note.trim()) || item.text,
                    pmNote: '',
                    priority: item.priority || (item.flagCategory ? suggestPriority(item.flagCategory) : 'Medium'),
                  };
                  const effectivePriority = state.priority || 'Medium';
                  return (
                    <div key={item.id} className="review-item">
                      <div className="review-item-head">
                        <div className="review-item-text">{item.text}</div>
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
                            <button
                              key={p.id}
                              type="button"
                              className="review-photo-thumb"
                              onClick={() => setLightboxUrl(p.url)}
                            >
                              <img src={p.url} alt="" />
                            </button>
                          ))}
                        </div>
                      )}

                      {isSubmitted && (
                        <div className="review-task-box">
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                            <label className="review-task-toggle">
                              <input
                                type="checkbox"
                                checked={state.createTask}
                                onChange={(e) => updateItemState(item.id, { createTask: e.target.checked })}
                              />
                              <span>Create maintenance task</span>
                            </label>
                            <label className="review-task-toggle">
                              <input
                                type="checkbox"
                                checked={state.createViolation}
                                onChange={(e) => updateItemState(item.id, { createViolation: e.target.checked })}
                              />
                              <span>Record lease violation</span>
                            </label>
                          </div>

                          {state.createTask && (
                            <div className="review-task-fields">
                              <label className="review-field-label">
                                Task description
                                <input
                                  type="text"
                                  className="maint-input"
                                  value={state.description}
                                  onChange={(e) => updateItemState(item.id, { description: e.target.value })}
                                />
                              </label>
                              <label className="review-field-label">
                                Priority
                                <select
                                  className="form-select"
                                  value={state.priority}
                                  onChange={(e) => updateItemState(item.id, { priority: e.target.value })}
                                  style={{
                                    color: PRIORITY_COLORS[state.priority],
                                    borderColor: PRIORITY_COLORS[state.priority],
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
                                  value={state.pmNote}
                                  onChange={(e) => updateItemState(item.id, { pmNote: e.target.value })}
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
                })}
              </div>
            ))}
          </div>
        </>
      )}

      {error && <div className="auth-error" style={{ marginTop: '1rem' }}>{error}</div>}

      {/* Send-back form */}
      {isSubmitted && showSendBack && (
        <div className="send-back-box">
          <h4>Send back to inspector</h4>
          <p className="send-back-help">
            Let the inspector know what to revise. Their inspection will go back to DRAFT status.
          </p>
          <textarea
            className="detail-textarea"
            value={sendBackReason}
            onChange={(e) => setSendBackReason(e.target.value)}
            placeholder="e.g. Please add photos for the bathroom items and add notes on the broken outlet..."
            rows={3}
          />
          <div className="send-back-actions">
            <button className="btn-secondary" onClick={() => { setShowSendBack(false); setSendBackReason(''); }}>
              Cancel
            </button>
            <button className="btn-danger" onClick={handleSendBack} disabled={sendingBack}>
              {sendingBack ? 'Sending...' : 'Send Back'}
            </button>
          </div>
        </div>
      )}

      {/* Action footer (SUBMITTED only) */}
      {isSubmitted && !showSendBack && flaggedItems.length > 0 && (
        <div className="review-footer">
          <p className="review-footer-summary">
            {tasksToCreate} maintenance task{tasksToCreate !== 1 ? 's' : ''} will be created
          </p>
          <div className="review-footer-actions">
            <button className="btn-secondary" onClick={() => setShowSendBack(true)}>
              Send Back
            </button>
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
    </div>
  );
}

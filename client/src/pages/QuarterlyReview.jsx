import { useState, useEffect, useCallback, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import { roleLabel, PRIORITIES, PRIORITY_COLORS, suggestPriority } from '../../../shared/index.js';

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
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedRoom, setExpandedRoom] = useState(null);
  const [itemSelections, setItemSelections] = useState({}); // itemId -> { createTask, description, pmNote }
  const [approving, setApproving] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState('');

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

  if (loading) return <div className="page-loading">Loading room inspection...</div>;
  if (!data) return <div className="page-container"><div className="auth-error">{error || 'Not found'}</div></div>;

  const isReviewable = data.status === 'SUBMITTED';
  const isReviewed = data.status === 'REVIEWED';
  const totalTasksToCreate = Object.values(itemSelections).filter((s) => s.createTask).length;

  // Find any partial reasons across rooms
  const partialReasons = data.rooms
    .filter((r) => r.partialReason)
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
          const isSkipped = room.completedItems < room.totalItems;

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
                  {isSkipped ? (
                    <span className="qr-room-badge qr-room-badge-skipped">Skipped</span>
                  ) : room.flagCount > 0 ? (
                    <span className="qr-room-badge qr-room-badge-flagged">{room.flagCount} flag{room.flagCount !== 1 ? 's' : ''}</span>
                  ) : (
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

      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl('')} />}
    </div>
  );
}

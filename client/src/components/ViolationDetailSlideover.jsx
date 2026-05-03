import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import LogWarningModal from './LogWarningModal';
import AddNoteModal from './AddNoteModal';
import ResolveViolationModal from './ResolveViolationModal';

const ESCALATION_LABELS = {
  FLAGGED: 'Flagged',
  FIRST_WARNING: '1st Warning',
  SECOND_WARNING: '2nd Warning',
  FINAL_NOTICE: 'Final Notice',
  RESOLVED: 'Resolved',
};

// Match the maintenance status badge colors so violations don't introduce a
// new palette. These are the same hues used for STATUS_COLORS in
// MaintenanceDetailModal.
const ESCALATION_COLORS = {
  FLAGGED:        '#8A8580',
  FIRST_WARNING:  '#BA7517',
  SECOND_WARNING: '#C0392B',
  FINAL_NOTICE:   '#A02420',
  RESOLVED:       '#2F7A48',
};

const ACTION_LABELS = {
  FLAGGED: 'Flagged',
  FIRST_WARNING: '1st Warning issued',
  SECOND_WARNING: '2nd Warning issued',
  FINAL_NOTICE: 'Final Notice issued',
  RESOLVED: 'Resolved',
  NOTE: 'Note',
};

const METHOD_LABELS = {
  VERBAL: 'Verbal',
  TEXT: 'Text',
  EMAIL: 'Email',
  POSTED_NOTICE: 'Posted notice',
  PADSPLIT_MESSAGE: 'PadSplit message',
  OTHER: 'Other',
};

const INSPECTION_TYPE_LABELS = {
  COMMON_AREA: 'Common Area',
  COMMON_AREA_QUICK: 'Common Area Quick Check',
  ROOM_TURN: 'Room Turn',
  QUARTERLY: 'Room Inspection',
  RESIDENT_SELF_CHECK: 'Self-Check',
  MOVE_IN_OUT: 'Move-In',
};

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function EscalationBadge({ level, resolved }) {
  const key = resolved ? 'RESOLVED' : (level || 'FLAGGED');
  const color = ESCALATION_COLORS[key] || ESCALATION_COLORS.FLAGGED;
  return (
    <span
      className="md-modal-badge"
      style={{ color, borderColor: color }}
    >
      {ESCALATION_LABELS[key] || key}
    </span>
  );
}

function Lightbox({ url, onClose }) {
  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose}>&times;</button>
      <img src={url} alt="" className="lightbox-image" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

export default function ViolationDetailSlideover({ violationId, onClose, onUpdated }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState('');
  const [showLogWarning, setShowLogWarning] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [showResolve, setShowResolve] = useState(false);
  const [unresolving, setUnresolving] = useState(false);

  const load = useCallback(async () => {
    if (!violationId) return;
    setLoading(true);
    setError('');
    try {
      const d = await api(`/api/violations/${violationId}`);
      setData(d.violation);
    } catch (err) {
      setError(err.message || 'Could not load violation');
    } finally {
      setLoading(false);
    }
  }, [violationId]);

  useEffect(() => { load(); }, [load]);

  const handleUnresolve = async () => {
    setUnresolving(true);
    try {
      await api(`/api/violations/${violationId}/unresolve`, { method: 'POST' });
      await load();
      onUpdated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setUnresolving(false);
    }
  };

  const goToInspection = () => {
    const insp = data?.sourceInspection;
    if (!insp) return;
    if (insp.type === 'QUARTERLY') {
      const dateKey = new Date(insp.createdAt).toISOString().slice(0, 10);
      navigate(`/quarterly-review/${data.property?.id}/${dateKey}`);
    } else {
      navigate(`/inspections/${insp.id}/review`);
    }
    onClose?.();
  };

  if (!violationId) return null;

  const v = data;
  const isResolved = !!v?.resolvedAt;
  const escKey = isResolved ? 'RESOLVED' : (v?.escalationLevel || 'FLAGGED');
  const escColor = ESCALATION_COLORS[escKey];
  const residentTotal = v?.residentViolations?.length || 0;
  const residentActive = v?.residentViolations?.filter((rv) => !rv.resolvedAt).length || 0;

  return (
    <>
      <div className="slideover-backdrop" onClick={onClose} />
      <aside className="slideover">
        <div className="slideover-header">
          <h2>Lease Violation</h2>
          <div className="slideover-header-actions">
            {v && (
              <a
                href={`/api/violations/${v.id}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary"
              >
                Download PDF
              </a>
            )}
            <button type="button" className="slideover-close" onClick={onClose} aria-label="Close">&times;</button>
          </div>
        </div>

        {loading ? (
          <div className="slideover-body"><p className="page-loading">Loading...</p></div>
        ) : error ? (
          <div className="slideover-body"><div className="auth-error">{error}</div></div>
        ) : !v ? null : (
          <div className="slideover-body">
            {/* ── Title + badge ── */}
            <div className="md-title">
              <div className="md-title-input" style={{ fontWeight: 600, padding: '0.4rem 0' }}>
                {v.typeLabel || v.category || 'Lease violation'}
              </div>
            </div>

            <div className="md-badges">
              <EscalationBadge level={v.escalationLevel} resolved={isResolved} />
              {v.isRepeat && (
                <span
                  className="md-modal-badge"
                  style={{ color: '#BA7517', borderColor: '#BA7517' }}
                >
                  Repeat
                </span>
              )}
            </div>

            {/* ── Resolution banner ── */}
            {isResolved && (
              <section className="md-section" style={{ background: '#F5F8F5', border: '1px solid #D5E2D7', borderRadius: 6, padding: '0.6rem 0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13 }}>
                    <strong style={{ color: ESCALATION_COLORS.RESOLVED }}>Resolved</strong>
                    {' on '}{fmtDate(v.resolvedAt)}
                    {v.resolvedType && <> · {v.resolvedType.replace(/_/g, ' ').toLowerCase()}</>}
                  </div>
                  <button
                    type="button"
                    className="btn-text-sm"
                    onClick={handleUnresolve}
                    disabled={unresolving}
                  >
                    {unresolving ? 'Reopening...' : 'Reopen'}
                  </button>
                </div>
                {v.resolvedNote && (
                  <p style={{ margin: '0.4rem 0 0', fontSize: 13, color: '#4A4543' }}>{v.resolvedNote}</p>
                )}
              </section>
            )}

            {/* ── Action buttons ── */}
            {!isResolved && (
              <div className="md-defer-actions" style={{ marginTop: '0.75rem' }}>
                <button type="button" className="btn-primary-sm" onClick={() => setShowLogWarning(true)}>
                  Log Warning
                </button>
                <button type="button" className="btn-secondary-sm" onClick={() => setShowAddNote(true)}>
                  Add Note
                </button>
                <button type="button" className="btn-secondary-sm" onClick={() => setShowResolve(true)}>
                  Resolve
                </button>
              </div>
            )}

            {/* ── Metadata ── */}
            <section className="md-section">
              <dl className="md-dl">
                <dt>Property</dt>
                <dd>
                  {v.property?.name || '—'}
                  {v.room?.label ? ` / ${v.room.label}` : ' / Property-wide'}
                </dd>

                <dt>Resident</dt>
                <dd>{v.residentName || <span className="md-dim">—</span>}</dd>

                <dt>Flagged</dt>
                <dd>
                  {fmtDateTime(v.createdAt)}
                  {v.reportedByName && ` · ${v.reportedByName}`}
                </dd>

                {v.sourceInspection && (
                  <>
                    <dt>Source inspection</dt>
                    <dd>
                      <button className="btn-text-sm" onClick={goToInspection}>
                        {INSPECTION_TYPE_LABELS[v.sourceInspection.type] || v.sourceInspection.type}
                        {' on '}{fmtDate(v.sourceInspection.completedAt || v.sourceInspection.createdAt)} →
                      </button>
                    </dd>
                  </>
                )}
              </dl>
            </section>

            {/* ── Resident history alert ── */}
            {residentTotal > 0 && (
              <section className="md-section" style={{ background: '#FAF7F2', border: '1px solid #E8E4E1', borderRadius: 6, padding: '0.6rem 0.75rem' }}>
                <div style={{ fontSize: 13, color: '#4A4543' }}>
                  This resident has <strong>{residentTotal}</strong> other violation
                  {residentTotal !== 1 ? 's' : ''}
                  {residentActive > 0 && ` (${residentActive} active)`}.
                </div>
              </section>
            )}

            {/* ── Description / observation ── */}
            {(v.description || v.otherDescription) && (
              <section className="md-section">
                <h3 className="md-section-title">Description</h3>
                <p className="md-modal-text">{v.description || v.otherDescription}</p>
              </section>
            )}

            {/* ── Source-inspection photos ── */}
            {v.sourceItem?.photos?.length > 0 && (
              <section className="md-section">
                <h3 className="md-section-title">Inspection photos</h3>
                <div className="review-photos">
                  {v.sourceItem.photos.map((p) => (
                    <button key={p.id} type="button" className="review-photo-thumb" onClick={() => setLightboxUrl(p.url)}>
                      <img src={p.url} alt="" />
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* ── Timeline ── */}
            <section className="md-section">
              <h3 className="md-section-title">Timeline</h3>
              {(!v.timelineEntries || v.timelineEntries.length === 0) ? (
                <p className="empty-text">No entries yet.</p>
              ) : (
                <ol className="md-timeline">
                  {v.timelineEntries.map((entry) => (
                    <li key={entry.id}>
                      <span
                        className="md-timeline-dot"
                        style={{ background: ESCALATION_COLORS[entry.actionType] || '#8A8580' }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="md-timeline-head">
                          <strong>{ACTION_LABELS[entry.actionType] || entry.actionType}</strong>
                          {entry.method && (
                            <span className="md-role-badge"> {METHOD_LABELS[entry.method] || entry.method}</span>
                          )}
                        </div>
                        <div className="md-dim" style={{ fontSize: 12 }}>
                          {fmtDateTime(entry.date)}
                          {entry.loggedByName ? ` · ${entry.loggedByName}` : ''}
                        </div>
                        {entry.notes && (
                          <div className="md-timeline-note">{entry.notes}</div>
                        )}
                        {entry.photos?.length > 0 && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                            {entry.photos.map((ph) => (
                              <button
                                key={ph.id}
                                type="button"
                                className="md-modal-photo"
                                onClick={() => setLightboxUrl(ph.url)}
                              >
                                <img src={ph.url} alt="" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </aside>

      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl('')} />}

      <LogWarningModal
        open={showLogWarning}
        onClose={() => setShowLogWarning(false)}
        violationId={v?.id}
        currentLevel={v?.escalationLevel}
        suggestedNext={v?.suggestedNextEscalation}
        onUpdated={() => { setShowLogWarning(false); load(); onUpdated?.(); }}
      />
      <AddNoteModal
        open={showAddNote}
        onClose={() => setShowAddNote(false)}
        violationId={v?.id}
        onUpdated={() => { setShowAddNote(false); load(); onUpdated?.(); }}
      />
      <ResolveViolationModal
        open={showResolve}
        onClose={() => setShowResolve(false)}
        violationId={v?.id}
        onUpdated={() => { setShowResolve(false); load(); onUpdated?.(); }}
      />
    </>
  );
}

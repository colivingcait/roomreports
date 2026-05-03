import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import LogWarningModal from '../components/LogWarningModal';
import AddNoteModal from '../components/AddNoteModal';
import ResolveViolationModal from '../components/ResolveViolationModal';

const ESCALATION_STYLES = {
  FLAGGED:       { label: 'Flagged',       bg: '#F3F0EC', color: '#8A8583', border: '#C8C4C0' },
  FIRST_WARNING: { label: '1st Warning',   bg: '#FEF3C7', color: '#B45309', border: '#FDE68A' },
  SECOND_WARNING:{ label: '2nd Warning',   bg: '#FFEDD5', color: '#C2410C', border: '#FED7AA' },
  FINAL_NOTICE:  { label: 'Final Notice',  bg: '#FEE2E2', color: '#991B1B', border: '#FECACA' },
  RESOLVED:      { label: 'Resolved',      bg: '#DCFCE7', color: '#166534', border: '#BBF7D0' },
};

const ACTION_STYLES = {
  FLAGGED:       { label: 'Flagged',       color: '#8A8583' },
  FIRST_WARNING: { label: '1st Warning',   color: '#B45309' },
  SECOND_WARNING:{ label: '2nd Warning',   color: '#C2410C' },
  FINAL_NOTICE:  { label: 'Final Notice',  color: '#991B1B' },
  RESOLVED:      { label: 'Resolved',      color: '#166534' },
  NOTE:          { label: 'Note',          color: '#4A4543' },
};

const METHOD_LABELS = {
  VERBAL: 'Verbal', TEXT: 'Text', EMAIL: 'Email',
  POSTED_NOTICE: 'Posted notice', PADSPLIT_MESSAGE: 'PadSplit message', OTHER: 'Other',
};

const INSPECTION_TYPE_LABELS = {
  COMMON_AREA: 'Common Area', COMMON_AREA_QUICK: 'Common Area Quick Check',
  ROOM_TURN: 'Room Turn', QUARTERLY: 'Room Inspection',
  RESIDENT_SELF_CHECK: 'Self-Check', MOVE_IN_OUT: 'Move-In',
};

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function EscalationBadge({ level, resolved, large }) {
  const key = resolved ? 'RESOLVED' : (level || 'FLAGGED');
  const s = ESCALATION_STYLES[key] || ESCALATION_STYLES.FLAGGED;
  return (
    <span style={{
      display: 'inline-block',
      padding: large ? '4px 12px' : '2px 8px',
      borderRadius: 6,
      fontSize: large ? 14 : 12,
      fontWeight: 700,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>{s.label}</span>
  );
}

export default function ViolationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [violation, setViolation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState('');
  const [showLogWarning, setShowLogWarning] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [showResolve, setShowResolve] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await api(`/api/violations/${id}`);
      setViolation(d.violation);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleUnresolve = async () => {
    try {
      await api(`/api/violations/${id}/unresolve`, { method: 'POST' });
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const goToInspection = () => {
    const insp = violation?.sourceInspection;
    if (!insp) return;
    if (insp.type === 'QUARTERLY') {
      const dateKey = new Date(insp.createdAt).toISOString().slice(0, 10);
      navigate(`/quarterly-review/${violation.property?.id}/${dateKey}`);
    } else {
      navigate(`/inspections/${insp.id}/review`);
    }
  };

  if (loading) return <div className="page-loading">Loading violation...</div>;
  if (error) return <div className="page-container"><div className="auth-error">{error}</div></div>;
  if (!violation) return null;

  const v = violation;
  const isResolved = !!v.resolvedAt;
  const residentViolationCount = v.residentViolations?.length || 0;
  const residentActiveCount = v.residentViolations?.filter((rv) => !rv.resolvedAt).length || 0;
  const residentResolvedCount = residentViolationCount - residentActiveCount;

  return (
    <div className="page-container" style={{ maxWidth: 760 }}>
      {/* ── Back ── */}
      <button className="btn-text-sm" onClick={() => navigate(-1)} style={{ marginBottom: 16, color: '#8A8583' }}>
        ← Back
      </button>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: 22 }}>{v.typeLabel || v.category || 'Violation'}</h1>
            <EscalationBadge level={v.escalationLevel} resolved={isResolved} large />
          </div>
          <div style={{ color: '#8A8583', fontSize: 14 }}>
            {[v.room?.label, v.property?.name].filter(Boolean).join(' · ')}
            {v.residentName && <> · <strong style={{ color: '#4A4543' }}>{v.residentName}</strong></>}
            {' · Flagged '}{fmtDate(v.createdAt)}
          </div>
        </div>

        {/* ── PDF download ── */}
        <a
          href={`/api/violations/${v.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary-sm"
          style={{ whiteSpace: 'nowrap' }}
        >
          Export PDF
        </a>
      </div>

      {/* ── Repeat / resident alerts ── */}
      {v.isRepeat && v.previousResolved?.length > 0 && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 14, color: '#92400E' }}>
          Repeat violation — previously flagged on {fmtDate(v.previousResolved[0]?.createdAt)}
        </div>
      )}
      {residentViolationCount > 0 && (
        <div style={{ background: '#F3F0EC', border: '1px solid #E8E4E1', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 14 }}>
          This resident has <strong>{residentViolationCount}</strong> other violation{residentViolationCount !== 1 ? 's' : ''}
          {residentActiveCount > 0 && <> ({residentActiveCount} active, {residentResolvedCount} resolved)</>}
        </div>
      )}

      {/* ── Action buttons ── */}
      {!isResolved && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={() => setShowLogWarning(true)}>
            Log Warning
          </button>
          <button className="btn-secondary" onClick={() => setShowAddNote(true)}>
            Add Note
          </button>
          <button
            className="btn-secondary"
            style={{ borderColor: '#6B8F71', color: '#6B8F71' }}
            onClick={() => setShowResolve(true)}
          >
            Resolve
          </button>
        </div>
      )}
      {isResolved && (
        <div style={{ background: '#DCFCE7', border: '1px solid #BBF7D0', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 14 }}>
          <strong style={{ color: '#166534' }}>Resolved</strong> on {fmtDate(v.resolvedAt)}
          {v.resolvedType && <> — {v.resolvedType.replace(/_/g, ' ').toLowerCase()}</>}
          {v.resolvedNote && <div style={{ marginTop: 4, color: '#4A4543' }}>{v.resolvedNote}</div>}
          <button className="btn-text-sm" style={{ marginTop: 6, color: '#8A8583' }} onClick={handleUnresolve}>
            Reopen
          </button>
        </div>
      )}

      {/* ── Timeline ── */}
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: '#4A4543' }}>Timeline</h2>
      {(!v.timelineEntries || v.timelineEntries.length === 0) ? (
        <p style={{ color: '#8A8583', fontSize: 14 }}>No timeline entries yet.</p>
      ) : (
        <div style={{ position: 'relative' }}>
          {/* vertical line */}
          <div style={{ position: 'absolute', left: 10, top: 0, bottom: 0, width: 2, background: '#E8E4E1' }} />
          {v.timelineEntries.map((entry) => {
            const style = ACTION_STYLES[entry.actionType] || ACTION_STYLES.NOTE;
            return (
              <div key={entry.id} style={{ display: 'flex', gap: 16, marginBottom: 20, position: 'relative' }}>
                {/* dot */}
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', background: style.color,
                  flexShrink: 0, marginTop: 2, zIndex: 1, border: '2px solid #fff',
                  boxShadow: '0 0 0 2px ' + style.color,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: style.color }}>{style.label}</span>
                    {entry.method && (
                      <span style={{ fontSize: 12, color: '#8A8583', background: '#F3F0EC', padding: '1px 6px', borderRadius: 3 }}>
                        {METHOD_LABELS[entry.method] || entry.method}
                      </span>
                    )}
                    <span style={{ fontSize: 12, color: '#8A8583', marginLeft: 'auto' }}>
                      {fmtDate(entry.date)} · {entry.loggedByName}
                    </span>
                  </div>
                  {entry.notes && (
                    <p style={{ margin: '0 0 8px', fontSize: 14, color: '#4A4543', lineHeight: 1.5 }}>{entry.notes}</p>
                  )}
                  {entry.photos?.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {entry.photos.map((ph) => (
                        <button key={ph.id} type="button" onClick={() => setLightboxUrl(ph.url)}
                          style={{ border: 'none', padding: 0, cursor: 'pointer', borderRadius: 4, overflow: 'hidden' }}>
                          <img src={ph.url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', display: 'block' }} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Source inspection ── */}
      {v.sourceInspection && (
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #E8E4E1' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#8A8583', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Source Inspection
          </div>
          <button type="button" className="btn-text-sm" onClick={goToInspection}>
            {INSPECTION_TYPE_LABELS[v.sourceInspection.type] || v.sourceInspection.type}
            {v.sourceInspection.inspectorName && ` by ${v.sourceInspection.inspectorName}`}
            {' on '}{fmtDate(v.sourceInspection.completedAt || v.sourceInspection.createdAt)} →
          </button>
          {v.sourceItem?.photos?.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {v.sourceItem.photos.map((ph) => (
                <button key={ph.id} type="button" onClick={() => setLightboxUrl(ph.url)}
                  style={{ border: 'none', padding: 0, cursor: 'pointer', borderRadius: 4, overflow: 'hidden' }}>
                  <img src={ph.url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', display: 'block' }} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Follow-up ticket ── */}
      {v.followUp && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #E8E4E1' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#8A8583', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Follow-up Ticket
          </div>
          <button type="button" className="btn-text-sm" onClick={() => navigate('/maintenance')}>
            {v.followUp.description} · {v.followUp.status} →
          </button>
        </div>
      )}

      {/* ── Lightbox ── */}
      {lightboxUrl && (
        <div className="lightbox-overlay" onClick={() => setLightboxUrl('')}>
          <button className="lightbox-close" onClick={() => setLightboxUrl('')}>×</button>
          <img src={lightboxUrl} alt="" className="lightbox-image" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {/* ── Modals ── */}
      <LogWarningModal
        open={showLogWarning}
        onClose={() => setShowLogWarning(false)}
        violationId={v.id}
        currentLevel={v.escalationLevel}
        suggestedNext={v.suggestedNextEscalation}
        onUpdated={() => { setShowLogWarning(false); load(); }}
      />
      <AddNoteModal
        open={showAddNote}
        onClose={() => setShowAddNote(false)}
        violationId={v.id}
        onUpdated={() => { setShowAddNote(false); load(); }}
      />
      <ResolveViolationModal
        open={showResolve}
        onClose={() => setShowResolve(false)}
        violationId={v.id}
        onUpdated={() => { setShowResolve(false); load(); }}
      />
    </div>
  );
}

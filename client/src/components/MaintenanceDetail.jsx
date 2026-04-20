import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FLAG_CATEGORIES as CATEGORIES,
  PRIORITIES,
  PRIORITY_COLORS,
  ATTACHMENT_LABELS,
  roleLabel,
} from '../../../shared/index.js';

const STATUS_LABELS = { OPEN: 'Open', ASSIGNED: 'Assigned', IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved' };
const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'];

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

function fmtCurrency(n) {
  if (n == null) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function fmtDateTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function Lightbox({ url, onClose }) {
  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose}>&times;</button>
      <img src={url} alt="" className="lightbox-image" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

// ─── Main slide-over ────────────────────────────────────

export default function MaintenanceDetail({ itemId, onClose, onUpdated }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState('');

  // Editable local fields (flushed on blur / explicit save)
  const [draft, setDraft] = useState({});
  const [showEntryCode, setShowEntryCode] = useState(false);
  const fileInputRef = useRef();
  const [attachmentLabel, setAttachmentLabel] = useState('quote');
  const [uploading, setUploading] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api(`/api/maintenance/${itemId}`);
      setData(d);
      setDraft({
        description: d.item.description,
        assignedTo: d.item.assignedTo || '',
        vendor: d.item.vendor || '',
        estimatedCost: d.item.estimatedCost ?? '',
        actualCost: d.item.actualCost ?? '',
        entryCode: d.item.entryCode || '',
        entryApproved: !!d.item.entryApproved,
        note: d.item.note || '',
        priority: d.item.priority || '',
        flagCategory: d.item.flagCategory || '',
        status: d.item.status,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => { if (itemId) fetchDetail(); }, [itemId, fetchDetail]);

  const save = async (patch) => {
    try {
      const d = await api(`/api/maintenance/${itemId}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      setData((prev) => ({ ...prev, item: d.item }));
      onUpdated?.(d.item);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('label', attachmentLabel);
      const res = await fetch(`/api/maintenance/${itemId}/attachments`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setData((prev) => ({
        ...prev,
        item: { ...prev.item, attachments: [body.attachment, ...(prev.item.attachments || [])] },
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const deleteAttachment = async (attachmentId) => {
    try {
      await api(`/api/maintenance/${itemId}/attachments/${attachmentId}`, { method: 'DELETE' });
      setData((prev) => ({
        ...prev,
        item: {
          ...prev.item,
          attachments: prev.item.attachments.filter((a) => a.id !== attachmentId),
        },
      }));
    } catch (err) { setError(err.message); }
  };

  const downloadPdf = () => {
    window.open(`/api/maintenance/${itemId}/pdf`, '_blank');
  };

  if (!itemId) return null;

  return (
    <>
      <div className="slideover-backdrop" onClick={onClose} />
      <aside className="slideover">
        <div className="slideover-header">
          <h2>Maintenance Ticket</h2>
          <div className="slideover-header-actions">
            <button type="button" className="btn-secondary" onClick={downloadPdf}>Download PDF</button>
            <button type="button" className="slideover-close" onClick={onClose} aria-label="Close">&times;</button>
          </div>
        </div>

        {loading ? (
          <div className="slideover-body"><p className="page-loading">Loading...</p></div>
        ) : !data ? (
          <div className="slideover-body"><div className="auth-error">{error || 'Not found'}</div></div>
        ) : (
          <div className="slideover-body">
            {error && <div className="auth-error">{error}</div>}

            {/* Title + badges */}
            <div className="md-title">
              <textarea
                className="detail-textarea md-title-input"
                value={draft.description}
                rows={2}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                onBlur={() => draft.description !== data.item.description && save({ description: draft.description })}
              />
            </div>

            <div className="md-badges">
              {/* Status */}
              <select
                className="md-status"
                value={draft.status}
                onChange={(e) => { setDraft({ ...draft, status: e.target.value }); save({ status: e.target.value }); }}
              >
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
              {/* Priority */}
              <select
                className="md-priority"
                value={draft.priority}
                style={{
                  color: PRIORITY_COLORS[draft.priority] || '#8A8583',
                  borderColor: PRIORITY_COLORS[draft.priority] || '#D4D0CE',
                }}
                onChange={(e) => { setDraft({ ...draft, priority: e.target.value }); save({ priority: e.target.value || null }); }}
              >
                <option value="">No priority</option>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {/* Category */}
              <select
                className="md-category"
                value={draft.flagCategory}
                onChange={(e) => { setDraft({ ...draft, flagCategory: e.target.value }); save({ flagCategory: e.target.value }); }}
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Source / metadata */}
            <section className="md-section">
              <dl className="md-dl">
                <dt>Reported</dt>
                <dd>{fmtDateTime(data.item.createdAt)}</dd>

                <dt>Reported by</dt>
                <dd>
                  {data.item.reportedByName || '—'}
                  {data.item.reportedByRole && (
                    <span className="md-role-badge"> {roleLabel(data.item.reportedByRole)}</span>
                  )}
                </dd>

                <dt>Property</dt>
                <dd>
                  {data.item.property?.name}
                  {data.item.room?.label ? ` / ${data.item.room.label}` : ''}
                </dd>

                <dt>Source inspection</dt>
                <dd>
                  {data.item.inspection ? (
                    <button className="btn-text-sm" onClick={() => navigate(`/inspections/${data.item.inspection.id}/review`)}>
                      View inspection &rarr;
                    </button>
                  ) : '—'}
                </dd>
              </dl>
            </section>

            {/* Assignment + cost */}
            <section className="md-section">
              <h3 className="md-section-title">Assignment & cost</h3>
              <div className="md-grid">
                <label className="detail-label">
                  Assigned to
                  <input
                    type="text"
                    className="maint-input"
                    value={draft.assignedTo}
                    placeholder="Name or team"
                    onChange={(e) => setDraft({ ...draft, assignedTo: e.target.value })}
                    onBlur={() => draft.assignedTo !== (data.item.assignedTo || '') && save({ assignedTo: draft.assignedTo || null })}
                  />
                </label>
                <label className="detail-label">
                  Vendor
                  <input
                    type="text"
                    className="maint-input"
                    value={draft.vendor}
                    placeholder="Vendor name"
                    onChange={(e) => setDraft({ ...draft, vendor: e.target.value })}
                    onBlur={() => draft.vendor !== (data.item.vendor || '') && save({ vendor: draft.vendor || null })}
                  />
                </label>
                <label className="detail-label">
                  Estimated cost
                  <input
                    type="number"
                    step="0.01"
                    className="maint-input"
                    value={draft.estimatedCost}
                    placeholder="0.00"
                    onChange={(e) => setDraft({ ...draft, estimatedCost: e.target.value })}
                    onBlur={() => {
                      const n = draft.estimatedCost === '' ? null : Number(draft.estimatedCost);
                      if (n !== data.item.estimatedCost) save({ estimatedCost: n });
                    }}
                  />
                </label>
                <label className="detail-label">
                  Actual cost
                  <input
                    type="number"
                    step="0.01"
                    className="maint-input"
                    value={draft.actualCost}
                    placeholder="0.00"
                    onChange={(e) => setDraft({ ...draft, actualCost: e.target.value })}
                    onBlur={() => {
                      const n = draft.actualCost === '' ? null : Number(draft.actualCost);
                      if (n !== data.item.actualCost) save({ actualCost: n });
                    }}
                  />
                </label>
              </div>
            </section>

            {/* Entry */}
            <section className="md-section">
              <h3 className="md-section-title">Entry access</h3>
              <div className="md-grid">
                <label className="detail-label md-toggle">
                  <input
                    type="checkbox"
                    checked={draft.entryApproved}
                    onChange={(e) => {
                      setDraft({ ...draft, entryApproved: e.target.checked });
                      save({ entryApproved: e.target.checked });
                    }}
                  />
                  Resident has approved entry
                  {data.item.entryApprovedAt && (
                    <span className="md-dim"> · {new Date(data.item.entryApprovedAt).toLocaleDateString('en-US')}</span>
                  )}
                </label>
                <label className="detail-label">
                  Entry code
                  <div className="md-entry-code">
                    <input
                      type={showEntryCode ? 'text' : 'password'}
                      className="maint-input"
                      value={draft.entryCode}
                      placeholder="e.g. 4520#"
                      onChange={(e) => setDraft({ ...draft, entryCode: e.target.value })}
                      onBlur={() => draft.entryCode !== (data.item.entryCode || '') && save({ entryCode: draft.entryCode || null })}
                    />
                    <button type="button" className="btn-text-sm" onClick={() => setShowEntryCode((v) => !v)}>
                      {showEntryCode ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </label>
              </div>
            </section>

            {/* Notes */}
            <section className="md-section">
              <h3 className="md-section-title">Notes</h3>
              <textarea
                className="detail-textarea"
                value={draft.note}
                placeholder="Internal notes, communication, etc."
                rows={3}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                onBlur={() => draft.note !== (data.item.note || '') && save({ note: draft.note || null })}
              />
            </section>

            {/* Photos */}
            {data.item.photos?.length > 0 && (
              <section className="md-section">
                <h3 className="md-section-title">Photos</h3>
                <div className="review-photos">
                  {data.item.photos.map((p) => (
                    <button key={p.id} type="button" className="review-photo-thumb" onClick={() => setLightboxUrl(p.url)}>
                      <img src={p.url} alt="" />
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Attachments */}
            <section className="md-section">
              <h3 className="md-section-title">Attachments</h3>
              <div className="md-attachment-upload">
                <select value={attachmentLabel} onChange={(e) => setAttachmentLabel(e.target.value)} className="filter-select">
                  {ATTACHMENT_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <input ref={fileInputRef} type="file" accept="application/pdf,image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
                <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading...' : '+ Add file'}
                </button>
              </div>
              {data.item.attachments?.length > 0 ? (
                <ul className="md-attachment-list">
                  {data.item.attachments.map((a) => (
                    <li key={a.id} className="md-attachment-row">
                      <span className="md-attachment-label">{a.label}</span>
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="md-attachment-name">{a.originalName}</a>
                      <button type="button" className="btn-icon-danger" onClick={() => deleteAttachment(a.id)} title="Remove">&times;</button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-text">No attachments yet.</p>
              )}
            </section>

            {/* Timeline */}
            <section className="md-section">
              <h3 className="md-section-title">Timeline</h3>
              {data.item.events?.length > 0 ? (
                <ol className="md-timeline">
                  {data.item.events.map((e) => (
                    <li key={e.id}>
                      <span className="md-timeline-dot" />
                      <div>
                        <div className="md-timeline-head">
                          <strong>{e.type}</strong>
                          {e.fromValue || e.toValue ? <span className="md-dim"> {e.fromValue || '—'} → {e.toValue || '—'}</span> : null}
                        </div>
                        <div className="md-dim">
                          {fmtDateTime(e.createdAt)}{e.byUserName ? ` · ${e.byUserName}` : ''}
                        </div>
                        {e.note && <div className="md-timeline-note">{e.note}</div>}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="empty-text">No events yet.</p>
              )}
            </section>

            {/* Related */}
            {data.previousInRoom?.length > 0 && (
              <section className="md-section">
                <h3 className="md-section-title">Previous issues in this room</h3>
                <ul className="md-related-list">
                  {data.previousInRoom.map((r) => (
                    <li key={r.id} className="md-related-row">
                      <span className="md-related-cat">{r.flagCategory}</span>
                      <span className="md-related-desc">{r.description}</span>
                      <span className="md-dim">{fmtDateTime(r.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data.relatedInProperty?.length > 0 && (
              <section className="md-section">
                <h3 className="md-section-title">Related issues in this property</h3>
                <ul className="md-related-list">
                  {data.relatedInProperty.map((r) => (
                    <li key={r.id} className="md-related-row">
                      <span className="md-related-room">{r.room?.label || '—'}</span>
                      <span className="md-related-desc">{r.description}</span>
                      <span className="md-dim">{fmtDateTime(r.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </aside>

      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl('')} />}
    </>
  );
}

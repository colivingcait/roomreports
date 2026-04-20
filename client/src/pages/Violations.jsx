import { useState, useEffect, useCallback } from 'react';
import Modal from '../components/Modal';

const METHOD_LABELS = {
  text: 'Text',
  email: 'Email',
  verbal: 'Verbal',
  written_notice: 'Written notice',
  other: 'Other',
};
const METHODS = Object.keys(METHOD_LABELS);

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

function fmt(d) {
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function Violations() {
  const [violations, setViolations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterActive, setFilterActive] = useState(true);
  const [actionTarget, setActionTarget] = useState(null);
  const [draft, setDraft] = useState({ method: 'email', description: '', actionAt: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterActive) params.set('active', 'true');
    try {
      const d = await api(`/api/violations?${params}`);
      setViolations(d.violations || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [filterActive]);

  useEffect(() => { load(); }, [load]);

  const addAction = async (e) => {
    e.preventDefault();
    if (!draft.description.trim()) return;
    await api(`/api/violations/${actionTarget.id}/actions`, {
      method: 'POST',
      body: JSON.stringify({
        method: draft.method,
        description: draft.description.trim(),
        actionAt: draft.actionAt || undefined,
      }),
    });
    setActionTarget(null);
    setDraft({ method: 'email', description: '', actionAt: '' });
    load();
  };

  const toggleResolved = async (v) => {
    await api(`/api/violations/${v.id}`, {
      method: 'PUT',
      body: JSON.stringify({ resolved: !v.resolvedAt }),
    });
    load();
  };

  if (loading) return <div className="page-loading">Loading violations...</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Lease Violations</h1>
          <p className="page-subtitle">{violations.length} record{violations.length === 1 ? '' : 's'}</p>
        </div>
        <button
          className={`filter-toggle ${filterActive ? 'active' : ''}`}
          onClick={() => setFilterActive((v) => !v)}
        >
          {filterActive ? '✓ Active only' : 'Show all'}
        </button>
      </div>

      {violations.length === 0 ? (
        <div className="empty-state"><p>No lease violations on record.</p></div>
      ) : (
        <div className="violation-list">
          {violations.map((v) => (
            <div key={v.id} className="violation-card">
              <div className="violation-head">
                <div>
                  <h3 className="violation-desc">{v.description}</h3>
                  <p className="violation-meta">
                    {v.property?.name}{v.room?.label ? ` / ${v.room.label}` : ''}
                    {' · '}Reported {fmt(v.createdAt)}
                    {v.reportedByName ? ` by ${v.reportedByName}` : ''}
                  </p>
                  {v.category && <span className="review-cat-badge">{v.category}</span>}
                </div>
                <button
                  className={`btn-text-sm ${v.resolvedAt ? '' : ''}`}
                  onClick={() => toggleResolved(v)}
                  style={{ color: v.resolvedAt ? '#6B8F71' : '#C4703F' }}
                >
                  {v.resolvedAt ? 'Resolved ✓' : 'Mark resolved'}
                </button>
              </div>
              {v.note && (
                <div className="review-item-note">
                  <span className="review-note-label">Note:</span> {v.note}
                </div>
              )}

              <div className="violation-actions">
                <div className="violation-actions-head">
                  <h4>Follow-up log</h4>
                  <button className="btn-text-sm" onClick={() => setActionTarget(v)}>+ Log action</button>
                </div>
                {v.actions?.length === 0 ? (
                  <p className="empty-text">No actions logged yet.</p>
                ) : (
                  <ul className="violation-action-list">
                    {v.actions.map((a) => (
                      <li key={a.id}>
                        <span className="violation-action-method">{METHOD_LABELS[a.method] || a.method}</span>
                        <span className="violation-action-date">{fmt(a.actionAt)}</span>
                        <div className="violation-action-desc">{a.description}</div>
                        {a.loggedByName && <div className="maint-dim" style={{ fontSize: '0.75rem' }}>logged by {a.loggedByName}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!actionTarget}
        onClose={() => setActionTarget(null)}
        title="Log follow-up action"
      >
        <form onSubmit={addAction} className="modal-form">
          <label>
            Method
            <select className="form-select" value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value })}>
              {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
            </select>
          </label>
          <label>
            When <span className="form-optional">(defaults to now)</span>
            <input
              type="datetime-local"
              value={draft.actionAt}
              onChange={(e) => setDraft({ ...draft, actionAt: e.target.value })}
            />
          </label>
          <label>
            What happened
            <textarea
              className="detail-textarea"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Spoke with resident about noise complaint..."
              rows={3}
              required
            />
          </label>
          <button type="submit" className="btn-primary" disabled={!draft.description.trim()}>
            Log action
          </button>
        </form>
      </Modal>
    </div>
  );
}

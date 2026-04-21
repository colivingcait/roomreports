import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });

function fmtDate(d) {
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function Suggest() {
  const { user } = useAuth();
  const isPMorOwner = user?.role === 'PM' || user?.role === 'OWNER';
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [list, setList] = useState([]);
  const [loadingList, setLoadingList] = useState(isPMorOwner);

  const loadList = () => {
    if (!isPMorOwner) return;
    setLoadingList(true);
    api('/api/suggestions')
      .then((d) => setList(d.suggestions || []))
      .catch(() => {})
      .finally(() => setLoadingList(false));
  };

  useEffect(() => { loadList(); }, [isPMorOwner]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await api('/api/suggestions', {
        method: 'POST',
        body: JSON.stringify({ suggestion: text.trim() }),
      });
      setText('');
      setSent(true);
      setTimeout(() => setSent(false), 3000);
      loadList();
    } catch (err) {
      setError(err.message || 'Failed to submit suggestion');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Suggest a Feature</h1>
          <p className="page-subtitle">Tell us what you wish RoomReport did — we read every submission.</p>
        </div>
      </div>

      <form className="suggest-form" onSubmit={submit}>
        <textarea
          className="detail-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. I'd love a way to schedule recurring common-area inspections..."
          rows={5}
        />
        {error && <div className="auth-error">{error}</div>}
        {sent && <div className="settings-success">Thanks — got it.</div>}
        <div className="modal-actions">
          <button type="submit" className="btn-primary" disabled={submitting || !text.trim()}>
            {submitting ? 'Sending...' : 'Send suggestion'}
          </button>
        </div>
      </form>

      {isPMorOwner && (
        <div className="suggest-past">
          <h3 className="md-section-title">Past submissions</h3>
          {loadingList ? (
            <div className="page-loading">Loading...</div>
          ) : list.length === 0 ? (
            <p className="empty-text">No suggestions submitted yet.</p>
          ) : (
            <div className="suggest-list">
              {list.map((s) => (
                <div key={s.id} className="suggest-row">
                  <div className="suggest-row-head">
                    <span className="suggest-row-date">{fmtDate(s.createdAt)}</span>
                    <span className="suggest-row-status">Submitted</span>
                  </div>
                  <div className="suggest-row-body">{s.suggestion}</div>
                  <div className="suggest-row-foot">
                    {s.userName}
                    {s.userEmail && <span className="dot" style={{ margin: '0 0.35rem' }} />}
                    {s.userEmail}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

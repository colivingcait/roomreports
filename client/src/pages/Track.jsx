import { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';

const STATUS_STEPS = [
  { key: 'SUBMITTED', label: 'Submitted' },
  { key: 'IN_PROGRESS', label: 'In Progress' },
  { key: 'RESOLVED', label: 'Resolved' },
];

// OPEN and ASSIGNED both render as "Submitted" to the resident.
function stepIndex(status) {
  if (status === 'RESOLVED') return 2;
  if (status === 'IN_PROGRESS') return 1;
  return 0;
}

export default function Track() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const [item, setItem] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [unsubscribed, setUnsubscribed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/public/track/${encodeURIComponent(token)}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Not found');
        setItem(d);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  useEffect(() => {
    if (params.get('unsubscribe') === '1' && !unsubscribed) {
      fetch(`/api/public/track/${encodeURIComponent(token)}/unsubscribe`, {
        method: 'POST',
      })
        .then(() => setUnsubscribed(true))
        .catch(() => {});
    }
  }, [params, token, unsubscribed]);

  if (loading) {
    return (
      <div className="track-page">
        <div className="track-card"><p>Loading...</p></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="track-page">
        <div className="track-card">
          <h1>We couldn&apos;t find that report</h1>
          <p className="track-sub">The tracking link may be invalid or the report has been removed.</p>
        </div>
      </div>
    );
  }

  const idx = stepIndex(item.status);
  const submittedAt = new Date(item.createdAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  return (
    <div className="track-page">
      <div className="track-card">
        <div className="track-brand">RoomReport</div>
        <h1>Your maintenance report</h1>
        <p className="track-sub">Submitted {submittedAt} · {item.propertyName}{item.roomLabel ? ` · ${item.roomLabel}` : ''}</p>

        <div className="track-issue">
          <div className="track-issue-label">Issue</div>
          <div className="track-issue-text">{item.description}</div>
        </div>

        <div className="track-steps">
          {STATUS_STEPS.map((s, i) => {
            const state = i < idx ? 'done' : i === idx ? 'active' : 'todo';
            return (
              <div key={s.key} className={`track-step track-step-${state}`}>
                <div className="track-step-dot">{i < idx ? '✓' : i + 1}</div>
                <div className="track-step-label">{s.label}</div>
                {i < STATUS_STEPS.length - 1 && <div className="track-step-line" />}
              </div>
            );
          })}
        </div>

        {unsubscribed && (
          <p className="track-sub" style={{ color: '#3B6D11', marginTop: '1.5rem' }}>
            You&apos;ve been unsubscribed from further email updates.
          </p>
        )}

        <div className="track-footer">
          <p className="track-sub">Still having issues? <Link to={`/report/${item.propertyName || ''}`}>Submit a new report</Link></p>
        </div>
      </div>
    </div>
  );
}

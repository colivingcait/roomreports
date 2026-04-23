import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { notificationMeta } from '../../../shared/notifications.js';

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 2 * 24 * 60 * 60_000) return 'Yesterday';
  if (diff < 7 * 24 * 60 * 60_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function Notifications() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (append = false) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '30' });
      if (append && cursor) qs.set('cursor', cursor);
      const r = await fetch(`/api/notifications?${qs}`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setItems((prev) => (append ? [...prev, ...d.notifications] : d.notifications));
      setCursor(d.nextCursor);
      setHasMore(!!d.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [cursor]);

  useEffect(() => { load(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClick = async (n) => {
    if (!n.read) {
      await fetch(`/api/notifications/${n.id}/read`, { method: 'POST', credentials: 'include' });
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
    if (n.link) navigate(n.link);
  };

  const markAll = async () => {
    await fetch('/api/notifications/mark-all-read', { method: 'POST', credentials: 'include' });
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Notifications</h1>
          <p className="page-subtitle">Recent activity on your account</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link to="/notifications/settings" className="btn-secondary-sm">
            Notification settings
          </Link>
          <button className="btn-primary-sm" onClick={markAll}>
            Mark all as read
          </button>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <p className="page-loading">Loading...</p>
      ) : items.length === 0 ? (
        <div className="empty-state"><p>No notifications yet.</p></div>
      ) : (
        <div className="notif-page-list">
          {items.map((n) => {
            const meta = notificationMeta(n.type);
            return (
              <button
                key={n.id}
                type="button"
                className={`notif-page-row ${n.read ? '' : 'notif-page-row-unread'}`}
                onClick={() => handleClick(n)}
              >
                <span
                  className="notif-row-icon"
                  style={{ background: meta.color + '22', color: meta.color }}
                >
                  <span aria-hidden="true">{meta.icon || '🔔'}</span>
                </span>
                <div className="notif-page-body">
                  <div className="notif-page-head">
                    <span className="notif-page-title">{n.title}</span>
                    <span className="notif-page-ts">{timeAgo(n.createdAt)}</span>
                  </div>
                  <div className="notif-page-message">{n.message}</div>
                </div>
                {!n.read && <span className="notif-row-dot" />}
              </button>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.5rem' }}>
          <button className="btn-secondary-sm" onClick={() => load(true)} disabled={loading}>
            {loading ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { notificationMeta } from '../../../shared/notifications.js';

const POLL_MS = 60_000;

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 2 * 24 * 60 * 60_000) return 'Yesterday';
  if (diff < 7 * 24 * 60 * 60_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const BellIcon = ({ size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 01-3.46 0" />
  </svg>
);

export default function NotificationBell({ compact = false }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const wrapRef = useRef(null);

  const fetchUnread = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications/unread-count', { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      setUnread(d.unread || 0);
    } catch { /* ignore */ }
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/notifications?limit=20', { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      setItems(d.notifications || []);
      setUnread(d.unread || 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUnread();
    const id = setInterval(fetchUnread, POLL_MS);
    return () => clearInterval(id);
  }, [fetchUnread]);

  useEffect(() => {
    if (!open) return;
    fetchList();
  }, [open, fetchList]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    setTimeout(() => document.addEventListener('click', onClick), 0);
    return () => document.removeEventListener('click', onClick);
  }, [open]);

  const markOne = async (id) => {
    try {
      await fetch(`/api/notifications/${id}/read`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    try {
      await fetch('/api/notifications/mark-all-read', {
        method: 'POST',
        credentials: 'include',
      });
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnread(0);
    } catch { /* ignore */ }
  };

  const openItem = async (n) => {
    if (!n.read) {
      await markOne(n.id);
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
    }
    setOpen(false);
    if (n.link) navigate(n.link);
    else navigate('/notifications');
  };

  return (
    <div className={`notif-wrap ${compact ? 'notif-wrap-compact' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className="notif-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
      >
        <BellIcon size={compact ? 22 : 20} />
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-dropdown" role="dialog">
          <div className="notif-dropdown-head">
            <span className="notif-dropdown-title">Notifications</span>
            {unread > 0 && (
              <button className="notif-mark-all" onClick={markAllRead}>
                Mark all as read
              </button>
            )}
          </div>
          <div className="notif-dropdown-body">
            {loading && items.length === 0 ? (
              <p className="notif-empty">Loading…</p>
            ) : items.length === 0 ? (
              <p className="notif-empty">You&apos;re all caught up.</p>
            ) : (
              items.map((n) => {
                const meta = notificationMeta(n.type);
                return (
                  <button
                    type="button"
                    key={n.id}
                    className={`notif-row ${n.read ? '' : 'notif-row-unread'}`}
                    onClick={() => openItem(n)}
                  >
                    <span
                      className="notif-row-icon"
                      style={{ background: meta.color + '22', color: meta.color }}
                    >
                      <span aria-hidden="true">{meta.icon || '🔔'}</span>
                    </span>
                    <span className="notif-row-body">
                      <span className="notif-row-title">{n.title}</span>
                      <span className="notif-row-message">{n.message}</span>
                      <span className="notif-row-ts">{timeAgo(n.createdAt)}</span>
                    </span>
                    {!n.read && <span className="notif-row-dot" />}
                  </button>
                );
              })
            )}
          </div>
          <div className="notif-dropdown-foot">
            <Link to="/notifications" className="notif-view-all" onClick={() => setOpen(false)}>
              View all
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

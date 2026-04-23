import { useState, useEffect } from 'react';
import { NOTIFICATION_CATEGORY_ORDER } from '../../../shared/notifications.js';

export default function NotificationSettings() {
  const [prefs, setPrefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/notifications/preferences', { credentials: 'include' });
        const d = await r.json();
        setPrefs(d.preferences || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = (type) => {
    setPrefs((prev) =>
      prev.map((p) => (p.type === type ? { ...p, email: !p.email } : p)),
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: prefs.map((p) => ({ type: p.type, email: p.email })),
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to save');
      }
      setNotification('Preferences saved.');
      setTimeout(() => setNotification(''), 3000);
    } catch (err) {
      setNotification(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page-loading">Loading...</div>;

  const grouped = {};
  for (const p of prefs) {
    const cat = p.meta?.category || 'Other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(p);
  }

  const orderedCats = [
    ...NOTIFICATION_CATEGORY_ORDER.filter((c) => grouped[c]),
    ...Object.keys(grouped).filter((c) => !NOTIFICATION_CATEGORY_ORDER.includes(c)),
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Notifications</h1>
          <p className="page-subtitle">
            Choose which emails you&apos;d like to receive. In-app bell notifications are always on.
          </p>
        </div>
        <button className="btn-primary-sm" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>

      {notification && <div className="notification-bar">{notification}</div>}

      {orderedCats.map((cat) => (
        <div className="notif-settings-section" key={cat}>
          <h2 className="notif-settings-category">{cat}</h2>
          <div className="notif-settings-list">
            {grouped[cat].map((p) => (
              <label key={p.type} className="notif-settings-row">
                <div className="notif-settings-label">
                  <div className="notif-settings-title">
                    <span aria-hidden="true" style={{ marginRight: '0.5rem' }}>{p.meta?.icon || '🔔'}</span>
                    {p.meta?.label}
                  </div>
                  {p.meta?.desc && <div className="notif-settings-desc">{p.meta.desc}</div>}
                </div>
                <div className="notif-toggle-wrap">
                  <input
                    type="checkbox"
                    className="notif-toggle"
                    checked={p.email}
                    onChange={() => toggle(p.type)}
                  />
                </div>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

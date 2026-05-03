import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import UpgradeModal from '../components/UpgradeModal';
import { useFeatureGate } from '../hooks/useFeatureGate';

const ITEMS = [
  { label: 'Team', path: '/team', desc: 'Members, invitations, roles' },
  { label: 'Notifications', path: '/notifications/settings', desc: 'Email alerts and in-app bell' },
  { label: 'Vendors', path: '/vendors', desc: 'Vendor directory', feature: 'vendors' },
  { label: 'Templates', path: '/templates', desc: 'Customize inspection checklists', feature: 'customTemplates' },
  { label: 'Sharing', path: '/sharing', desc: 'Resident QR links (move-in, self-check, report)' },
  { label: 'Billing', path: '/billing', desc: 'Subscription & invoices', ownerOnly: true },
  { label: 'Settings', path: '/settings', desc: 'Organization settings', ownerOnly: true },
  { label: 'Suggest a Feature', path: '/suggest', desc: 'Send us product feedback' },
];

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

export default function More() {
  const navigate = useNavigate();
  const { user, organization, logout, effectiveRole } = useAuth();
  const { can, isBeta, gate, promptUpgrade, dismiss } = useFeatureGate();
  const [memberships, setMemberships] = useState([]);
  const [showOrgPicker, setShowOrgPicker] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetch('/api/auth/orgs', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setMemberships(d?.memberships || []))
      .catch(() => setMemberships([]));
  }, [user?.id]);

  const switchOrg = async (organizationId) => {
    if (organizationId === user?.organizationId) {
      setShowOrgPicker(false);
      return;
    }
    try {
      const res = await fetch('/api/auth/switch-org', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || 'Could not switch org');
      try { localStorage.setItem('roomreport:active-org', organizationId); } catch { /* ignore */ }
      window.location.assign('/dashboard');
    } catch (err) {
      console.error(err);
      setShowOrgPicker(false);
    }
  };

  const items = ITEMS.filter((it) => !it.ownerOnly || effectiveRole === 'OWNER');

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>More</h1>
          <p className="page-subtitle">
            {organization?.name}
            {isBeta && <span className="beta-badge" style={{ marginLeft: '0.5rem' }}>Beta</span>}
          </p>
        </div>
      </div>

      {memberships.length > 1 && (
        <div className="more-org-switcher">
          <button
            type="button"
            className="more-org-current"
            onClick={() => setShowOrgPicker((v) => !v)}
          >
            <span className="more-org-current-label">Organization</span>
            <span className="more-org-current-name">
              {organization?.name}
              <span className="more-org-chev">▾</span>
            </span>
          </button>
          {showOrgPicker && (
            <div className="more-org-list">
              {memberships.map((m) => (
                <button
                  key={m.organizationId}
                  type="button"
                  className={`more-org-item ${m.organizationId === user?.organizationId ? 'more-org-item-active' : ''}`}
                  onClick={() => switchOrg(m.organizationId)}
                >
                  <span className="more-org-item-name">{m.organizationName}</span>
                  <span className="more-org-item-role">{m.role}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="more-list">
        {items.map((it) => {
          const accessible = !it.feature || can(it.feature);
          const onClick = () => {
            if (accessible) navigate(it.path);
            else promptUpgrade({ feature: it.feature });
          };
          return (
            <button
              key={it.path}
              className={`more-row ${!accessible ? 'more-row-locked' : ''}`}
              onClick={onClick}
            >
              <div>
                <div className="more-row-label">
                  {it.label}
                  {!accessible && (
                    <span className="more-row-lock" title="Upgrade required">
                      <LockIcon />
                    </span>
                  )}
                </div>
                <div className="more-row-desc">{it.desc}</div>
              </div>
              <span className="more-row-chev">&#9656;</span>
            </button>
          );
        })}
      </div>

      <div className="more-footer">
        <div className="more-user">
          <div className="more-user-name">{user?.name}</div>
          <div className="more-user-email">{user?.email}</div>
        </div>
        <button className="btn-secondary" onClick={logout}>Sign out</button>
      </div>

      <UpgradeModal
        open={gate.open}
        onClose={dismiss}
        feature={gate.feature}
        plan={gate.plan}
        title={gate.title}
        body={gate.body}
      />
    </div>
  );
}

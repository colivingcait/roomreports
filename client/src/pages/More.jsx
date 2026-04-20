import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const items = [
  { label: 'Team', path: '/team', desc: 'Members, invitations, roles' },
  { label: 'Vendors', path: '/vendors', desc: 'Vendor directory' },
  { label: 'Templates', path: '/templates', desc: 'Customize inspection checklists' },
  { label: 'Sharing', path: '/team?section=sharing', desc: 'Resident QR links (move-in, self-check, report)' },
  { label: 'Billing', path: '/billing', desc: 'Subscription & invoices' },
  { label: 'Settings', path: '/settings', desc: 'Organization settings' },
  { label: 'Suggest a Feature', path: '/suggest', desc: 'Send us product feedback' },
];

export default function More() {
  const navigate = useNavigate();
  const { user, organization, logout } = useAuth();

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>More</h1>
          <p className="page-subtitle">{organization?.name}</p>
        </div>
      </div>

      <div className="more-list">
        {items.map((it) => (
          <button
            key={it.path}
            className="more-row"
            onClick={() => navigate(it.path)}
          >
            <div>
              <div className="more-row-label">{it.label}</div>
              <div className="more-row-desc">{it.desc}</div>
            </div>
            <span className="more-row-chev">&#9656;</span>
          </button>
        ))}
      </div>

      <div className="more-footer">
        <div className="more-user">
          <div className="more-user-name">{user?.name}</div>
          <div className="more-user-email">{user?.email}</div>
        </div>
        <button className="btn-secondary" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}

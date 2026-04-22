import { useNavigate, useLocation } from 'react-router-dom';

// Shared toggle that appears on the Maintenance, To-Do, and "All" views.
// Active value is determined by the current pathname.
export default function MaintenanceToDoTabs() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tabs = [
    { value: 'maintenance', label: 'Maintenance', path: '/maintenance' },
    { value: 'todo', label: 'To-Do', path: '/todo' },
  ];
  const active = pathname.startsWith('/maintenance')
    ? 'maintenance'
    : pathname.startsWith('/todo')
      ? 'todo'
      : null;

  return (
    <div className="view-toggle" style={{ marginBottom: '0.5rem' }}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          className={`view-btn ${active === t.value ? 'active' : ''}`}
          onClick={() => active !== t.value && navigate(t.path)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
